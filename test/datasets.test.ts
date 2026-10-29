import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { loadQueries, MAX_QUERY_CHARS, validateQuery } from '../src/datasets'

describe('validation', () => {
  test('rejects malformed queries with a location', () => {
    const { errors } = validateQuery({ id: 'x', slice: 'coding', query: '', style: 'shouting', goldUrls: ['nope'] }, 'f.jsonl:3')
    expect(errors).toEqual([
      'f.jsonl:3: query must be a non-empty string',
      'f.jsonl:3: unknown style "shouting"',
      'f.jsonl:3: invalid gold URL nope',
    ])
  })

  test('rejects queries the search endpoint would refuse', () => {
    expect(validateQuery({ id: 'x', slice: 's', query: 'q'.repeat(MAX_QUERY_CHARS) }, 'f').errors).toEqual([])
    expect(validateQuery({ id: 'x', slice: 's', query: 'q'.repeat(MAX_QUERY_CHARS + 1) }, 'f').errors).toEqual([`f: query longer than ${MAX_QUERY_CHARS} chars`])
  })

  test('the seed set is valid and has no duplicate ids', async () => {
    const { queries } = await loadQueries([join(import.meta.dir, '..', 'data', 'seed.jsonl')])
    expect(queries.length).toBeGreaterThan(40)
    expect(new Set(queries.map(q => q.id)).size).toBe(queries.length)
    expect(queries.some(q => q.slice === 'coding')).toBe(true)
  })

  test('duplicate ids across files fail loudly', async () => {
    const dir = `${process.env.TMPDIR ?? '/tmp'}/vsb-dupes-${process.pid}`
    await Bun.write(`${dir}/a.jsonl`, '{"id":"same","slice":"s","query":"q1"}\n')
    await Bun.write(`${dir}/b.jsonl`, '{"id":"same","slice":"s","query":"q2"}\n')
    await expect(loadQueries([`${dir}/a.jsonl`, `${dir}/b.jsonl`])).rejects.toThrow('duplicate id same')
  })

  test('needsReview queries are skipped unless asked for', async () => {
    const dir = `${process.env.TMPDIR ?? '/tmp'}/vsb-review-${process.pid}`
    await Bun.write(`${dir}/r.jsonl`, '{"id":"r1","slice":"s","query":"q","needsReview":true}\n{"id":"r2","slice":"s","query":"q"}\n')
    expect((await loadQueries([`${dir}/r.jsonl`])).queries.map(q => q.id)).toEqual(['r2'])
    expect((await loadQueries([`${dir}/r.jsonl`], { includeUnreviewed: true })).queries).toHaveLength(2)
  })
})
