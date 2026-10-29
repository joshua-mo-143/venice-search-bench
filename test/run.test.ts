import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RESULTS_HEADING } from '../src/prompt'
import { loadRun, runSpend, writeReport } from '../src/report'
import { answerJobs, answerPrompt, answerRequest, estimateCost, executeRun, type RunContext, runPaths } from '../src/run'
import { ALL_ARMS, type AnswerRecord, CONDITION_IDS, type CorrectnessRecord, type Query, type RunConfig, type SearchRecord } from '../src/types'
import { readJson, writeJson, writeJsonl } from '../src/util'
import { ApiError, MockBackend, type ModelInfo } from '../src/venice'

const queries: Query[] = [
  { id: 'gold-1', slice: 'general', query: 'When did the upgrade happen?', goldAnswer: 'May 7, 2025' },
  {
    id: 'gold-2',
    slice: 'coding',
    subSlice: 'errors',
    style: 'error-string',
    query: 'ERR_REQUIRE_ESM',
    goldAnswer: 'Use import',
    goldUrls: ['https://nodejs.org/api/esm.html'],
    goldIdentifiers: ['import'],
  },
  { id: 'open-1', slice: 'general', query: 'best headphones 2026' },
  { id: 'broken', slice: 'coding', subSlice: 'errors', style: 'error-string', query: 'this search fails [mock-error]', goldAnswer: 'n/a' },
]

const makeConfig = (runId: string, overrides: Partial<RunConfig> = {}): RunConfig => ({
  runId,
  createdAt: '2026-10-28T12:00:00.000Z',
  datasets: ['test'],
  queryCount: queries.length,
  arms: [...ALL_ARMS],
  conditions: [...CONDITION_IDS],
  searchLimit: 10,
  models: { answer: 'mock-answer', judge: 'mock-judge' },
  answerThinking: 'off',
  answerMaxTokens: 8192,
  grading: { judge: true, citations: true, pairwise: true },
  pricing: { 'mock-answer': { inputUsdPerMillion: 1, outputUsdPerMillion: 4 } },
  mock: true,
  baseUrl: 'mock',
  ...overrides,
})

const dirs: string[] = []
afterAll(async () => {
  await Promise.all(dirs.map(dir => rm(dir, { recursive: true, force: true })))
})

async function setup(config: RunConfig, backend = new MockBackend()): Promise<RunContext & { backend: MockBackend }> {
  const runDir = await mkdtemp(join(tmpdir(), 'vsb-run-'))
  dirs.push(runDir)
  await writeJson(runPaths.config(runDir), config)
  await writeJsonl(runPaths.queries(runDir), queries)
  const models = new Map((await backend.models()).map(m => [m.id, m]))
  return { runDir, config, backend, models, concurrency: 2, log: () => {} }
}

describe('end-to-end with the mock backend', () => {
  let ctx: Awaited<ReturnType<typeof setup>>
  let firstCalls: MockBackend['calls']
  let data: Awaited<ReturnType<typeof loadRun>>

  beforeAll(async () => {
    ctx = await setup(makeConfig('e2e'))
    await executeRun(ctx, queries)
    firstCalls = { ...ctx.backend.calls }
    data = await loadRun(ctx.runDir)
  })

  test('searches every arm once per query', () => {
    expect(firstCalls.search).toBe(queries.length * 3)
    expect(data.search.size).toBe(queries.length * 3)
  })

  test('plans and stores every answer', () => {
    expect(answerJobs(ctx.config)).toHaveLength(10)
    expect(data.answers.size).toBe(queries.length * 10)
  })

  test('a failed search yields no answer and grades as not attempted', () => {
    for (const arm of ['brave', 'google', 'exa'] as const) {
      expect(data.search.get(`${arm}/broken`)?.status).toBe('error')
      expect(data.answers.get(`${arm}/native/broken`)?.status).toBe('search-error')
      expect(data.correctness.get(`${arm}/native/broken`)).toMatchObject({ label: 'NOT_ATTEMPTED', judgeModel: 'rule:search-error' })
    }
    expect(data.answers.get('none/native/broken')?.status).toBe('ok')
  })

  test('pairwise runs only on queries without a gold answer', () => {
    expect(data.pairwise.length).toBe(6)
    expect(new Set(data.pairwise.map(r => r.queryId))).toEqual(new Set(['open-1']))
  })

  test('correctness is graded for every gold answer that was produced', () => {
    const gold = queries.filter(q => q.goldAnswer)
    expect(data.correctness.size).toBe(gold.length * 10)
  })

  test('citations are checked for every search-backed answer with results', () => {
    const eligible = [...data.answers.values()].filter(a => a.arm !== 'none' && a.status === 'ok' && a.hitsUsed > 0)
    expect(data.citations.size).toBe(eligible.length)
  })

  test('report, CSV, and summary are written', async () => {
    const { report, files } = await writeReport(ctx.runDir)
    for (const heading of ['# Search benchmark: e2e', '## Answer accuracy', '## Equal-budget matrix', '## Retrieval quality', '## Speed, reliability, and cost', '## Paired comparisons', '## By slice', '## Coding', '## Pairwise preference', '## Citation support', '## Notes']) {
      expect(report).toContain(heading)
    }
    expect(report).toContain('mock backend, numbers are synthetic')
    const csv = await Bun.file(files[1] as string).text()
    expect(csv.trim().split('\n')).toHaveLength(1 + queries.length * 10)
    const summary = await readJson<{ arms: Record<string, unknown> }>(files[2] as string)
    expect(Object.keys(summary?.arms ?? {})).toEqual([...ALL_ARMS])
  })

  test('spend bills searches that did not fail and prices recorded usage', () => {
    const spend = runSpend(data)
    expect(spend.searchUsd).toBeCloseTo((queries.length - 1) * 3 * 0.01)
    const answers = [...data.answers.values()].reduce((n, a) => n + (a.usage ? (a.usage.promptTokens + 4 * a.usage.completionTokens) / 1e6 : 0), 0)
    expect(spend.answerUsd).toBeCloseTo(answers, 10)
    expect(spend.unpricedModels).toEqual(['mock-judge'])
  })

  test('resuming a finished run makes no API calls', async () => {
    const again = { ...ctx, backend: new MockBackend() }
    await executeRun(again, queries)
    expect(again.backend.calls).toEqual({ search: 0, chat: 0 })
  })

  test('resume retries failed answers and their grades, but not searches', async () => {
    const path = runPaths.answer(ctx.runDir, 'exa', 'native', 'gold-1')
    const answer = (await readJson<AnswerRecord>(path)) as AnswerRecord
    await writeJson(path, { ...answer, status: 'error', error: 'boom', content: '' })
    await writeJson(runPaths.correctness(ctx.runDir, 'exa', 'native', 'gold-1'), { queryId: 'gold-1', arm: 'exa', condition: 'native', label: null, error: 'stale' })
    const again = { ...ctx, backend: new MockBackend() }
    await executeRun(again, queries)
    expect(again.backend.calls.search).toBe(0)
    expect(again.backend.calls.chat).toBe(2)
    expect((await readJson<AnswerRecord>(path))?.status).toBe('ok')
    expect((await readJson<CorrectnessRecord>(runPaths.correctness(ctx.runDir, 'exa', 'native', 'gold-1')))?.label).not.toBeNull()
  })
})

describe('run options', () => {
  test('every provider searches the query as written', async () => {
    const ctx = await setup(makeConfig('as-written', { arms: ['brave', 'exa'], conditions: ['native'], grading: { judge: false, citations: false, pairwise: false } }))
    await executeRun(ctx, [{ ...(queries[1] as Query), query: '  ERR_REQUIRE_ESM  ' }])
    expect(ctx.backend.calls).toEqual({ search: 2, chat: 2 })
    for (const arm of ['brave', 'exa'] as const) {
      expect((await readJson<SearchRecord>(runPaths.search(ctx.runDir, arm, 'gold-2')))?.searchQuery).toBe('ERR_REQUIRE_ESM')
    }
  })

  test('a fatal API error stops the run', async () => {
    class BrokeBackend extends MockBackend {
      override async chat(): Promise<never> {
        throw new ApiError('Insufficient balance', 402)
      }
    }
    const ctx = await setup(makeConfig('fatal', { arms: ['brave'], conditions: ['native'] }), new BrokeBackend())
    await expect(executeRun(ctx, queries)).rejects.toThrow('Insufficient balance')
  })
})

describe('request construction', () => {
  const config = makeConfig('shape')
  const reasoning: ModelInfo = { id: 'mock-answer', supportsReasoning: true, supportsReasoningEffort: true, reasoningEffortOptions: ['none', 'high', 'max'] }

  test('answers run without Venice search, system prompt, or thinking', () => {
    const request = answerRequest({ config, models: new Map([['mock-answer', reasoning]]) }, 'hello')
    expect(request.messages).toEqual([
      { role: 'system', content: 'Current date: 2026-10-28.' },
      { role: 'user', content: 'hello' },
    ])
    expect(request.reasoning_effort).toBe('none')
    expect(request.venice_parameters).toMatchObject({ enable_web_search: 'off', include_venice_system_prompt: false, strip_thinking_response: true })
  })

  test('answer-thinking default leaves reasoning to the model', () => {
    const request = answerRequest({ config: { ...config, answerThinking: 'default' }, models: new Map([['mock-answer', reasoning]]) }, 'hello')
    expect(request.reasoning_effort).toBeUndefined()
  })

  test('answer prompts: none and empty results are closed-book; results come before the question', () => {
    const query = queries[0] as Query
    const search = (hits: SearchRecord['hits']): SearchRecord => ({ queryId: query.id, arm: 'exa', searchQuery: 'q', status: hits.length ? 'ok' : 'empty', latencyMs: 1, totalMs: 1, attempts: 1, hits, fetchedAt: '' })
    expect(answerPrompt(query, 'none', 'native', undefined)).toEqual({ content: query.query, hitsUsed: 0 })
    expect(answerPrompt(query, 'exa', 'native', search([]))).toEqual({ content: query.query, hitsUsed: 0 })
    const withHits = answerPrompt(query, 'exa', 'native', search([{ title: 'T', url: 'https://u.example', content: 'c', date: '' }]))
    expect(withHits.hitsUsed).toBe(1)
    expect(withHits.content).toEndWith(`${RESULTS_HEADING}\n\n[1] T\nURL: https://u.example\nc\n\nQuestion: ${query.query}`)
  })

  test('cost estimate counts searches and reports unpriced models', () => {
    const estimate = estimateCost(queries, config, new Map([['mock-answer', { id: 'mock-answer', inputUsdPerMillion: 1, outputUsdPerMillion: 4 }]]))
    expect(estimate.searches).toBe(queries.length * 3)
    expect(estimate.searchUsd).toBeCloseTo(0.12)
    expect(estimate.answerUsd).toBeGreaterThan(0)
    expect(estimate.unpricedModels).toEqual(['mock-judge'])
  })
})
