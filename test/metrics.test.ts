import { describe, expect, test } from 'bun:test'
import { mcnemarExactP, mean, ndcgAtK, pairedBootstrapCI, percentile, pooledScores, precisionAtK, wilson } from '../src/metrics'

describe('ranking metrics', () => {
  test('precision@k divides by k even when fewer results came back', () => {
    expect(precisionAtK([3, 2, 1, 0, 3], 5)).toBeCloseTo(0.6)
    expect(precisionAtK([3, 3], 5)).toBeCloseTo(0.4)
    expect(precisionAtK([], 5)).toBe(0)
  })

  test('nDCG@k uses a fixed ideal, so short result lists are penalised', () => {
    expect(ndcgAtK([3, 3, 3, 3, 3], 5)).toBeCloseTo(1)
    expect(ndcgAtK([3], 5)).toBeLessThan(ndcgAtK([3, 3], 5))
    expect(ndcgAtK([0, 3], 5)).toBeLessThan(ndcgAtK([3, 0], 5))
    expect(ndcgAtK([], 5)).toBe(0)
  })

  test('pooled scores give every copy of a page its best score', () => {
    const pooled = pooledScores([
      [
        { key: 'a', score: 1 },
        { key: 'b', score: 2 },
      ],
      [
        { key: 'b', score: 0 },
        { key: 'a', score: 3 },
        { key: 'c', score: 1 },
      ],
    ])
    expect(pooled).toEqual([
      [3, 2],
      [2, 3, 1],
    ])
  })
})

describe('summary statistics', () => {
  test('mean and percentile', () => {
    expect(mean([])).toBeNull()
    expect(mean([1, 2, 3])).toBe(2)
    expect(percentile([10, 20, 30, 40], 50)).toBe(25)
    expect(percentile([5], 90)).toBe(5)
    expect(percentile([], 50)).toBeNull()
  })

  test('wilson interval brackets the estimate and stays in [0, 1]', () => {
    const ci = wilson(8, 10)
    expect(ci?.lo).toBeGreaterThan(0.4)
    expect(ci?.hi).toBeLessThan(1)
    expect(wilson(0, 10)?.lo).toBeCloseTo(0, 10)
    expect(wilson(10, 10)?.hi).toBeCloseTo(1, 10)
    expect(wilson(0, 0)).toBeNull()
  })
})

describe('paired tests', () => {
  test('bootstrap CI is deterministic for a seed and contains the observed delta', () => {
    const a = [1, 1, 1, 0, 1, 1, 0, 1, 1, 1]
    const b = [0, 1, 0, 0, 1, 0, 0, 1, 0, 1]
    const first = pairedBootstrapCI(a, b, 2000, 7)
    expect(first).toEqual(pairedBootstrapCI(a, b, 2000, 7))
    expect(first?.delta).toBeCloseTo(0.4)
    expect(first!.lo).toBeLessThanOrEqual(0.4)
    expect(first!.hi).toBeGreaterThanOrEqual(0.4)
    expect(pairedBootstrapCI([], [])).toBeNull()
    expect(() => pairedBootstrapCI([1], [1, 0])).toThrow()
  })

  test('exact McNemar matches the binomial tail', () => {
    expect(mcnemarExactP(0, 0)).toBe(1)
    expect(mcnemarExactP(5, 5)).toBe(1)
    expect(mcnemarExactP(10, 0)).toBeCloseTo(2 / 1024, 6)
    expect(mcnemarExactP(8, 2)).toBeCloseTo(0.109375, 6)
    expect(mcnemarExactP(2, 8)).toBeCloseTo(mcnemarExactP(8, 2), 12)
    expect(mcnemarExactP(600, 400)).toBeLessThan(1e-9)
  })
})
