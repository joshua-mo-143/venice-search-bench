export const SEARCH_ARMS = ['brave', 'google', 'exa'] as const
export type SearchArm = (typeof SEARCH_ARMS)[number]
export type Arm = SearchArm | 'none'
export const ALL_ARMS: readonly Arm[] = [...SEARCH_ARMS, 'none']

export const ARM_LABELS: Record<Arm, string> = {
  brave: 'brave',
  google: 'google',
  exa: 'exa',
  none: 'none (no search)',
}

export const isSearchArm = (arm: Arm): arm is SearchArm => arm !== 'none'

export const QUERY_STYLES = ['error-string', 'identifier', 'natural-language', 'version-pinned', 'keyword'] as const
export type QueryStyle = (typeof QUERY_STYLES)[number]

export interface Query {
  id: string
  slice: string
  subSlice?: string
  style?: QueryStyle
  language?: string
  tags?: string[]
  query: string
  goldAnswer?: string
  goldUrls?: string[]
  goldIdentifiers?: string[]
  authoritativeDomains?: string[]
  validAsOf?: string
  source?: string
  needsReview?: boolean
  notes?: string
}

export interface SearchHit {
  title: string
  url: string
  content: string
  date: string
}

export interface Usage {
  promptTokens: number
  completionTokens: number
  /** Cache reads and writes are subsets of `promptTokens`. */
  cachedTokens?: number
  cacheWriteTokens?: number
}

export interface SearchRecord {
  queryId: string
  arm: SearchArm
  searchQuery: string
  status: 'ok' | 'empty' | 'error'
  httpStatus?: number
  error?: string
  /** Duration of the final attempt only. */
  latencyMs: number
  /** Request time summed over every attempt; excludes the harness's own queueing, retry backoff, and 429 waits. */
  totalMs: number
  /** 429 rate-limit retries are not counted. */
  attempts: number
  hits: SearchHit[]
  fetchedAt: string
}

export const CONDITION_IDS = ['native', 'k5-2k', 'k5-8k'] as const
export type ConditionId = (typeof CONDITION_IDS)[number]

export interface AnswerRecord {
  queryId: string
  arm: Arm
  condition: ConditionId
  model: string
  /** `search-error`: the search failed, so there was nothing to answer from and no answer was requested. */
  status: 'ok' | 'error' | 'search-error'
  error?: string
  content: string
  usage?: Usage
  latencyMs: number
  hitsUsed: number
  contextChars: number
}

export const CORRECTNESS_LABELS = ['CORRECT', 'INCORRECT', 'NOT_ATTEMPTED'] as const
export type CorrectnessLabel = (typeof CORRECTNESS_LABELS)[number]

export interface CorrectnessRecord {
  queryId: string
  arm: Arm
  condition: ConditionId
  label: CorrectnessLabel | null
  judgeModel?: string
  usage?: Usage
  error?: string
}

export interface RetrievalJudgeRecord {
  queryId: string
  arm: SearchArm
  /** 0-3 per hit, top 5 native hits. */
  relevance: number[] | null
  answerInResults: boolean | null
  judgeModel: string
  usage?: Usage
  error?: string
}

export interface CitationRecord {
  queryId: string
  arm: SearchArm
  condition: ConditionId
  claims: number
  supported: number
  invalidCitations: number
  judgeModel: string
  usage?: Usage
  error?: string
}

export interface PairwiseRecord {
  queryId: string
  condition: ConditionId
  a: Arm
  b: Arm
  winner: Arm | 'tie' | null
  votes: string[]
  judgeModel: string
  usage?: Usage
  error?: string
}

export interface RunModels {
  answer: string
  judge: string
}

export interface ModelPrice {
  inputUsdPerMillion?: number
  outputUsdPerMillion?: number
  cacheInputUsdPerMillion?: number
  cacheWriteUsdPerMillion?: number
}

export interface RunConfig {
  runId: string
  createdAt: string
  datasets: string[]
  queryCount: number
  arms: Arm[]
  conditions: ConditionId[]
  searchLimit: number
  models: RunModels
  answerThinking: 'default' | 'off'
  answerMaxTokens: number
  grading: { judge: boolean; citations: boolean; pairwise: boolean }
  pricing: Record<string, ModelPrice>
  mock: boolean
  baseUrl: string
}
