import { type Lane, Lanes } from './limiter'
import { RESULTS_HEADING } from './prompt'
import type { ModelPrice, SearchArm, SearchHit, Usage } from './types'
import { estimateTokens, hashString, mulberry32, sleep, slugify } from './util'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatRequest {
  model: string
  messages: ChatMessage[]
  temperature?: number
  max_completion_tokens?: number
  reasoning_effort?: string
  response_format?: { type: 'json_schema'; json_schema: { name: string; strict: boolean; schema: unknown } }
  venice_parameters?: Record<string, unknown>
}

export interface ChatResult {
  content: string
  usage?: Usage
  latencyMs: number
  attempts: number
}

export interface SearchResponse {
  hits: SearchHit[]
  httpStatus: number
  latencyMs: number
  totalMs: number
  attempts: number
}

export interface ModelInfo extends ModelPrice {
  id: string
  privacy?: string
  supportsReasoning?: boolean
  supportsReasoningEffort?: boolean
  reasoningEffortOptions?: string[]
  supportsResponseSchema?: boolean
  supportsFunctionCalling?: boolean
}

const EFFORT_ORDER = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

/** Reasoning params that minimise thinking without sending values the model rejects (each rejection spends the unsupported-feature budget). */
export function minimalThinking(model: ModelInfo | undefined): Pick<ChatRequest, 'reasoning_effort'> & { veniceParameters: Record<string, unknown> } {
  if (!model?.supportsReasoning) return { veniceParameters: {} }
  const options = model.supportsReasoningEffort ? (model.reasoningEffortOptions ?? []) : []
  const lowest = [...options].sort((a, b) => EFFORT_ORDER.indexOf(a) - EFFORT_ORDER.indexOf(b))[0]
  if (lowest) return { reasoning_effort: lowest, veniceParameters: { strip_thinking_response: true } }
  return { veniceParameters: { disable_thinking: true, strip_thinking_response: true } }
}

export interface Backend {
  readonly kind: 'venice' | 'mock'
  search(query: string, provider: SearchArm, limit: number): Promise<SearchResponse>
  chat(request: ChatRequest): Promise<ChatResult>
  models(): Promise<ModelInfo[]>
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly attempts = 1,
    readonly timing = { latencyMs: 0, totalMs: 0 },
  ) {
    super(message)
  }

  /** Auth and balance failures will fail every remaining request too, so the run should stop. */
  get fatal(): boolean {
    return this.status === 401 || this.status === 402 || this.status === 403
  }
}

export const SEARCH_PRICE_USD = 0.01

/** Null when the model has no list price. Models without a cache rate bill cached tokens at the input rate. */
export function usageCostUsd(price: ModelPrice | undefined, usage: Usage): number | null {
  if (price?.inputUsdPerMillion === undefined || price.outputUsdPerMillion === undefined) return null
  const cached = usage.cachedTokens ?? 0
  const written = usage.cacheWriteTokens ?? 0
  const uncached = Math.max(0, usage.promptTokens - cached - written)
  return (
    (uncached * price.inputUsdPerMillion +
      cached * (price.cacheInputUsdPerMillion ?? price.inputUsdPerMillion) +
      written * (price.cacheWriteUsdPerMillion ?? price.inputUsdPerMillion) +
      usage.completionTokens * price.outputUsdPerMillion) /
    1e6
  )
}

const THINK_BLOCK = /<think>[\s\S]*?<\/think>\s*/g

/** Truncation can split a surrogate pair, and the API's JSON parser rejects the escaped lone half. */
const wellFormed = (_key: string, value: unknown) => (typeof value === 'string' ? value.toWellFormed() : value)

interface VeniceBackendOptions {
  apiKey: string
  baseUrl: string
  searchRpm: number
  chatRpm: number
  maxConcurrent: number
  timeoutMs?: number
  retryBaseMs?: number
}

interface RawResult<T> {
  data: T
  status: number
  latencyMs: number
  totalMs: number
  attempts: number
}

export class VeniceBackend implements Backend {
  readonly kind = 'venice' as const
  private readonly lanes: Lanes
  private modelCache: ModelInfo[] | undefined

  constructor(private readonly options: VeniceBackendOptions) {
    this.lanes = new Lanes({ rpm: options.chatRpm, maxConcurrent: options.maxConcurrent })
  }

  async search(query: string, provider: SearchArm, limit: number): Promise<SearchResponse> {
    const lane = this.lanes.get('search', { rpm: this.options.searchRpm })
    const result = await this.request<{ results?: SearchHit[] }>(lane, 'POST', '/augment/search', { query, limit, search_provider: provider }, 2, 60_000)
    const hits = (result.data.results ?? []).map(hit => ({
      title: String(hit.title ?? ''),
      url: String(hit.url ?? ''),
      content: String(hit.content ?? ''),
      date: String(hit.date ?? ''),
    }))
    return { hits, httpStatus: result.status, latencyMs: result.latencyMs, totalMs: result.totalMs, attempts: result.attempts }
  }

  async chat(request: ChatRequest): Promise<ChatResult> {
    const lane = this.lanes.get(`chat:${request.model}`)
    const result = await this.request<ChatCompletionResponse>(lane, 'POST', '/chat/completions', request, 3, this.options.timeoutMs ?? 180_000)
    const message = result.data.choices?.[0]?.message
    const content = typeof message?.content === 'string' ? message.content.replace(THINK_BLOCK, '').trim() : ''
    const raw = result.data.usage
    const details = raw?.prompt_tokens_details
    const usage: Usage | undefined = raw
      ? {
          promptTokens: raw.prompt_tokens ?? 0,
          completionTokens: raw.completion_tokens ?? 0,
          ...(details?.cached_tokens ? { cachedTokens: details.cached_tokens } : {}),
          ...(details?.cache_creation_input_tokens ? { cacheWriteTokens: details.cache_creation_input_tokens } : {}),
        }
      : undefined
    return { content, usage, latencyMs: result.latencyMs, attempts: result.attempts }
  }

  async models(): Promise<ModelInfo[]> {
    if (this.modelCache) return this.modelCache
    const lane = this.lanes.get('models', { rpm: 30 })
    const result = await this.request<{ data?: RawModel[] }>(lane, 'GET', '/models?type=text', undefined, 2, 30_000)
    this.modelCache = (result.data.data ?? []).map(model => ({
      id: model.id,
      privacy: model.model_spec?.privacy,
      inputUsdPerMillion: model.model_spec?.pricing?.input?.usd,
      outputUsdPerMillion: model.model_spec?.pricing?.output?.usd,
      cacheInputUsdPerMillion: model.model_spec?.pricing?.cache_input?.usd,
      cacheWriteUsdPerMillion: model.model_spec?.pricing?.cache_write?.usd,
      supportsReasoning: model.model_spec?.capabilities?.supportsReasoning,
      supportsReasoningEffort: model.model_spec?.capabilities?.supportsReasoningEffort,
      reasoningEffortOptions: model.model_spec?.capabilities?.reasoningEffortOptions,
      supportsResponseSchema: model.model_spec?.capabilities?.supportsResponseSchema,
      supportsFunctionCalling: model.model_spec?.capabilities?.supportsFunctionCalling,
    }))
    return this.modelCache
  }

  private async request<T>(lane: Lane, method: 'GET' | 'POST', path: string, body: unknown, maxRetries: number, timeoutMs: number): Promise<RawResult<T>> {
    let attempts = 0
    let rateLimitWaits = 0
    let wireMs = 0
    const timing = (lastMs: number) => ({ latencyMs: Math.round(lastMs), totalMs: Math.round(wireMs) })
    for (;;) {
      const outcome = await lane.run(async () => {
        const t0 = performance.now()
        try {
          const response = await fetch(`${this.options.baseUrl}${path}`, {
            method,
            headers: { Authorization: `Bearer ${this.options.apiKey}`, 'Content-Type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body, wellFormed),
            signal: AbortSignal.timeout(timeoutMs),
          })
          const text = await response.text()
          return { status: response.status, headers: response.headers, text, ms: performance.now() - t0 }
        } catch (error) {
          return { error: error as Error, ms: performance.now() - t0 }
        }
      })

      if (outcome.error) {
        attempts++
        wireMs += outcome.ms
        if (attempts <= maxRetries) {
          await sleep(this.backoffMs(attempts))
          continue
        }
        throw new ApiError(`${method} ${path} failed: ${outcome.error.message}`, 0, attempts, timing(outcome.ms))
      }

      this.respectFailureBudget(lane, outcome.headers)

      if (outcome.status === 429 && rateLimitWaits < 10) {
        rateLimitWaits++
        const resetAt = Number(outcome.headers.get('x-ratelimit-reset-requests'))
        const retryAfter = Number(outcome.headers.get('retry-after'))
        const waitMs = resetAt > Date.now() ? resetAt - Date.now() : retryAfter > 0 ? retryAfter * 1000 : this.backoffMs(rateLimitWaits)
        lane.pauseUntil(Date.now() + Math.min(waitMs, 65_000))
        continue
      }

      attempts++
      wireMs += outcome.ms
      if (outcome.status >= 200 && outcome.status < 300) {
        let data: T
        try {
          data = JSON.parse(outcome.text) as T
        } catch {
          throw new ApiError(`${method} ${path} returned invalid JSON`, outcome.status, attempts, timing(outcome.ms))
        }
        return { data, status: outcome.status, ...timing(outcome.ms), attempts }
      }

      if ((outcome.status >= 500 || outcome.status === 408) && attempts <= maxRetries) {
        await sleep(this.backoffMs(attempts))
        continue
      }
      const message = errorMessage(outcome.text) ?? `HTTP ${outcome.status}`
      throw new ApiError(`${method} ${path}: ${message}`, outcome.status, attempts, timing(outcome.ms))
    }
  }

  /** Venice blocks a key for 30s after 50 failed requests, so slow down before reaching that. */
  private respectFailureBudget(lane: Lane, headers: Headers): void {
    const remaining = headers.get('x-ratelimit-remaining')
    const resets = Number(headers.get('x-ratelimit-resets'))
    if (remaining !== null && Number(remaining) <= 5 && resets > Date.now()) lane.pauseUntil(resets)
  }

  private backoffMs(attempt: number): number {
    const base = this.options.retryBaseMs ?? 1000
    return base * 2 ** (attempt - 1) + Math.floor(Math.random() * base * 0.25)
  }
}

function errorMessage(text: string): string | undefined {
  try {
    const parsed = JSON.parse(text) as { error?: unknown; message?: unknown }
    const value = parsed.error ?? parsed.message
    if (typeof value === 'string') return value
    if (value && typeof value === 'object' && 'message' in value) return String((value as { message: unknown }).message)
  } catch {
    // fall through to raw text
  }
  return text.trim().slice(0, 300) || undefined
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string | null } }[]
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    prompt_tokens_details?: { cached_tokens?: number; cache_creation_input_tokens?: number } | null
  }
}

interface RawModel {
  id: string
  model_spec?: {
    privacy?: string
    pricing?: { input?: { usd?: number }; output?: { usd?: number }; cache_input?: { usd?: number }; cache_write?: { usd?: number } }
    capabilities?: {
      supportsReasoning?: boolean
      supportsReasoningEffort?: boolean
      reasoningEffortOptions?: string[]
      supportsResponseSchema?: boolean
      supportsFunctionCalling?: boolean
    }
  }
}

const MOCK_MODELS: ModelInfo[] = [
  'zai-org-glm-5-2',
  'grok-4-7',
  'mock-answer',
  'mock-judge',
].map(id => ({
  id,
  privacy: 'private',
  inputUsdPerMillion: 1,
  outputUsdPerMillion: 4,
  supportsReasoning: false,
  supportsResponseSchema: true,
  supportsFunctionCalling: true,
}))

/** Deterministic offline backend for tests and dry runs. Include `[mock-error]` in a query to simulate a provider failure. */
export class MockBackend implements Backend {
  readonly kind = 'mock' as const
  readonly calls = { search: 0, chat: 0 }

  async search(query: string, provider: SearchArm, limit: number): Promise<SearchResponse> {
    this.calls.search++
    if (query.includes('[mock-error]')) throw new ApiError('mock search failure', 500, 3)
    const rng = mulberry32(hashString(`${provider}:${query}`))
    const count = rng() < 0.08 ? 0 : limit
    const length = provider === 'brave' ? 220 : provider === 'google' ? 6000 : 2500
    const hits = Array.from({ length: count }, (_, i) => ({
      title: `${provider} result ${i + 1} for ${query.slice(0, 40)}`,
      url: `https://mock-${provider}.example/${slugify(query, 40)}/${i + 1}`,
      content: `${query} `.repeat(Math.ceil(length / (query.length + 1))).slice(0, length),
      date: rng() < 0.5 ? '2026-10-01' : '',
    }))
    const latencyMs = Math.round(200 + rng() * 800)
    return { hits, httpStatus: 200, latencyMs, totalMs: latencyMs, attempts: 1 }
  }

  async chat(request: ChatRequest): Promise<ChatResult> {
    this.calls.chat++
    const userText = request.messages.filter(m => m.role === 'user').map(m => m.content).join('\n')
    const rng = mulberry32(hashString(`${request.model}:${userText}`))
    const usage = { promptTokens: estimateTokens(request.messages.reduce((n, m) => n + m.content.length, 0)), completionTokens: 40 }
    const reply = (content: string): ChatResult => ({ content, usage, latencyMs: 5, attempts: 1 })
    const pick = <T>(options: readonly T[]): T => options[Math.floor(rng() * options.length)] as T
    switch (request.response_format?.json_schema.name) {
      case 'correctness_grade':
        return reply(JSON.stringify({ grade: pick(['CORRECT', 'CORRECT', 'INCORRECT', 'NOT_ATTEMPTED']) }))
      case 'relevance_scores': {
        const count = (userText.match(/^\[\d+\]/gm) ?? []).length
        return reply(JSON.stringify({ scores: Array.from({ length: count }, () => Math.floor(rng() * 4)) }))
      }
      case 'answer_in_results':
        return reply(JSON.stringify({ contains: rng() < 0.6 }))
      case 'citation_support': {
        const count = (userText.match(/^\(\d+\)/gm) ?? []).length
        return reply(JSON.stringify({ supported: Array.from({ length: count }, () => rng() < 0.7) }))
      }
      case 'pairwise_preference':
        return reply(JSON.stringify({ winner: pick(['A', 'B', 'TIE']) }))
      default:
        return reply(userText.includes(RESULTS_HEADING) ? 'Mock answer from the results.^1^ A second claim.^1,2^' : "I'm not sure.")
    }
  }

  async models(): Promise<ModelInfo[]> {
    return MOCK_MODELS
  }
}
