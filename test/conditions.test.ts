import { describe, expect, test } from 'bun:test'
import { applyCondition, CONDITIONS, fairShares } from '../src/conditions'
import { formatResults } from '../src/prompt'
import type { SearchHit } from '../src/types'
import { CHARS_PER_TOKEN, truncateText } from '../src/util'

const hit = (i: number, length: number): SearchHit => ({ title: `Title ${i}`, url: `https://example.com/${i}`, content: 'x'.repeat(length), date: '' })

describe('fairShares', () => {
  test('gives short items what they need and splits the rest', () => {
    expect(fairShares([100, 5000, 5000], 3000)).toEqual([100, 1450, 1450])
  })

  test('never exceeds the budget or an item length', () => {
    const lengths = [10, 2000, 50, 900, 7000]
    const shares = fairShares(lengths, 2500)
    expect(shares.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(2500)
    shares.forEach((share, i) => expect(share).toBeLessThanOrEqual(lengths[i] as number))
  })

  test('hands out everything when items fit', () => {
    expect(fairShares([10, 20], 1000)).toEqual([10, 20])
    expect(fairShares([10, 20], 0)).toEqual([0, 0])
  })
})

describe('applyCondition', () => {
  const hits = Array.from({ length: 10 }, (_, i) => hit(i, i % 2 === 0 ? 300 : 20_000))

  test('native passes results through untouched', () => {
    expect(applyCondition(hits, CONDITIONS.native)).toEqual(hits)
  })

  test('budgeted conditions keep the top five within the token budget', () => {
    for (const id of ['k5-2k', 'k5-8k'] as const) {
      const condition = CONDITIONS[id]
      const out = applyCondition(hits, condition)
      expect(out).toHaveLength(5)
      expect(formatResults(out).length).toBeLessThanOrEqual(Math.floor((condition.tokenBudget as number) * CHARS_PER_TOKEN))
      expect(out.map(h => h.url)).toEqual(hits.slice(0, 5).map(h => h.url))
    }
  })

  test('short snippets are not padded or cut', () => {
    const out = applyCondition([hit(0, 200), hit(1, 250)], CONDITIONS['k5-2k'])
    expect(out.map(h => h.content.length)).toEqual([200, 250])
  })
})

describe('truncateText', () => {
  test('leaves text that fits alone', () => {
    expect(truncateText('abc', 3)).toBe('abc')
    expect(truncateText('abc', 10)).toBe('abc')
  })

  test('keeps the start and ends on a nearby word boundary', () => {
    expect(truncateText('alpha beta gamma delta', 18)).toBe('alpha beta gamma…')
  })

  test('cuts mid-word when no boundary is close', () => {
    expect(truncateText('abcdefghij', 5)).toBe('abcd…')
    expect(truncateText('a bcdefghijklmnop', 10)).toBe('a bcdefgh…')
  })

  test('never exceeds the limit', () => {
    const text = 'The quick brown fox jumps over the lazy dog. '.repeat(7)
    for (let max = 0; max <= text.length + 2; max++) expect(truncateText(text, max).length).toBeLessThanOrEqual(max)
  })
})
