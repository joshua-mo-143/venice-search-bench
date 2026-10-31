import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { DEFAULT_DATASETS, framesQueries, loadQueries, MAX_QUERY_CHARS, parseDelimited, parseSimpleQAMetadata, simpleQAQueries, validateQuery } from '../src/datasets'

describe('parseDelimited', () => {
  test('handles quoted fields with delimiters, quotes, and newlines', () => {
    expect(parseDelimited('a,b\n"x, y","say ""hi""\nthere"\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"\nthere'],
    ])
  })

  test('treats a quote inside an unquoted field as literal', () => {
    expect(parseDelimited('id\tprompt\n1\tthe "Jane Eyre" book\n', '\t')).toEqual([
      ['id', 'prompt'],
      ['1', 'the "Jane Eyre" book'],
    ])
  })

  test('handles CRLF, blank lines, trailing delimiters, and a missing final newline', () => {
    expect(parseDelimited('a,b\r\n\r\n1,\r\n2,3')).toEqual([
      ['a', 'b'],
      ['1', ''],
      ['2', '3'],
    ])
  })
})

describe('SimpleQA', () => {
  const metadata = "{'topic': 'Science and technology', 'answer_type': 'Person', 'urls': ['https://en.wikipedia.org/wiki/A', 'https://example.org/b', 'https://en.wikipedia.org/wiki/A']}"

  test('parses the Python-dict metadata', () => {
    expect(parseSimpleQAMetadata(metadata)).toEqual({
      topic: 'Science and technology',
      answerType: 'Person',
      urls: ['https://en.wikipedia.org/wiki/A', 'https://example.org/b'],
    })
  })

  test('builds queries with stable ids and gold data', () => {
    const csv = `metadata,problem,answer\n"${metadata}",Who won?,Ada Lovelace\n"{'topic': 'Art', 'answer_type': 'Date', 'urls': []}",When?,1999\n`
    const queries = simpleQAQueries(csv, 10, 1)
    expect(queries).toHaveLength(2)
    const science = queries.find(q => q.id === 'simpleqa-0')
    expect(science).toMatchObject({ slice: 'simpleqa', subSlice: 'science-and-technology', query: 'Who won?', goldAnswer: 'Ada Lovelace', tags: ['Person'] })
    expect(science?.goldUrls).toHaveLength(2)
  })

  test('samples deterministically and covers every topic', () => {
    const rows = Array.from({ length: 60 }, (_, i) => `"{'topic': 'T${i % 6}', 'answer_type': 'Other', 'urls': []}",Question ${i}?,Answer ${i}`)
    const csv = `metadata,problem,answer\n${rows.join('\n')}\n`
    const first = simpleQAQueries(csv, 12, 42)
    expect(first.map(q => q.id)).toEqual(simpleQAQueries(csv, 12, 42).map(q => q.id))
    expect(new Set(first.map(q => q.subSlice)).size).toBe(6)
    expect(first).toHaveLength(12)
  })

  test('skips questions the search endpoint would refuse', () => {
    const csv = `metadata,problem,answer\n"${metadata}",${'q'.repeat(MAX_QUERY_CHARS + 1)},A\n"${metadata}",Short?,B\n`
    expect(simpleQAQueries(csv, 10, 1).map(q => q.goldAnswer)).toEqual(['B'])
  })
})

describe('FRAMES', () => {
  test('reads the TSV layout, reasoning types, and wiki links', () => {
    const tsv = [
      '\tPrompt\tAnswer\twikipedia_link_1\treasoning_types\twiki_links',
      "0\tWho is it?\tJane Ballou\thttps://en.wikipedia.org/wiki/A\tMultiple constraints | Temporal reasoning\t['https://en.wikipedia.org/wiki/A', 'https://en.wikipedia.org/wiki/B']",
    ].join('\n')
    const [query] = framesQueries(tsv, 5, 1)
    expect(query).toMatchObject({
      id: 'frames-0',
      slice: 'frames',
      subSlice: 'multiple-constraints',
      tags: ['Multiple constraints', 'Temporal reasoning'],
      goldAnswer: 'Jane Ballou',
      goldUrls: ['https://en.wikipedia.org/wiki/A', 'https://en.wikipedia.org/wiki/B'],
    })
  })
})

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

  test('the default query files are valid and have no duplicate ids', async () => {
    const { queries } = await loadQueries(DEFAULT_DATASETS.map(f => join(import.meta.dir, '..', 'data', f)))
    expect(queries.length).toBeGreaterThan(100)
    expect(new Set(queries.map(q => q.id)).size).toBe(queries.length)
    expect(new Set(queries.map(q => q.slice))).toEqual(new Set(['coding', 'research', 'news', 'sensitive', 'general']))
  })

  test('every query file in data/ loads alongside the others', async () => {
    const dir = join(import.meta.dir, '..', 'data')
    const files = [...new Bun.Glob('*.jsonl').scanSync(dir)].map(f => join(dir, f))
    const { queries } = await loadQueries(files)
    expect(queries.length).toBeGreaterThan(100)
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
