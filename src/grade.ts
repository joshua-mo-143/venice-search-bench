import { CORRECTNESS_LABELS, type CorrectnessLabel, type Query, type SearchHit, type Usage } from './types'
import { domainMatches, extractJsonObject, hostOf, normalizeText, normalizeUrl, truncateText } from './util'
import type { Backend, ChatRequest, ModelInfo } from './venice'
import { minimalThinking } from './venice'

export interface JudgeContext {
  backend: Backend
  model: string
  info: ModelInfo | undefined
  today: string
}

export interface JudgeResult<T> {
  value: T
  usage?: Usage
}

const ANSWER_CHAR_LIMIT = 12_000

export async function judgeJson<T>(
  ctx: JudgeContext,
  name: string,
  schema: Record<string, unknown>,
  system: string,
  user: string,
  validate: (value: unknown) => T,
): Promise<JudgeResult<T>> {
  const thinking = minimalThinking(ctx.info)
  const useSchema = ctx.info?.supportsResponseSchema !== false
  const request: ChatRequest = {
    model: ctx.model,
    messages: [
      { role: 'system', content: useSchema ? system : `${system}\n\nRespond with only a JSON object matching this JSON Schema:\n${JSON.stringify(schema)}` },
      { role: 'user', content: user },
    ],
    temperature: 0,
    max_completion_tokens: 4096,
    reasoning_effort: thinking.reasoning_effort,
    response_format: useSchema ? { type: 'json_schema', json_schema: { name, strict: true, schema } } : undefined,
    venice_parameters: { include_venice_system_prompt: false, enable_web_search: 'off', ...thinking.veniceParameters },
  }
  const result = await ctx.backend.chat(request)
  return { value: validate(extractJsonObject(result.content)), usage: result.usage }
}

const objectSchema = (properties: Record<string, unknown>): Record<string, unknown> => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
})

const field = (value: unknown, key: string): unknown => (value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined)

const CORRECTNESS_SYSTEM = `You grade answers for a question-answering benchmark. Given a question, a gold target, and a predicted answer, assign exactly one grade.

CORRECT: the predicted answer states the key facts of the gold target and contradicts none of them. Ignore wording, formatting, capitalisation, language, and extra detail that does not contradict the target. Rounded numbers are fine if the precision the question asks for is kept. Hedging is fine if the answer still clearly commits to the gold target.
INCORRECT: the answer contradicts the gold target, commits to a different answer, or lists several candidates without committing to the right one.
NOT_ATTEMPTED: the answer declines, says it does not know or could not find the information, asks for clarification, or otherwise fails to give the key facts, without contradicting the target.

If the question asks for several facts, all must be present for CORRECT. Ignore citation markers like ^1^. Grade only against the gold target, even if you believe it is outdated.`

export async function gradeCorrectness(ctx: JudgeContext, query: Query, answer: string): Promise<JudgeResult<CorrectnessLabel>> {
  const user = `Question: ${query.query}\n\nGold target: ${query.goldAnswer}\n\nPredicted answer:\n${truncateText(answer, ANSWER_CHAR_LIMIT)}`
  return judgeJson(ctx, 'correctness_grade', objectSchema({ grade: { type: 'string', enum: [...CORRECTNESS_LABELS] } }), CORRECTNESS_SYSTEM, user, value => {
    const grade = field(value, 'grade')
    if (!CORRECTNESS_LABELS.includes(grade as CorrectnessLabel)) throw new Error(`invalid grade ${JSON.stringify(grade)}`)
    return grade as CorrectnessLabel
  })
}

const RELEVANCE_SYSTEM = `You rate web search results for how well they serve a user's question. Score each result from 0 to 3:
3 = directly answers the question, or contains the key information from an authoritative source
2 = relevant and partially answers it
1 = on topic but would not help answer it
0 = irrelevant, spam, broken, or empty
Judge only the text shown. Return exactly one score per result, in the order given.`

/** Untruncated: page-length results often put the relevant passage below navigation and cookie banners. */
export const formatHitsForJudge = (hits: readonly SearchHit[]): string =>
  hits.map((hit, i) => `[${i + 1}] ${hit.title}\n${hit.url}\n${hit.content}`).join('\n\n')

export async function gradeRelevance(ctx: JudgeContext, query: Query, hits: readonly SearchHit[]): Promise<JudgeResult<number[]>> {
  const user = `Today's date: ${ctx.today}\nQuestion: ${query.query}\n\nResults:\n${formatHitsForJudge(hits)}`
  const schema = objectSchema({ scores: { type: 'array', items: { type: 'integer', enum: [0, 1, 2, 3] } } })
  return judgeJson(ctx, 'relevance_scores', schema, RELEVANCE_SYSTEM, user, value => {
    const scores = field(value, 'scores')
    if (!Array.isArray(scores) || scores.length < hits.length) throw new Error(`expected ${hits.length} scores`)
    return scores.slice(0, hits.length).map(score => {
      const n = Number(score)
      if (!Number.isInteger(n) || n < 0 || n > 3) throw new Error(`invalid score ${JSON.stringify(score)}`)
      return n
    })
  })
}

const CONTAINMENT_SYSTEM = `You check whether search results contain the answer to a question. Given the question, the gold answer, and the results, decide whether a careful reader could get the gold answer from the result text alone. Paraphrases and equivalent formats count. Do not use outside knowledge.`

export async function gradeAnswerInResults(ctx: JudgeContext, query: Query, hits: readonly SearchHit[]): Promise<JudgeResult<boolean>> {
  const user = `Question: ${query.query}\nGold answer: ${query.goldAnswer}\n\nResults:\n${formatHitsForJudge(hits)}`
  return judgeJson(ctx, 'answer_in_results', objectSchema({ contains: { type: 'boolean' } }), CONTAINMENT_SYSTEM, user, value => {
    const contains = field(value, 'contains')
    if (typeof contains !== 'boolean') throw new Error('missing contains')
    return contains
  })
}

export interface Claim {
  text: string
  indices: number[]
}

const CITATION_MARKER = /\^(\d+(?:\s*,\s*\d+)*)\^/g

/** Each caret citation closes a claim that starts after the previous citation or line break. */
export function parseCitations(answer: string): Claim[] {
  const claims: Claim[] = []
  let segmentStart = 0
  for (const match of answer.matchAll(CITATION_MARKER)) {
    const at = match.index ?? 0
    const lineStart = answer.lastIndexOf('\n', at - 1) + 1
    const text = answer.slice(Math.max(segmentStart, lineStart), at).trim()
    segmentStart = at + match[0].length
    const indices = [...new Set((match[1] ?? '').split(',').map(part => Number(part.trim())))]
    const previous = claims.at(-1)
    if (text.length > 0) claims.push({ text: text.slice(-500), indices })
    else if (previous) previous.indices = [...new Set([...previous.indices, ...indices])]
  }
  return claims
}

export const stripCitations = (answer: string): string => answer.replace(CITATION_MARKER, '')

const CITATION_SYSTEM = `You verify citations in an answer generated from web search results. For each numbered claim, decide whether the cited sources support it. A claim is supported only if the cited source text states or directly implies it. Partial support, related but different facts, and claims that need outside knowledge are not supported.`

export const MAX_CLAIMS = 12

export interface CitationScore {
  claims: number
  supported: number
  invalidCitations: number
}

export async function gradeCitations(ctx: JudgeContext, answer: string, hits: readonly SearchHit[]): Promise<JudgeResult<CitationScore>> {
  const all = parseCitations(answer)
  const invalidCitations = all.flatMap(claim => claim.indices).filter(i => i < 1 || i > hits.length).length
  const claims = all
    .slice(0, MAX_CLAIMS)
    .map(claim => ({ ...claim, indices: claim.indices.filter(i => i >= 1 && i <= hits.length) }))
    .filter(claim => claim.indices.length > 0)
  if (claims.length === 0) return { value: { claims: 0, supported: 0, invalidCitations } }

  const cited = [...new Set(claims.flatMap(claim => claim.indices))].sort((a, b) => a - b)
  const sources = cited
    .map(i => {
      const hit = hits[i - 1] as SearchHit
      return `[${i}] ${hit.title}\n${hit.url}\n${truncateText(hit.content, 2500)}`
    })
    .join('\n\n')
  const claimList = claims.map((claim, i) => `(${i + 1}) ${claim.text} [cites ${claim.indices.join(', ')}]`).join('\n')
  const user = `Sources:\n${sources}\n\nClaims:\n${claimList}`
  const schema = objectSchema({ supported: { type: 'array', items: { type: 'boolean' } } })
  return judgeJson(ctx, 'citation_support', schema, CITATION_SYSTEM, user, value => {
    const supported = field(value, 'supported')
    if (!Array.isArray(supported) || supported.length < claims.length) throw new Error(`expected ${claims.length} verdicts`)
    return { claims: claims.length, supported: supported.slice(0, claims.length).filter(v => v === true).length, invalidCitations }
  })
}

const PAIRWISE_SYSTEM = `You compare two answers to the same user question, as a careful expert user would. Prefer the answer that is more accurate, answers what was actually asked, is more current where recency matters, and avoids fabricated or unsupported specifics. Length, formatting, and confidence are not merits on their own. If neither is clearly better, answer TIE.`

export type PairwiseVote = 'A' | 'B' | 'TIE'

export async function judgePairwise(ctx: JudgeContext, query: Query, answerA: string, answerB: string): Promise<JudgeResult<PairwiseVote>> {
  const user = `Today's date: ${ctx.today}\nQuestion: ${query.query}\n\n[Answer A]\n${truncateText(stripCitations(answerA), ANSWER_CHAR_LIMIT)}\n\n[Answer B]\n${truncateText(stripCitations(answerB), ANSWER_CHAR_LIMIT)}`
  return judgeJson(ctx, 'pairwise_preference', objectSchema({ winner: { type: 'string', enum: ['A', 'B', 'TIE'] } }), PAIRWISE_SYSTEM, user, value => {
    const winner = field(value, 'winner')
    if (winner !== 'A' && winner !== 'B' && winner !== 'TIE') throw new Error(`invalid winner ${JSON.stringify(winner)}`)
    return winner
  })
}

/** Two votes with positions swapped; a split decision counts as a tie. */
export function combinePairwise<A extends string>(first: PairwiseVote, second: PairwiseVote, a: A, b: A): A | 'tie' {
  const score = (first === 'A' ? 1 : first === 'B' ? -1 : 0) + (second === 'B' ? 1 : second === 'A' ? -1 : 0)
  return score > 0 ? a : score < 0 ? b : 'tie'
}

export const AUTHORITATIVE_DOMAINS = [
  'github.com',
  'gitlab.com',
  'stackoverflow.com',
  'stackexchange.com',
  'npmjs.com',
  'pypi.org',
  'crates.io',
  'docs.rs',
  'pkg.go.dev',
  'go.dev',
  'developer.mozilla.org',
  'docs.python.org',
  'peps.python.org',
  'doc.rust-lang.org',
  'rust-lang.org',
  'nodejs.org',
  'typescriptlang.org',
  'react.dev',
  'nextjs.org',
  'docs.github.com',
  'docs.docker.com',
  'kubernetes.io',
  'docs.astral.sh',
  'readthedocs.io',
  'docs.venice.ai',
]

/** 1-based rank of the first gold URL; 0 when none match; null when the query has no gold URLs. */
export function goldUrlRank(hits: readonly SearchHit[], goldUrls: readonly string[] | undefined): number | null {
  if (!goldUrls?.length) return null
  const gold = new Set(goldUrls.map(normalizeUrl).filter((url): url is string => url !== null))
  const index = hits.findIndex(hit => {
    const url = normalizeUrl(hit.url)
    return url !== null && gold.has(url)
  })
  return index === -1 ? 0 : index + 1
}

export function goldDomainHit(hits: readonly SearchHit[], goldUrls: readonly string[] | undefined): boolean | null {
  if (!goldUrls?.length) return null
  const domains = goldUrls.map(hostOf).filter((host): host is string => host !== null)
  return hits.some(hit => {
    const host = hostOf(hit.url)
    return host !== null && domains.some(domain => domainMatches(host, domain))
  })
}

export function authoritativeShare(hits: readonly SearchHit[], extraDomains: readonly string[] = [], k = 5): number | null {
  const top = hits.slice(0, k)
  if (top.length === 0) return null
  const domains = [...AUTHORITATIVE_DOMAINS, ...extraDomains]
  const count = top.filter(hit => {
    const host = hostOf(hit.url)
    return host !== null && domains.some(domain => domainMatches(host, domain))
  }).length
  return count / top.length
}

/** Case-sensitive and verbatim: a renamed flag or misspelled API is a miss. */
export function identifierCoverage(text: string, identifiers: readonly string[] | undefined): number | null {
  if (!identifiers?.length) return null
  return identifiers.filter(identifier => text.includes(identifier)).length / identifiers.length
}

export function answerStringInResults(hits: readonly SearchHit[], goldAnswer: string | undefined): boolean | null {
  if (!goldAnswer) return null
  const gold = normalizeText(goldAnswer)
  if (gold.length < 3 || gold.length > 40) return null
  return normalizeText(hits.map(hit => `${hit.title} ${hit.content}`).join(' ')).includes(gold)
}

export const hitsText = (hits: readonly SearchHit[]): string => hits.map(hit => `${hit.title}\n${hit.content}`).join('\n')
