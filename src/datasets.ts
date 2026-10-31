import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { QUERY_STYLES, type Query, type QueryStyle } from './types'
import { mulberry32, readJsonl, sampleStratified, slugify } from './util'

/** The search endpoint rejects longer queries rather than truncating them. */
export const MAX_QUERY_CHARS = 400

/** Query files in data/ that a run uses when no --dataset is given. */
export const DEFAULT_DATASETS = ['releases.jsonl', 'docs.jsonl', 'venice-docs.jsonl', 'research.jsonl', 'news.jsonl', 'sensitive.jsonl', 'general.jsonl']

export const SIMPLEQA_URL = 'https://openaipublic.blob.core.windows.net/simple-evals/simple_qa_test_set.csv'
export const FRAMES_URL = 'https://huggingface.co/datasets/google/frames-benchmark/resolve/main/test.tsv'

/** RFC 4180 quoting, but a quote that does not open a field is literal (FRAMES has bare quotes in unquoted fields). */
export function parseDelimited(text: string, delimiter = ','): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let atFieldStart = true
  const endField = () => {
    row.push(field)
    field = ''
    atFieldStart = true
  }
  const endRow = () => {
    endField()
    if (row.length > 1 || row[0] !== '') rows.push(row)
    row = []
  }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string
    if (inQuotes) {
      if (ch !== '"') field += ch
      else if (text[i + 1] === '"') {
        field += '"'
        i++
      } else inQuotes = false
    } else if (ch === '"' && atFieldStart) {
      inQuotes = true
      atFieldStart = false
    } else if (ch === delimiter) {
      endField()
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      endRow()
    } else {
      field += ch
      atFieldStart = false
    }
  }
  if (!atFieldStart || row.length > 0) endRow()
  return rows
}

export function rowsToObjects(rows: string[][]): Record<string, string>[] {
  const [header, ...body] = rows
  if (!header) return []
  return body.map(row => Object.fromEntries(header.map((key, i) => [key, row[i] ?? ''])))
}

const pythonStrings = (text: string): string[] =>
  [...text.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)].map(match => (match[1] ?? match[2] ?? '').replace(/\\(.)/g, '$1'))

export function parseSimpleQAMetadata(text: string): { topic?: string; answerType?: string; urls: string[] } {
  const topic = text.match(/'topic':\s*'([^']*)'/)?.[1]
  const answerType = text.match(/'answer_type':\s*'([^']*)'/)?.[1]
  const urlList = text.match(/'urls':\s*\[([^\]]*)\]/)?.[1] ?? ''
  return { topic, answerType, urls: [...new Set(pythonStrings(urlList))] }
}

export async function downloadCached(url: string, cachePath: string): Promise<string> {
  const cached = Bun.file(cachePath)
  if (await cached.exists()) return cached.text()
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) })
  if (!response.ok) throw new Error(`GET ${url}: HTTP ${response.status}`)
  const text = await response.text()
  await mkdir(dirname(cachePath), { recursive: true })
  await Bun.write(cachePath, text)
  return text
}

const searchable = (q: Query): boolean => q.query.length > 0 && q.query.length <= MAX_QUERY_CHARS

/** A seeded sample of OpenAI's SimpleQA (MIT), stratified by topic. */
export function simpleQAQueries(text: string, n: number, seed: number): Query[] {
  const all = rowsToObjects(parseDelimited(text, ',')).map((row, index): Query => {
    const meta = parseSimpleQAMetadata(row.metadata ?? '')
    return {
      id: `simpleqa-${index}`,
      slice: 'simpleqa',
      subSlice: meta.topic ? slugify(meta.topic) : undefined,
      tags: meta.answerType ? [meta.answerType] : undefined,
      query: (row.problem ?? '').trim(),
      goldAnswer: (row.answer ?? '').trim(),
      goldUrls: meta.urls.filter(url => URL.canParse(url)),
      source: `simpleqa:${index}`,
    }
  })
  return sampleStratified(all.filter(searchable), n, q => q.subSlice ?? 'unknown', mulberry32(seed))
}

/** A seeded sample of Google's FRAMES (Apache-2.0) multi-hop questions, stratified by reasoning type. */
export function framesQueries(text: string, n: number, seed: number): Query[] {
  const all = rowsToObjects(parseDelimited(text, '\t')).map((row, index): Query => {
    const reasoning = (row.reasoning_types ?? '').trim()
    const id = (row[''] ?? '').trim() || String(index)
    return {
      id: `frames-${id}`,
      slice: 'frames',
      subSlice: slugify(reasoning.split('|')[0] ?? '') || undefined,
      tags: reasoning ? reasoning.split('|').map(t => t.trim()) : undefined,
      query: (row.Prompt ?? '').trim(),
      goldAnswer: (row.Answer ?? '').trim(),
      goldUrls: [...new Set(pythonStrings(row.wiki_links ?? ''))].filter(url => URL.canParse(url)),
      source: `frames:${id}`,
    }
  })
  return sampleStratified(all.filter(searchable), n, q => q.tags?.join('|') ?? 'unknown', mulberry32(seed))
}

export function validateQuery(raw: unknown, where: string): { query?: Query; errors: string[] } {
  const errors: string[] = []
  if (!raw || typeof raw !== 'object') return { errors: [`${where}: not an object`] }
  const q = raw as Record<string, unknown>
  const nonEmpty = (key: string) => {
    if (typeof q[key] !== 'string' || (q[key] as string).trim() === '') errors.push(`${where}: ${key} must be a non-empty string`)
  }
  nonEmpty('id')
  nonEmpty('slice')
  nonEmpty('query')
  if (typeof q.query === 'string' && q.query.trim().length > MAX_QUERY_CHARS) errors.push(`${where}: query longer than ${MAX_QUERY_CHARS} chars`)
  if (q.style !== undefined && !QUERY_STYLES.includes(q.style as QueryStyle)) errors.push(`${where}: unknown style ${JSON.stringify(q.style)}`)
  if (q.goldAnswer !== undefined && (typeof q.goldAnswer !== 'string' || q.goldAnswer.trim() === '')) errors.push(`${where}: goldAnswer must be a non-empty string`)
  for (const key of ['goldUrls', 'goldIdentifiers', 'authoritativeDomains', 'tags']) {
    if (q[key] !== undefined && (!Array.isArray(q[key]) || !(q[key] as unknown[]).every(v => typeof v === 'string'))) {
      errors.push(`${where}: ${key} must be an array of strings`)
    }
  }
  for (const url of (Array.isArray(q.goldUrls) ? q.goldUrls : []) as string[]) {
    if (!URL.canParse(url)) errors.push(`${where}: invalid gold URL ${url}`)
  }
  return errors.length > 0 ? { errors } : { query: q as unknown as Query, errors }
}

export interface LoadedQueries {
  queries: Query[]
  skippedForReview: number
}

export async function loadQueries(paths: readonly string[], options: { includeUnreviewed?: boolean } = {}): Promise<LoadedQueries> {
  const queries: Query[] = []
  const errors: string[] = []
  const seen = new Map<string, string>()
  let skippedForReview = 0
  for (const path of paths) {
    const rows = await readJsonl<unknown>(path)
    rows.forEach((raw, index) => {
      const where = `${path}:${index + 1}`
      const result = validateQuery(raw, where)
      errors.push(...result.errors)
      if (!result.query) return
      const previous = seen.get(result.query.id)
      if (previous) {
        errors.push(`${where}: duplicate id ${result.query.id} (first seen at ${previous})`)
        return
      }
      seen.set(result.query.id, where)
      if (result.query.needsReview && !options.includeUnreviewed) {
        skippedForReview++
        return
      }
      queries.push(result.query)
    })
  }
  if (errors.length > 0) throw new Error(`invalid queries:\n${errors.join('\n')}`)
  return { queries, skippedForReview }
}
