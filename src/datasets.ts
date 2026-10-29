import { QUERY_STYLES, type Query, type QueryStyle } from './types'
import { readJsonl } from './util'

/** The search endpoint rejects longer queries rather than truncating them. */
export const MAX_QUERY_CHARS = 400

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
