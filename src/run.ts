import { join } from 'node:path'
import { applyCondition, CONDITIONS } from './conditions'
import {
  combinePairwise,
  gradeAnswerInResults,
  gradeCitations,
  gradeCorrectness,
  gradeRelevance,
  type JudgeContext,
  judgePairwise,
} from './grade'
import { buildAnswerPrompt } from './prompt'
import {
  type AnswerRecord,
  type Arm,
  type CitationRecord,
  type ConditionId,
  type CorrectnessRecord,
  isSearchArm,
  type PairwiseRecord,
  type Query,
  type RetrievalJudgeRecord,
  type RunConfig,
  type SearchArm,
  type SearchRecord,
  type Usage,
} from './types'
import { fileSafe, hashString, mapPool, mulberry32, readJson, shuffle, writeJson } from './util'
import { ApiError, type Backend, type ChatRequest, type ModelInfo, minimalThinking, SEARCH_PRICE_USD, usageCostUsd } from './venice'

export const runPaths = {
  config: (dir: string) => join(dir, 'run.json'),
  queries: (dir: string) => join(dir, 'queries.jsonl'),
  search: (dir: string, arm: SearchArm, qid: string) => join(dir, 'search', arm, `${fileSafe(qid)}.json`),
  answer: (dir: string, arm: Arm, condition: ConditionId, qid: string) => join(dir, 'answers', arm, condition, `${fileSafe(qid)}.json`),
  correctness: (dir: string, arm: Arm, condition: ConditionId, qid: string) => join(dir, 'grades', 'correctness', arm, condition, `${fileSafe(qid)}.json`),
  retrieval: (dir: string, arm: SearchArm, qid: string) => join(dir, 'grades', 'retrieval', arm, `${fileSafe(qid)}.json`),
  citations: (dir: string, arm: SearchArm, condition: ConditionId, qid: string) => join(dir, 'grades', 'citations', arm, condition, `${fileSafe(qid)}.json`),
  pairwise: (dir: string, condition: ConditionId, a: Arm, b: Arm, qid: string) => join(dir, 'grades', 'pairwise', condition, `${a}-vs-${b}`, `${fileSafe(qid)}.json`),
}

export interface RunContext {
  runDir: string
  config: RunConfig
  backend: Backend
  models: ReadonlyMap<string, ModelInfo>
  concurrency: number
  log: (line: string) => void
}

export interface AnswerJob {
  arm: Arm
  condition: ConditionId
}

/** Every run plans the same jobs from config, so resume and report agree on what should exist. */
export function answerJobs(config: Pick<RunConfig, 'arms' | 'conditions'>): AnswerJob[] {
  return config.arms.flatMap<AnswerJob>(arm => (isSearchArm(arm) ? config.conditions.map(condition => ({ arm, condition })) : [{ arm, condition: 'native' }]))
}

export function pairwisePairs(arms: readonly Arm[]): [Arm, Arm][] {
  const pairs: [Arm, Arm][] = []
  for (let i = 0; i < arms.length; i++) for (let j = i + 1; j < arms.length; j++) pairs.push([arms[i] as Arm, arms[j] as Arm])
  return pairs
}

const runDate = (config: RunConfig): string => config.createdAt.slice(0, 10)

const isFatal = (error: unknown): boolean => error instanceof ApiError && error.fatal

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const addUsage = (a: Usage | undefined, b: Usage | undefined): Usage | undefined => {
  if (!a || !b) return a ?? b
  const cachedTokens = (a.cachedTokens ?? 0) + (b.cachedTokens ?? 0)
  const cacheWriteTokens = (a.cacheWriteTokens ?? 0) + (b.cacheWriteTokens ?? 0)
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    ...(cachedTokens ? { cachedTokens } : {}),
    ...(cacheWriteTokens ? { cacheWriteTokens } : {}),
  }
}

/** Search outcomes are measurements, so only failed model calls are retried on resume. */
async function cached<T>(path: string, retryIf: (existing: T) => boolean, compute: () => Promise<T>): Promise<T> {
  const existing = await readJson<T>(path)
  if (existing !== undefined && !retryIf(existing)) return existing
  const value = await compute()
  await writeJson(path, value)
  return value
}

const never = () => false
const hasError = (record: { error?: string }) => record.error !== undefined

async function runSearch(ctx: RunContext, query: Query, arm: SearchArm, searchQuery: string): Promise<SearchRecord> {
  const base = { queryId: query.id, arm, searchQuery }
  try {
    const result = await ctx.backend.search(searchQuery, arm, ctx.config.searchLimit)
    return {
      ...base,
      status: result.hits.length > 0 ? 'ok' : 'empty',
      httpStatus: result.httpStatus,
      latencyMs: result.latencyMs,
      totalMs: result.totalMs,
      attempts: result.attempts,
      hits: result.hits,
      fetchedAt: new Date().toISOString(),
    }
  } catch (error) {
    if (isFatal(error)) throw error
    return {
      ...base,
      status: 'error',
      httpStatus: error instanceof ApiError ? error.status : undefined,
      error: errorText(error),
      ...(error instanceof ApiError ? error.timing : { latencyMs: 0, totalMs: 0 }),
      attempts: error instanceof ApiError ? error.attempts : 1,
      hits: [],
      fetchedAt: new Date().toISOString(),
    }
  }
}

export function answerRequest(ctx: Pick<RunContext, 'config' | 'models'>, content: string): ChatRequest {
  const model = ctx.config.models.answer
  const thinking = ctx.config.answerThinking === 'off' ? minimalThinking(ctx.models.get(model)) : { veniceParameters: {} }
  return {
    model,
    messages: [
      { role: 'system', content: `Current date: ${runDate(ctx.config)}.` },
      { role: 'user', content },
    ],
    temperature: 0.2,
    max_completion_tokens: ctx.config.answerMaxTokens,
    reasoning_effort: thinking.reasoning_effort,
    venice_parameters: { enable_web_search: 'off', include_venice_system_prompt: false, strip_thinking_response: true, ...thinking.veniceParameters },
  }
}

/** Empty results fall back to a closed-book answer; failed searches never reach this point. */
export function answerPrompt(query: Query, arm: Arm, condition: ConditionId, search: SearchRecord | undefined): { content: string; hitsUsed: number } {
  if (arm === 'none' || !search) return { content: query.query, hitsUsed: 0 }
  const hits = applyCondition(search.hits, CONDITIONS[condition])
  if (hits.length === 0) return { content: query.query, hitsUsed: 0 }
  return { content: buildAnswerPrompt(query.query, hits), hitsUsed: hits.length }
}

async function runAnswer(ctx: RunContext, query: Query, arm: Arm, condition: ConditionId, search: SearchRecord | undefined): Promise<AnswerRecord> {
  const base = { queryId: query.id, arm, condition, model: ctx.config.models.answer }
  if (search?.status === 'error') return { ...base, status: 'search-error', content: '', latencyMs: 0, hitsUsed: 0, contextChars: 0 }
  const { content, hitsUsed } = answerPrompt(query, arm, condition, search)
  try {
    const result = await ctx.backend.chat(answerRequest(ctx, content))
    return { ...base, status: 'ok', content: result.content, usage: result.usage, latencyMs: result.latencyMs, hitsUsed, contextChars: content.length }
  } catch (error) {
    if (isFatal(error)) throw error
    return { ...base, status: 'error', error: errorText(error), content: '', latencyMs: 0, hitsUsed, contextChars: content.length }
  }
}

async function runCorrectness(judge: JudgeContext, query: Query, answer: AnswerRecord): Promise<CorrectnessRecord> {
  const base = { queryId: query.id, arm: answer.arm, condition: answer.condition }
  if (answer.status === 'search-error') return { ...base, label: 'NOT_ATTEMPTED', judgeModel: 'rule:search-error' }
  if (answer.content.trim() === '') return { ...base, label: 'NOT_ATTEMPTED', judgeModel: 'rule:empty-answer' }
  try {
    const result = await gradeCorrectness(judge, query, answer.content)
    return { ...base, label: result.value, judgeModel: judge.model, usage: result.usage }
  } catch (error) {
    if (isFatal(error)) throw error
    return { ...base, label: null, judgeModel: judge.model, error: errorText(error) }
  }
}

async function runRetrieval(judge: JudgeContext, query: Query, search: SearchRecord): Promise<RetrievalJudgeRecord> {
  const base = { queryId: query.id, arm: search.arm, judgeModel: judge.model }
  const top = search.hits.slice(0, 5)
  if (top.length === 0) return { ...base, relevance: [], answerInResults: query.goldAnswer ? false : null }
  try {
    const relevance = await gradeRelevance(judge, query, top)
    const containment = query.goldAnswer ? await gradeAnswerInResults(judge, query, top) : undefined
    return { ...base, relevance: relevance.value, answerInResults: containment?.value ?? null, usage: addUsage(relevance.usage, containment?.usage) }
  } catch (error) {
    if (isFatal(error)) throw error
    return { ...base, relevance: null, answerInResults: null, error: errorText(error) }
  }
}

async function runCitations(judge: JudgeContext, answer: AnswerRecord, search: SearchRecord): Promise<CitationRecord> {
  const base = { queryId: answer.queryId, arm: search.arm, condition: answer.condition, judgeModel: judge.model }
  try {
    const result = await gradeCitations(judge, answer.content, applyCondition(search.hits, CONDITIONS[answer.condition]))
    return { ...base, ...result.value, usage: result.usage }
  } catch (error) {
    if (isFatal(error)) throw error
    return { ...base, claims: 0, supported: 0, invalidCitations: 0, error: errorText(error) }
  }
}

async function runPairwise(judge: JudgeContext, query: Query, a: AnswerRecord, b: AnswerRecord): Promise<PairwiseRecord> {
  const base = { queryId: query.id, condition: a.condition, a: a.arm, b: b.arm, judgeModel: judge.model }
  const aEmpty = a.content.trim() === ''
  const bEmpty = b.content.trim() === ''
  if (aEmpty || bEmpty) return { ...base, winner: aEmpty && bEmpty ? 'tie' : aEmpty ? b.arm : a.arm, votes: ['rule:empty-answer'] }
  try {
    const first = await judgePairwise(judge, query, a.content, b.content)
    const second = await judgePairwise(judge, query, b.content, a.content)
    return { ...base, winner: combinePairwise(first.value, second.value, a.arm, b.arm), votes: [first.value, second.value], usage: addUsage(first.usage, second.usage) }
  } catch (error) {
    if (isFatal(error)) throw error
    return { ...base, winner: null, votes: [], error: errorText(error) }
  }
}

async function processQuery(ctx: RunContext, query: Query): Promise<string> {
  const { runDir, config, backend, models } = ctx
  const searchQuery = query.query.trim()
  const searchArms = config.arms.filter(isSearchArm)
  const searches = new Map<SearchArm, SearchRecord>()
  await Promise.all(
    shuffle(searchArms, mulberry32(hashString(`${config.runId}:${query.id}`))).map(async arm => {
      searches.set(arm, await cached(runPaths.search(runDir, arm, query.id), never, () => runSearch(ctx, query, arm, searchQuery)))
    }),
  )

  const answers = new Map<string, AnswerRecord>()
  await Promise.all(
    answerJobs(config).map(async ({ arm, condition }) => {
      const search = isSearchArm(arm) ? searches.get(arm) : undefined
      const record = await cached(runPaths.answer(runDir, arm, condition, query.id), (r: AnswerRecord) => r.status === 'error', () =>
        runAnswer(ctx, query, arm, condition, search),
      )
      answers.set(`${arm}/${condition}`, record)
    }),
  )

  const summary = searchArms.map(arm => `${arm}:${searches.get(arm)?.status}(${searches.get(arm)?.hits.length ?? 0})`).join(' ')
  const answerErrors = [...answers.values()].filter(a => a.status === 'error').length
  if (!config.grading.judge) return `${summary}${answerErrors ? ` answer-errors:${answerErrors}` : ''}`

  const judge: JudgeContext = { backend, model: config.models.judge, info: models.get(config.models.judge), today: runDate(config) }
  const jobs: Promise<unknown>[] = []
  if (query.goldAnswer) {
    for (const answer of answers.values()) {
      if (answer.status === 'error') continue
      jobs.push(cached(runPaths.correctness(runDir, answer.arm, answer.condition, query.id), hasError, () => runCorrectness(judge, query, answer)))
    }
  }
  for (const search of searches.values()) {
    if (search.status === 'error') continue
    jobs.push(cached(runPaths.retrieval(runDir, search.arm, query.id), hasError, () => runRetrieval(judge, query, search)))
  }
  if (config.grading.citations) {
    for (const answer of answers.values()) {
      const search = isSearchArm(answer.arm) ? searches.get(answer.arm) : undefined
      if (!search || answer.status !== 'ok' || answer.hitsUsed === 0) continue
      jobs.push(cached(runPaths.citations(runDir, search.arm, answer.condition, query.id), hasError, () => runCitations(judge, answer, search)))
    }
  }
  if (config.grading.pairwise && !query.goldAnswer) {
    for (const [armA, armB] of pairwisePairs(config.arms)) {
      const a = answers.get(`${armA}/native`)
      const b = answers.get(`${armB}/native`)
      if (!a || !b || a.status === 'error' || b.status === 'error') continue
      jobs.push(cached(runPaths.pairwise(runDir, 'native', armA, armB, query.id), hasError, () => runPairwise(judge, query, a, b)))
    }
  }
  await Promise.all(jobs)
  return `${summary}${answerErrors ? ` answer-errors:${answerErrors}` : ''}`
}

export async function executeRun(ctx: RunContext, queries: readonly Query[]): Promise<void> {
  let done = 0
  let fatal: unknown
  const width = String(queries.length).length
  await mapPool(queries, ctx.concurrency, async query => {
    if (fatal) return
    try {
      const summary = await processQuery(ctx, query)
      done++
      ctx.log(`[${String(done).padStart(width)}/${queries.length}] ${query.id}  ${summary}`)
    } catch (error) {
      fatal ??= error
    }
  })
  if (fatal) throw fatal
}

export interface CostEstimate {
  searches: number
  searchUsd: number
  answerUsd: number
  judgeUsd: number
  totalUsd: number
  unpricedModels: string[]
}

/** Typical answer prompt sizes (template plus results) at search limit 10; good for an order of magnitude, not an invoice. Ignores cache discounts. */
const PROMPT_TOKENS: Record<Arm, Record<ConditionId, number>> = {
  brave: { native: 4_000, 'k5-2k': 2_000, 'k5-8k': 2_400 },
  google: { native: 22_000, 'k5-2k': 2_600, 'k5-8k': 9_000 },
  exa: { native: 5_500, 'k5-2k': 2_200, 'k5-8k': 3_200 },
  none: { native: 50, 'k5-2k': 50, 'k5-8k': 50 },
}

/** Typical tokens in the full text of a provider's top 5 results, which both retrieval judges read. */
const TOP5_TOKENS: Record<SearchArm, number> = { brave: 3_300, google: 19_000, exa: 4_500 }

export function estimateCost(queries: readonly Query[], config: RunConfig, models: ReadonlyMap<string, ModelInfo>): CostEstimate {
  const unpriced = new Set<string>()
  const price = (model: string, promptTokens: number, completionTokens: number) => {
    const cost = usageCostUsd(models.get(model), { promptTokens, completionTokens })
    if (cost === null) unpriced.add(model)
    return cost ?? 0
  }
  const searchArms = config.arms.filter(isSearchArm)
  const gold = queries.filter(q => q.goldAnswer).length
  const noGold = queries.length - gold
  const jobs = answerJobs(config)
  const completion = config.answerThinking === 'off' ? 400 : 3_000
  const answerUsd = queries.length * jobs.reduce((sum, job) => sum + price(config.models.answer, PROMPT_TOKENS[job.arm][job.condition], completion), 0)
  let judgeUsd = 0
  if (config.grading.judge) {
    const judge = config.models.judge
    judgeUsd += gold * jobs.length * price(judge, 1_900, 150)
    for (const arm of searchArms) {
      judgeUsd += queries.length * price(judge, TOP5_TOKENS[arm], 650)
      judgeUsd += gold * price(judge, TOP5_TOKENS[arm], 60)
    }
    if (config.grading.citations) judgeUsd += queries.length * jobs.filter(j => isSearchArm(j.arm)).length * price(judge, 4_000, 200)
    if (config.grading.pairwise) judgeUsd += noGold * pairwisePairs(config.arms).length * 2 * price(judge, 2_500, 120)
  }
  const searches = queries.length * searchArms.length
  const searchUsd = searches * SEARCH_PRICE_USD
  return { searches, searchUsd, answerUsd, judgeUsd, totalUsd: searchUsd + answerUsd + judgeUsd, unpricedModels: [...unpriced] }
}
