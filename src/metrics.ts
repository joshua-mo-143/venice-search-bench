import { mulberry32 } from './util'

export const mean = (values: readonly number[]): number | null =>
  values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0) / values.length

export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const rank = (p / 100) * (sorted.length - 1)
  const lo = Math.floor(rank)
  const hi = Math.ceil(rank)
  return (sorted[lo] as number) + ((sorted[hi] as number) - (sorted[lo] as number)) * (rank - lo)
}

/** Missing results count as irrelevant: the denominator is always k. */
export function precisionAtK(scores: readonly number[], k: number, threshold = 2): number {
  return scores.slice(0, k).filter(score => score >= threshold).length / k
}

/** Normalised against a fixed ideal of k perfect results, so returning fewer or weaker results costs the same for every provider. */
export function ndcgAtK(scores: readonly number[], k: number, maxScore = 3): number {
  const gain = (score: number, i: number) => (2 ** score - 1) / Math.log2(i + 2)
  const dcg = scores.slice(0, k).reduce((sum, score, i) => sum + gain(score, i), 0)
  let ideal = 0
  for (let i = 0; i < k; i++) ideal += gain(maxScore, i)
  return dcg / ideal
}

export function wilson(successes: number, n: number, z = 1.96): { lo: number; hi: number } | null {
  if (n === 0) return null
  const p = successes / n
  const denom = 1 + (z * z) / n
  const centre = (p + (z * z) / (2 * n)) / denom
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom
  return { lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) }
}

export interface PairedDelta {
  n: number
  delta: number
  lo: number
  hi: number
}

/** Bootstrap over queries, resampling pairs together so per-query difficulty cancels out. */
export function pairedBootstrapCI(a: readonly number[], b: readonly number[], iterations = 5000, seed = 1): PairedDelta | null {
  if (a.length !== b.length) throw new Error('paired samples must have equal length')
  const n = a.length
  if (n === 0) return null
  const diffs = a.map((value, i) => value - (b[i] as number))
  const delta = diffs.reduce((sum, d) => sum + d, 0) / n
  const rng = mulberry32(seed)
  const means = new Float64Array(iterations)
  for (let it = 0; it < iterations; it++) {
    let sum = 0
    for (let i = 0; i < n; i++) sum += diffs[Math.floor(rng() * n)] as number
    means[it] = sum / n
  }
  means.sort()
  return { n, delta, lo: means[Math.floor(0.025 * (iterations - 1))] as number, hi: means[Math.ceil(0.975 * (iterations - 1))] as number }
}

function logChoose(n: number, k: number): number {
  let result = 0
  for (let i = 1; i <= k; i++) result += Math.log(n - k + i) - Math.log(i)
  return result
}

/** Two-sided exact McNemar test from the discordant counts. */
export function mcnemarExactP(onlyA: number, onlyB: number): number {
  const n = onlyA + onlyB
  if (n === 0) return 1
  const k = Math.min(onlyA, onlyB)
  let tail = 0
  for (let i = 0; i <= k; i++) tail += Math.exp(logChoose(n, i) - n * Math.LN2)
  return Math.min(1, 2 * tail)
}
