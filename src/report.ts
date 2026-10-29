import { join } from 'node:path'
import { applyCondition, CONDITIONS } from './conditions'
import { answerStringInResults, authoritativeShare, goldDomainHit, goldUrlRank, hitsText, identifierCoverage, MAX_CLAIMS, parseCitations } from './grade'
import { mcnemarExactP, mean, ndcgAtK, pairedBootstrapCI, percentile, precisionAtK, wilson } from './metrics'
import { answerJobs, pairwisePairs, runPaths } from './run'
import {
  ARM_LABELS,
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
import { readJson, readJsonl, writeJson } from './util'
import { SEARCH_PRICE_USD, usageCostUsd } from './venice'

export interface RunData {
  config: RunConfig
  queries: Query[]
  search: Map<string, SearchRecord>
  answers: Map<string, AnswerRecord>
  correctness: Map<string, CorrectnessRecord>
  retrieval: Map<string, RetrievalJudgeRecord>
  citations: Map<string, CitationRecord>
  pairwise: PairwiseRecord[]
}

const k2 = (arm: Arm, qid: string) => `${arm}/${qid}`
const k3 = (arm: Arm, condition: ConditionId, qid: string) => `${arm}/${condition}/${qid}`

/** Matches the top-5 cutoff of the judged metrics, so every provider is scored on the same number of results. */
const GOLD_URL_CUTOFF = 5
const withinGoldCutoff = (rank: number): boolean => rank >= 1 && rank <= GOLD_URL_CUTOFF

export async function loadRun(runDir: string): Promise<RunData> {
  const config = await readJson<RunConfig>(runPaths.config(runDir))
  if (!config) throw new Error(`${runDir} has no run.json`)
  const queries = await readJsonl<Query>(runPaths.queries(runDir))
  const data: RunData = {
    config,
    queries,
    search: new Map(),
    answers: new Map(),
    correctness: new Map(),
    retrieval: new Map(),
    citations: new Map(),
    pairwise: [],
  }
  const searchArms = config.arms.filter(isSearchArm)
  const put = async <T>(map: Map<string, T>, key: string, path: string) => {
    const value = await readJson<T>(path)
    if (value !== undefined) map.set(key, value)
  }
  await Promise.all(
    queries.map(async q => {
      const reads: Promise<void>[] = []
      for (const arm of searchArms) {
        reads.push(put(data.search, k2(arm, q.id), runPaths.search(runDir, arm, q.id)))
        reads.push(put(data.retrieval, k2(arm, q.id), runPaths.retrieval(runDir, arm, q.id)))
      }
      for (const { arm, condition } of answerJobs(config)) {
        reads.push(put(data.answers, k3(arm, condition, q.id), runPaths.answer(runDir, arm, condition, q.id)))
        reads.push(put(data.correctness, k3(arm, condition, q.id), runPaths.correctness(runDir, arm, condition, q.id)))
        if (isSearchArm(arm)) reads.push(put(data.citations, k3(arm, condition, q.id), runPaths.citations(runDir, arm, condition, q.id)))
      }
      for (const [a, b] of pairwisePairs(config.arms)) {
        reads.push(
          readJson<PairwiseRecord>(runPaths.pairwise(runDir, 'native', a, b, q.id)).then(record => {
            if (record) data.pairwise.push(record)
          }),
        )
      }
      await Promise.all(reads)
    }),
  )
  return data
}

const pct = (value: number | null | undefined, digits = 1): string => (value === null || value === undefined ? '—' : `${(100 * value).toFixed(digits)}%`)
const num = (value: number | null | undefined, digits = 2): string => (value === null || value === undefined ? '—' : value.toFixed(digits))
const usd = (value: number | null | undefined): string => (value === null || value === undefined ? '—' : `$${value.toFixed(2)}`)
const ms = (value: number | null | undefined): string => (value === null || value === undefined ? '—' : `${Math.round(value)}`)
const ratio = (part: number, whole: number): number | null => (whole === 0 ? null : part / whole)

function table(headers: string[], rows: string[][], numericFrom = 1): string {
  const align = headers.map((_, i) => (i >= numericFrom ? '---:' : '---'))
  return [`| ${headers.join(' | ')} |`, `| ${align.join(' | ')} |`, ...rows.map(row => `| ${row.join(' | ')} |`)].join('\n')
}

const isCorrect = (record: CorrectnessRecord | undefined): number | null => (record?.label ? (record.label === 'CORRECT' ? 1 : 0) : null)

export interface RetrievalScore {
  p5: number
  ndcg5: number
}

/** Errors and empty results score zero so every arm is scored on the same queries. */
export function retrievalScore(data: RunData, arm: SearchArm, qid: string): RetrievalScore | null {
  const search = data.search.get(k2(arm, qid))
  if (!search) return null
  if (search.status !== 'ok') return { p5: 0, ndcg5: 0 }
  const judged = data.retrieval.get(k2(arm, qid))
  if (!judged?.relevance) return null
  return { p5: precisionAtK(judged.relevance, 5), ndcg5: ndcgAtK(judged.relevance, 5) }
}

const answerArms = (config: RunConfig, condition: ConditionId): Arm[] => config.arms.filter(arm => isSearchArm(arm) || condition === 'native')

interface AccuracyStats {
  n: number
  correct: number
  incorrect: number
  notAttempted: number
  answerErrors: number
}

function accuracy(data: RunData, arm: Arm, condition: ConditionId, queries: readonly Query[]): AccuracyStats {
  const stats: AccuracyStats = { n: 0, correct: 0, incorrect: 0, notAttempted: 0, answerErrors: 0 }
  for (const q of queries) {
    if (!q.goldAnswer) continue
    if (data.answers.get(k3(arm, condition, q.id))?.status === 'error') stats.answerErrors++
    const label = data.correctness.get(k3(arm, condition, q.id))?.label
    if (!label) continue
    stats.n++
    if (label === 'CORRECT') stats.correct++
    else if (label === 'INCORRECT') stats.incorrect++
    else stats.notAttempted++
  }
  return stats
}

function accuracySection(data: RunData): string {
  const rows: string[][] = []
  for (const condition of data.config.conditions) {
    for (const arm of answerArms(data.config, condition)) {
      const s = accuracy(data, arm, condition, data.queries)
      const ci = wilson(s.correct, s.n)
      rows.push([
        ARM_LABELS[arm],
        CONDITIONS[condition].label,
        String(s.n),
        pct(ratio(s.correct, s.n)),
        ci ? `${pct(ci.lo)} – ${pct(ci.hi)}` : '—',
        pct(ratio(s.incorrect, s.n)),
        pct(ratio(s.notAttempted, s.n)),
        pct(ratio(s.correct, s.correct + s.incorrect)),
        String(s.answerErrors),
      ])
    }
  }
  return [
    '## Answer accuracy (queries with a gold answer)',
    '',
    'Graded CORRECT / INCORRECT / NOT_ATTEMPTED by the judge model. Answers whose search failed count as not attempted. Answer errors are excluded from n.',
    '',
    table(['Arm', 'Condition', 'n', 'Correct', '95% CI', 'Incorrect', 'Not attempted', 'Correct when attempted', 'Answer errors'], rows, 2),
  ].join('\n')
}

function equalBudgetSection(data: RunData): string {
  const conditions = data.config.conditions
  const rows = data.config.arms.map(arm => [
    ARM_LABELS[arm],
    ...conditions.map(condition => {
      if (!isSearchArm(arm) && condition !== 'native') return '—'
      const s = accuracy(data, arm, condition, data.queries)
      return s.n === 0 ? '—' : `${pct(ratio(s.correct, s.n), 0)} (n=${s.n})`
    }),
  ])
  return [
    '## Equal-budget matrix: correct answers',
    '',
    'Same answers as above, arranged so each column gives every provider the same number of results and the same token budget (except native). Budgets keep the start of each result and cut the rest.',
    '',
    table(['Arm', ...conditions.map(c => CONDITIONS[c].label)], rows),
  ].join('\n')
}

function retrievalSection(data: RunData): string {
  const rows: string[][] = []
  for (const arm of data.config.arms.filter(isSearchArm)) {
    const searches = data.queries.map(q => data.search.get(k2(arm, q.id))).filter((s): s is SearchRecord => s !== undefined)
    const ok = searches.filter(s => s.status === 'ok')
    const scores = data.queries.map(q => retrievalScore(data, arm, q.id)).filter((s): s is RetrievalScore => s !== null)
    const gold = data.queries.filter(q => q.goldAnswer)
    const inResults = gold.map(q => data.retrieval.get(k2(arm, q.id))?.answerInResults).filter((v): v is boolean => typeof v === 'boolean')
    const stringHits = gold
      .map(q => {
        const search = data.search.get(k2(arm, q.id))
        return search ? answerStringInResults(search.hits, q.goldAnswer) : null
      })
      .filter((v): v is boolean => v !== null)
    const ranks = data.queries
      .map(q => {
        const search = data.search.get(k2(arm, q.id))
        return search ? goldUrlRank(search.hits, q.goldUrls) : null
      })
      .filter((v): v is number => v !== null)
    rows.push([
      ARM_LABELS[arm],
      String(searches.length),
      pct(ratio(searches.filter(s => s.status === 'empty').length, searches.length)),
      pct(ratio(searches.filter(s => s.status === 'error').length, searches.length)),
      num(mean(ok.map(s => s.hits.length)), 1),
      num(mean(ok.map(s => s.hits.reduce((n, h) => n + h.content.length, 0))), 0),
      num(mean(scores.map(s => s.p5))),
      num(mean(scores.map(s => s.ndcg5))),
      inResults.length ? `${pct(ratio(inResults.filter(Boolean).length, inResults.length))} (n=${inResults.length})` : '—',
      stringHits.length ? `${pct(ratio(stringHits.filter(Boolean).length, stringHits.length))} (n=${stringHits.length})` : '—',
      ranks.length ? `${pct(ratio(ranks.filter(withinGoldCutoff).length, ranks.length))} (n=${ranks.length})` : '—',
      ranks.length ? num(mean(ranks.map(r => (withinGoldCutoff(r) ? 1 / r : 0)))) : '—',
    ])
  }
  return [
    '## Retrieval quality (results as returned)',
    '',
    `The judge reads the full text of each of the top 5 results. P@5 counts results it scored 2 or 3; nDCG@5 is normalised against five perfect results. Errors and empty results score 0. "Answer in results" asks the judge whether the gold answer can be read from the top 5 results; "gold string" is an exact normalised match against all returned text. Gold URL hit and MRR also stop at rank ${GOLD_URL_CUTOFF}, so every provider is scored on the same number of results.`,
    '',
    table(['Arm', 'n', 'Empty', 'Errors', 'Mean results', 'Mean content chars', 'P@5', 'nDCG@5', 'Answer in results', 'Gold string in results', `Gold URL hit@${GOLD_URL_CUTOFF}`, `MRR@${GOLD_URL_CUTOFF}`], rows),
  ].join('\n')
}

export interface RunSpend {
  searchUsd: number
  answerUsd: number
  judgeUsd: number
  totalUsd: number
  cachedTokens: number
  unpricedModels: string[]
}

/** Failed searches are free and empty ones are billed. */
export function runSpend(data: RunData): RunSpend {
  const unpriced = new Set<string>()
  let cachedTokens = 0
  const cost = (model: string | undefined, usage: Usage | undefined): number => {
    if (!model || !usage) return 0
    cachedTokens += usage.cachedTokens ?? 0
    const usd = usageCostUsd(data.config.pricing[model], usage)
    if (usd === null) unpriced.add(model)
    return usd ?? 0
  }
  const sum = <T>(records: Iterable<T>, value: (record: T) => number) => [...records].reduce((total, record) => total + value(record), 0)
  const searchUsd = sum(data.search.values(), s => (s.status === 'error' ? 0 : SEARCH_PRICE_USD))
  const answerUsd = sum(data.answers.values(), a => cost(a.model, a.usage))
  const judgeUsd =
    sum(data.correctness.values(), g => cost(g.judgeModel, g.usage)) +
    sum(data.retrieval.values(), g => cost(g.judgeModel, g.usage)) +
    sum(data.citations.values(), g => cost(g.judgeModel, g.usage)) +
    sum(data.pairwise, g => cost(g.judgeModel, g.usage))
  return { searchUsd, answerUsd, judgeUsd, totalUsd: searchUsd + answerUsd + judgeUsd, cachedTokens, unpricedModels: [...unpriced] }
}

function speedSection(data: RunData): string {
  const rows: string[][] = []
  for (const arm of data.config.arms) {
    const answers = data.queries.map(q => data.answers.get(k3(arm, 'native', q.id))).filter((a): a is AnswerRecord => a?.status === 'ok')
    const promptTokens = mean(answers.map(a => a.usage?.promptTokens ?? 0))
    const completionTokens = mean(answers.map(a => a.usage?.completionTokens ?? 0))
    const answerCost = promptTokens === null || completionTokens === null ? null : usageCostUsd(data.config.pricing[data.config.models.answer], { promptTokens, completionTokens })
    const answerPer1k = answerCost === null ? null : answerCost * 1000
    if (!isSearchArm(arm)) {
      rows.push([ARM_LABELS[arm], '—', '—', '—', '—', '—', '—', '—', '—', usd(0), num(promptTokens, 0), usd(answerPer1k), usd(answerPer1k)])
      continue
    }
    const searches = data.queries.map(q => data.search.get(k2(arm, q.id))).filter((s): s is SearchRecord => s !== undefined)
    const answered = searches.filter(s => s.status !== 'error')
    const latencies = answered.map(s => s.latencyMs)
    const searchPer1k = SEARCH_PRICE_USD * 1000
    rows.push([
      ARM_LABELS[arm],
      String(searches.length),
      ms(percentile(latencies, 50)),
      ms(percentile(latencies, 90)),
      ms(percentile(latencies, 99)),
      ms(mean(searches.map(s => s.totalMs))),
      num(mean(searches.map(s => s.attempts))),
      pct(ratio(searches.filter(s => s.status === 'error').length, searches.length)),
      pct(ratio(searches.filter(s => s.status === 'empty').length, searches.length)),
      usd(searchPer1k),
      num(promptTokens, 0),
      usd(answerPer1k),
      answerPer1k === null ? '—' : usd(searchPer1k + answerPer1k),
    ])
  }
  return [
    '## Speed, reliability, and cost',
    '',
    `Latency is client-side through the Venice API, so it includes Venice and network overhead; compare arms against each other rather than against provider benchmarks. Percentiles time the final attempt; "all attempts" adds time spent on failed attempts. Neither includes the harness's own rate limiting or retry backoff. Cost per 1,000 queries uses the native condition and ${data.config.models.answer} list pricing at run time, with no cache discount because search results differ on every request.`,
    '',
    table(['Arm', 'Searches', 'p50 ms', 'p90 ms', 'p99 ms', 'Mean ms, all attempts', 'Mean attempts', 'Errors', 'Empty', 'Search $/1k', 'Mean answer prompt tokens', 'Answer $/1k', 'Total $/1k'], rows),
  ].join('\n')
}

interface PairedRow {
  label: string
  a: Arm
  b: Arm
  condition: ConditionId
}

function pairedCorrectness(data: RunData, pair: PairedRow): string[] | null {
  const aVals: number[] = []
  const bVals: number[] = []
  let onlyA = 0
  let onlyB = 0
  for (const q of data.queries) {
    const a = isCorrect(data.correctness.get(k3(pair.a, pair.condition, q.id)))
    const b = isCorrect(data.correctness.get(k3(pair.b, pair.condition, q.id)))
    if (a === null || b === null) continue
    aVals.push(a)
    bVals.push(b)
    if (a > b) onlyA++
    if (b > a) onlyB++
  }
  const ci = pairedBootstrapCI(aVals, bVals)
  if (!ci) return null
  const pp = (x: number) => `${x >= 0 ? '+' : ''}${(100 * x).toFixed(1)}`
  return [pair.label, CONDITIONS[pair.condition].label, String(ci.n), pp(ci.delta), `${pp(ci.lo)} – ${pp(ci.hi)}`, String(onlyA), String(onlyB), mcnemarExactP(onlyA, onlyB).toFixed(3)]
}

function pairedRetrieval(data: RunData, a: SearchArm, b: SearchArm): string[] | null {
  const aVals: number[] = []
  const bVals: number[] = []
  for (const q of data.queries) {
    const sa = retrievalScore(data, a, q.id)
    const sb = retrievalScore(data, b, q.id)
    if (!sa || !sb) continue
    aVals.push(sa.ndcg5)
    bVals.push(sb.ndcg5)
  }
  const ci = pairedBootstrapCI(aVals, bVals)
  if (!ci) return null
  const signed = (x: number) => `${x >= 0 ? '+' : ''}${x.toFixed(3)}`
  return [`${a} vs ${b}`, String(ci.n), signed(ci.delta), `${signed(ci.lo)} – ${signed(ci.hi)}`]
}

function pairedSection(data: RunData): string {
  const correctnessRows: string[][] = []
  for (const condition of data.config.conditions) {
    for (const [a, b] of pairwisePairs(answerArms(data.config, condition))) {
      const row = pairedCorrectness(data, { label: `${a} vs ${b}`, a, b, condition })
      if (row) correctnessRows.push(row)
    }
  }
  const retrievalRows = pairwisePairs(data.config.arms.filter(isSearchArm))
    .map(([a, b]) => pairedRetrieval(data, a as SearchArm, b as SearchArm))
    .filter((row): row is string[] => row !== null)
  return [
    '## Paired comparisons',
    '',
    'Each comparison uses only queries both arms have a grade for. Δ is the first arm minus the second, with a 95% paired bootstrap interval. "Only A/B correct" are the discordant pairs behind the exact McNemar p-value. Intervals that cross 0 are not a measured difference.',
    '',
    correctnessRows.length
      ? table(['Pair (A vs B)', 'Condition', 'n', 'Δ correct (pp)', '95% CI (pp)', 'Only A correct', 'Only B correct', 'McNemar p'], correctnessRows, 2)
      : '_No graded gold-answer queries yet._',
    '',
    '### Retrieval nDCG@5',
    '',
    retrievalRows.length ? table(['Pair (A vs B)', 'n', 'Δ nDCG@5', '95% CI'], retrievalRows) : '_No judged retrieval yet._',
  ].join('\n')
}

function sliceSection(data: RunData): string {
  const slices = [...new Set(data.queries.map(q => q.slice))].sort()
  const arms = data.config.arms
  const searchArms = arms.filter(isSearchArm)
  const rows = slices.map(slice => {
    const queries = data.queries.filter(q => q.slice === slice)
    return [
      slice,
      String(queries.length),
      ...arms.map(arm => {
        const s = accuracy(data, arm, 'native', queries)
        return s.n === 0 ? '—' : pct(ratio(s.correct, s.n), 0)
      }),
      ...searchArms.map(arm => num(mean(queries.map(q => retrievalScore(data, arm, q.id)?.ndcg5).filter((v): v is number => v !== undefined)))),
    ]
  })
  return [
    '## By slice (native)',
    '',
    table(['Slice', 'n', ...arms.map(arm => `${arm} correct`), ...searchArms.map(arm => `${arm} nDCG@5`)], rows),
  ].join('\n')
}

interface CodingMetrics {
  correct: number | null
  ndcg5: number | null
  goldUrlHit: number | null
  authoritative: number | null
  identifiersInResults: number | null
  identifiersInAnswer: number | null
}

function codingMetrics(data: RunData, arm: Arm, queries: readonly Query[]): CodingMetrics {
  const s = accuracy(data, arm, 'native', queries)
  const values = (fn: (q: Query) => number | null | undefined) => mean(queries.map(fn).filter((v): v is number => typeof v === 'number'))
  const search = (q: Query) => (isSearchArm(arm) ? data.search.get(k2(arm, q.id)) : undefined)
  return {
    correct: ratio(s.correct, s.n),
    ndcg5: isSearchArm(arm) ? values(q => retrievalScore(data, arm, q.id)?.ndcg5) : null,
    goldUrlHit: values(q => {
      const hits = search(q)?.hits
      const rank = hits ? goldUrlRank(hits, q.goldUrls) : null
      return rank === null ? null : withinGoldCutoff(rank) ? 1 : 0
    }),
    authoritative: values(q => {
      const hits = search(q)?.hits
      return hits ? authoritativeShare(hits, q.authoritativeDomains) : null
    }),
    identifiersInResults: values(q => {
      const hits = search(q)?.hits
      return hits ? identifierCoverage(hitsText(hits), q.goldIdentifiers) : null
    }),
    identifiersInAnswer: values(q => {
      const answer = data.answers.get(k3(arm, 'native', q.id))
      return answer?.status === 'ok' ? identifierCoverage(answer.content, q.goldIdentifiers) : null
    }),
  }
}

function codingSection(data: RunData): string | null {
  const coding = data.queries.filter(q => q.slice === 'coding')
  if (coding.length === 0) return null
  const block = (title: string, key: (q: Query) => string | undefined) => {
    const groups = [...new Set(coding.map(q => key(q) ?? 'untagged'))].sort()
    const rows: string[][] = []
    for (const group of groups) {
      const queries = coding.filter(q => (key(q) ?? 'untagged') === group)
      for (const arm of data.config.arms) {
        const m = codingMetrics(data, arm, queries)
        rows.push([group, arm, String(queries.length), pct(m.correct, 0), num(m.ndcg5), pct(m.goldUrlHit, 0), pct(m.authoritative, 0), pct(m.identifiersInResults, 0), pct(m.identifiersInAnswer, 0)])
      }
    }
    return [`### By ${title}`, '', table([title, 'Arm', 'n', 'Correct', 'nDCG@5', `Gold URL hit@${GOLD_URL_CUTOFF}`, 'Authoritative share (top 5)', 'Identifiers in results', 'Identifiers in answer'], rows, 2)].join('\n')
  }
  return [
    '## Coding',
    '',
    'Authoritative share counts top-5 results from official docs, registries, and code hosts (plus per-query domains). Identifier coverage is case-sensitive and verbatim, so a renamed flag or misspelled API is a miss.',
    '',
    block('sub-slice', q => q.subSlice),
    '',
    block('style', q => q.style),
  ].join('\n')
}

function pairwiseSection(data: RunData): string | null {
  if (data.pairwise.length === 0) return null
  const rows = pairwisePairs(data.config.arms).flatMap(([a, b]) => {
    const records = data.pairwise.filter(r => r.a === a && r.b === b && r.winner !== null)
    if (records.length === 0) return []
    const aWins = records.filter(r => r.winner === a).length
    const bWins = records.filter(r => r.winner === b).length
    const ties = records.length - aWins - bWins
    return [[`${a} vs ${b}`, String(records.length), String(aWins), String(ties), String(bWins), pct(ratio(aWins, aWins + bWins), 0)]]
  })
  return [
    '## Pairwise preference (queries without a gold answer, native)',
    '',
    'Each pair is judged twice with positions swapped; a split decision counts as a tie. Citation markers are stripped so the judge cannot tell which answers had search.',
    '',
    table(['Pair (A vs B)', 'n', 'A wins', 'Ties', 'B wins', 'A win rate excl. ties'], rows),
  ].join('\n')
}

function citationSection(data: RunData): string | null {
  if (data.citations.size === 0) return null
  const rows: string[][] = []
  for (const condition of data.config.conditions) {
    for (const arm of data.config.arms.filter(isSearchArm)) {
      const records = data.queries.map(q => data.citations.get(k3(arm, condition, q.id))).filter((r): r is CitationRecord => r !== undefined && !r.error)
      if (records.length === 0) continue
      const claims = records.reduce((n, r) => n + r.claims, 0)
      const supported = records.reduce((n, r) => n + r.supported, 0)
      rows.push([
        arm,
        CONDITIONS[condition].label,
        String(records.length),
        String(claims),
        pct(ratio(supported, claims)),
        num(mean(records.map(r => r.invalidCitations))),
        pct(ratio(records.filter(r => r.claims === 0).length, records.length)),
      ])
    }
  }
  return [
    '## Citation support',
    '',
    `Up to ${MAX_CLAIMS} cited claims per answer are checked against the sources the answer saw.`,
    '',
    table(['Arm', 'Condition', 'Answers', 'Claims checked', 'Supported', 'Invalid citations per answer', 'Answers without citations'], rows, 2),
  ].join('\n')
}

function headerSection(data: RunData): string {
  const { config, queries } = data
  const slices = [...new Set(queries.map(q => q.slice))].sort()
  const missingAnswers = queries.length * answerJobs(config).length - data.answers.size
  const spend = runSpend(data)
  const bullets = [
    `Created: ${config.createdAt}${config.mock ? ' — **mock backend, numbers are synthetic**' : ''}`,
    `Queries: ${queries.length} (${queries.filter(q => q.goldAnswer).length} with gold answers) across ${slices.join(', ')}, sent to every provider as written`,
    `Arms: ${config.arms.map(arm => ARM_LABELS[arm]).join(', ')}; search limit ${config.searchLimit}`,
    `Models: answer \`${config.models.answer}\` (thinking ${config.answerThinking}), judge \`${config.models.judge}\``,
    config.mock
      ? null
      : `Spend: ${usd(spend.totalUsd)} (search ${usd(spend.searchUsd)}, answers ${usd(spend.answerUsd)}, judge ${usd(spend.judgeUsd)}), priced from recorded token usage ${spend.cachedTokens ? `with ${spend.cachedTokens.toLocaleString('en-US')} cache-read tokens at the discounted rate` : 'at list prices (no cache reads recorded, so this can overstate the bill)'}${spend.unpricedModels.length ? `; no pricing for ${spend.unpricedModels.join(', ')}` : ''}`,
    missingAnswers > 0 ? `**Incomplete run:** ${missingAnswers} planned answers missing; resume with \`bun run bench run --resume ${config.runId}\`` : null,
  ]
  return [`# Search benchmark: ${config.runId}`, '', ...bullets.flatMap(b => (b ? [`- ${b}`] : []))].join('\n')
}

const NOTES = `## Notes

- Providers return different numbers of results and different amounts of text per result (see "Mean results" and "Mean content chars"). The budgeted conditions even out that volume, but because they keep the start of each result, they work against results whose useful text sits further down the page.
- Empty results get a closed-book answer, and failed searches count as not attempted.
- Grades come from an LLM judge. Spot-check \`results.csv\` and the per-query JSON before trusting small differences.
- Search results are a snapshot at fetch time, and gold answers can go stale; check \`validAsOf\` on time-sensitive queries.`

export function renderReport(data: RunData): string {
  const sections = [
    headerSection(data),
    accuracySection(data),
    equalBudgetSection(data),
    retrievalSection(data),
    speedSection(data),
    pairedSection(data),
    sliceSection(data),
    codingSection(data),
    pairwiseSection(data),
    citationSection(data),
    NOTES,
  ]
  return `${sections.filter((s): s is string => s !== null).join('\n\n')}\n`
}

const csvCell = (value: unknown): string => {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function renderCsv(data: RunData): string {
  const header = [
    'queryId', 'slice', 'subSlice', 'style', 'language', 'arm', 'condition', 'searchStatus', 'searchQuery', 'hits', 'contentChars',
    'searchLatencyMs', 'searchTotalMs', 'searchAttempts', 'answerStatus', 'correctness', 'relevance', 'p5', 'ndcg5', 'answerInResults',
    'goldStringInResults', 'goldUrlRank', 'goldDomainHit', 'authoritativeShare', 'identifiersInResults', 'identifiersInAnswer',
    'citationClaims', 'citationSupported', 'invalidCitations', 'answerCitations', 'promptTokens', 'completionTokens', 'answerLatencyMs',
  ]
  const lines = [header.join(',')]
  for (const q of data.queries) {
    for (const { arm, condition } of answerJobs(data.config)) {
      const answer = data.answers.get(k3(arm, condition, q.id))
      const search = isSearchArm(arm) ? data.search.get(k2(arm, q.id)) : undefined
      const retrieval = isSearchArm(arm) ? data.retrieval.get(k2(arm, q.id)) : undefined
      const score = isSearchArm(arm) ? retrievalScore(data, arm, q.id) : null
      const seen = search ? applyCondition(search.hits, CONDITIONS[condition]) : []
      const citation = isSearchArm(arm) ? data.citations.get(k3(arm, condition, q.id)) : undefined
      lines.push(
        [
          q.id, q.slice, q.subSlice, q.style, q.language, arm, condition, search?.status, search?.searchQuery, search?.hits.length,
          search?.hits.reduce((n, h) => n + h.content.length, 0), search?.latencyMs, search?.totalMs, search?.attempts, answer?.status,
          data.correctness.get(k3(arm, condition, q.id))?.label, retrieval?.relevance?.join('|'), score?.p5, score?.ndcg5,
          retrieval?.answerInResults, search ? answerStringInResults(search.hits, q.goldAnswer) : null, search ? goldUrlRank(search.hits, q.goldUrls) : null,
          search ? goldDomainHit(search.hits, q.goldUrls) : null, search ? authoritativeShare(search.hits, q.authoritativeDomains) : null,
          search ? identifierCoverage(hitsText(seen), q.goldIdentifiers) : null,
          answer?.status === 'ok' ? identifierCoverage(answer.content, q.goldIdentifiers) : null,
          citation?.claims, citation?.supported, citation?.invalidCitations, answer?.status === 'ok' ? parseCitations(answer.content).length : null,
          answer?.usage?.promptTokens, answer?.usage?.completionTokens, answer?.latencyMs,
        ]
          .map(csvCell)
          .join(','),
      )
    }
  }
  return `${lines.join('\n')}\n`
}

export function summarize(data: RunData): Record<string, unknown> {
  const arms: Record<string, unknown> = {}
  for (const arm of data.config.arms) {
    const correct: Record<string, number | null> = {}
    for (const condition of data.config.conditions) {
      if (!isSearchArm(arm) && condition !== 'native') continue
      const s = accuracy(data, arm, condition, data.queries)
      correct[condition] = ratio(s.correct, s.n)
    }
    if (!isSearchArm(arm)) {
      arms[arm] = { correct }
      continue
    }
    const searches = data.queries.map(q => data.search.get(k2(arm, q.id))).filter((s): s is SearchRecord => s !== undefined)
    const scores = data.queries.map(q => retrievalScore(data, arm, q.id)).filter((s): s is RetrievalScore => s !== null)
    arms[arm] = {
      correct,
      ndcg5: mean(scores.map(s => s.ndcg5)),
      p5: mean(scores.map(s => s.p5)),
      errorRate: ratio(searches.filter(s => s.status === 'error').length, searches.length),
      emptyRate: ratio(searches.filter(s => s.status === 'empty').length, searches.length),
      p50Ms: percentile(searches.filter(s => s.status !== 'error').map(s => s.latencyMs), 50),
      p90Ms: percentile(searches.filter(s => s.status !== 'error').map(s => s.latencyMs), 90),
    }
  }
  return { runId: data.config.runId, createdAt: data.config.createdAt, mock: data.config.mock, queries: data.queries.length, spend: runSpend(data), arms }
}

export async function writeReport(runDir: string): Promise<{ report: string; files: string[] }> {
  const data = await loadRun(runDir)
  const report = renderReport(data)
  const files = [join(runDir, 'report.md'), join(runDir, 'results.csv'), join(runDir, 'summary.json')]
  await Bun.write(files[0] as string, report)
  await Bun.write(files[1] as string, renderCsv(data))
  await writeJson(files[2] as string, summarize(data))
  return { report, files }
}
