import { afterAll, describe, expect, test } from 'bun:test'
import { ApiError, minimalThinking, usageCostUsd, VeniceBackend } from '../src/venice'

type Handler = (request: Request, body: unknown) => Response | Promise<Response>

const queue: Handler[] = []
const seen: { path: string; auth: string | null; body: unknown }[] = []
const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const text = await request.text()
    const body = text ? JSON.parse(text) : undefined
    seen.push({ path: new URL(request.url).pathname + new URL(request.url).search, auth: request.headers.get('authorization'), body })
    const handler = queue.shift()
    return handler ? handler(request, body) : new Response('no handler', { status: 599 })
  },
})
afterAll(() => server.stop(true))

const backend = () =>
  new VeniceBackend({ apiKey: 'test-key', baseUrl: `http://localhost:${server.port}`, searchRpm: 60_000, chatRpm: 60_000, maxConcurrent: 4, retryBaseMs: 5 })

const json = (value: unknown, init?: ResponseInit) => Response.json(value, init)

describe('VeniceBackend', () => {
  test('search sends the provider and limit, and waits out a 429', async () => {
    seen.length = 0
    queue.push(
      () => new Response('{"error":"Too many requests"}', { status: 429, headers: { 'x-ratelimit-reset-requests': String(Date.now() + 150) } }),
      () => json({ query: 'q', results: [{ title: 'A', url: 'https://a.example', content: 'alpha', date: '' }] }),
    )
    const started = Date.now()
    const result = await backend().search('q', 'exa', 7)
    expect(Date.now() - started).toBeGreaterThanOrEqual(100)
    expect(result.hits).toEqual([{ title: 'A', url: 'https://a.example', content: 'alpha', date: '' }])
    expect(result.attempts).toBe(1)
    expect(result.totalMs).toBeLessThan(100)
    expect(seen[1]).toEqual({ path: '/augment/search', auth: 'Bearer test-key', body: { query: 'q', limit: 7, search_provider: 'exa' } })
  })

  test('a 429 does not use up the server-error retries', async () => {
    queue.push(
      () => new Response('{"error":"Too many requests"}', { status: 429, headers: { 'retry-after': '0' } }),
      () => json({ error: 'Search provider failed' }, { status: 500 }),
      () => json({ error: 'Search provider failed' }, { status: 500 }),
      () => json({ results: [] }),
    )
    const result = await backend().search('q', 'brave', 5)
    expect(result).toMatchObject({ hits: [], attempts: 3 })
  })

  test('chat retries server errors, strips think blocks, and records cache reads', async () => {
    queue.push(
      () => new Response('upstream', { status: 503 }),
      () =>
        json({
          choices: [{ message: { content: '<think>hmm</think>\nThe answer.' } }],
          usage: { prompt_tokens: 12, completion_tokens: 3, prompt_tokens_details: { cached_tokens: 8 } },
        }),
    )
    const result = await backend().chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }] })
    expect(result).toMatchObject({ content: 'The answer.', usage: { promptTokens: 12, completionTokens: 3, cachedTokens: 8 }, attempts: 2 })
  })

  test('a surrogate pair split by truncation is sent as a replacement character', async () => {
    seen.length = 0
    queue.push(() => json({ choices: [{ message: { content: 'ok' } }] }))
    const cut = 'emoji 😀'.slice(0, -1)
    await backend().chat({ model: 'm', messages: [{ role: 'user', content: cut }] })
    expect(seen[0]?.body).toMatchObject({ messages: [{ role: 'user', content: 'emoji \uFFFD' }] })
  })

  test('balance errors are fatal and not retried', async () => {
    queue.push(() => json({ error: 'Insufficient USD or Diem balance' }, { status: 402 }))
    const error = await backend()
      .chat({ model: 'm', messages: [] })
      .catch(e => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 402, attempts: 1 })
    expect(error.fatal).toBe(true)
    expect(error.message).toContain('Insufficient USD or Diem balance')
  })

  test('validation errors fail once without retry', async () => {
    queue.push(() => json({ error: { message: 'limit must be <= 20' } }, { status: 400 }))
    const error = await backend()
      .search('q', 'brave', 50)
      .catch(e => e)
    expect(error).toMatchObject({ status: 400, attempts: 1 })
    expect(error.fatal).toBe(false)
    expect(error.message).toContain('limit must be <= 20')
  })

  test('search gives up after its retries', async () => {
    queue.push(...Array.from({ length: 3 }, () => () => json({ error: 'Search provider failed' }, { status: 500 })))
    const error = await backend()
      .search('q', 'google', 5)
      .catch(e => e)
    expect(error).toMatchObject({ status: 500, attempts: 3 })
  })

  test('models maps pricing, privacy, and capabilities', async () => {
    seen.length = 0
    queue.push(() =>
      json({
        data: [
          {
            id: 'glm',
            model_spec: {
              privacy: 'private',
              pricing: { input: { usd: 1.4 }, cache_input: { usd: 0.26 }, output: { usd: 4.4 } },
              capabilities: { supportsReasoning: true, supportsReasoningEffort: true, reasoningEffortOptions: ['none', 'max'], supportsResponseSchema: true, supportsFunctionCalling: true },
            },
          },
        ],
      }),
    )
    expect(await backend().models()).toEqual([
      {
        id: 'glm',
        privacy: 'private',
        inputUsdPerMillion: 1.4,
        outputUsdPerMillion: 4.4,
        cacheInputUsdPerMillion: 0.26,
        supportsReasoning: true,
        supportsReasoningEffort: true,
        reasoningEffortOptions: ['none', 'max'],
        supportsResponseSchema: true,
        supportsFunctionCalling: true,
      },
    ])
    expect(seen[0]?.path).toBe('/models?type=text')
  })
})

describe('usageCostUsd', () => {
  const price = { inputUsdPerMillion: 1, outputUsdPerMillion: 4, cacheInputUsdPerMillion: 0.25, cacheWriteUsdPerMillion: 1.25 }

  test('bills cache reads and writes out of the prompt total', () => {
    expect(usageCostUsd(price, { promptTokens: 1_000_000, completionTokens: 0 })).toBeCloseTo(1)
    expect(usageCostUsd(price, { promptTokens: 1_000_000, completionTokens: 0, cachedTokens: 600_000, cacheWriteTokens: 400_000 })).toBeCloseTo(0.15 + 0.5)
    expect(usageCostUsd(price, { promptTokens: 0, completionTokens: 1_000_000 })).toBeCloseTo(4)
  })

  test('falls back to the input rate without cache pricing, and to null without any price', () => {
    expect(usageCostUsd({ inputUsdPerMillion: 1, outputUsdPerMillion: 4 }, { promptTokens: 1_000_000, completionTokens: 0, cachedTokens: 500_000 })).toBeCloseTo(1)
    expect(usageCostUsd(undefined, { promptTokens: 10, completionTokens: 10 })).toBeNull()
    expect(usageCostUsd({ inputUsdPerMillion: 1 }, { promptTokens: 10, completionTokens: 10 })).toBeNull()
  })
})

describe('minimalThinking', () => {
  test('sends nothing to models without reasoning', () => {
    expect(minimalThinking({ id: 'x', supportsReasoning: false })).toEqual({ veniceParameters: {} })
    expect(minimalThinking(undefined)).toEqual({ veniceParameters: {} })
  })

  test('picks the lowest supported effort', () => {
    expect(minimalThinking({ id: 'grok', supportsReasoning: true, supportsReasoningEffort: true, reasoningEffortOptions: ['high', 'low', 'medium', 'xhigh'] }).reasoning_effort).toBe('low')
    expect(minimalThinking({ id: 'glm', supportsReasoning: true, supportsReasoningEffort: true, reasoningEffortOptions: ['none', 'high', 'max'] }).reasoning_effort).toBe('none')
  })

  test('falls back to disable_thinking without effort support', () => {
    expect(minimalThinking({ id: 'q', supportsReasoning: true })).toEqual({ veniceParameters: { disable_thinking: true, strip_thinking_response: true } })
  })
})
