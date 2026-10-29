import { mkdir, rename } from 'node:fs/promises'
import { dirname } from 'node:path'

export const CHARS_PER_TOKEN = 4

export const estimateTokens = (chars: number): number => Math.ceil(chars / CHARS_PER_TOKEN)

export const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

export const todayIso = (): string => new Date().toISOString().slice(0, 10)

export const fileSafe = (id: string): string => id.replace(/[^A-Za-z0-9._-]/g, '_')

export const slugify = (text: string, maxLength = 60): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)

export async function readJson<T>(path: string): Promise<T | undefined> {
  const file = Bun.file(path)
  if (!(await file.exists())) return undefined
  return (await file.json()) as T
}

/** Writes via a temp file so an interrupted run never leaves a truncated record behind. */
export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  await Bun.write(tmp, `${JSON.stringify(value, null, 2)}\n`)
  await rename(tmp, path)
}

export async function readJsonl<T>(path: string): Promise<T[]> {
  const text = await Bun.file(path).text()
  const rows: T[] = []
  text.split('\n').forEach((line, index) => {
    if (line.trim().length === 0) return
    try {
      rows.push(JSON.parse(line) as T)
    } catch (error) {
      throw new Error(`${path}:${index + 1}: invalid JSON (${(error as Error).message})`)
    }
  })
  return rows
}

export async function writeJsonl(path: string, rows: unknown[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await Bun.write(path, rows.map(row => JSON.stringify(row)).join('\n') + (rows.length > 0 ? '\n' : ''))
}

export function hashString(text: string): number {
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j] as T, copy[i] as T]
  }
  return copy
}

/** Proportional allocation per stratum, at least one item from every stratum while n allows. */
export function sampleStratified<T>(items: readonly T[], n: number, key: (item: T) => string, rng: () => number): T[] {
  if (n >= items.length) return shuffle(items, rng)
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const k = key(item)
    groups.set(k, [...(groups.get(k) ?? []), item])
  }
  const strata = shuffle([...groups.entries()], rng).map(([k, group]) => ({ k, group: shuffle(group, rng), take: 0 }))
  let remaining = n
  for (const stratum of strata) {
    if (remaining === 0) break
    stratum.take = 1
    remaining--
  }
  const total = items.length
  for (const stratum of strata) {
    const extra = Math.min(stratum.group.length - stratum.take, Math.floor(((n - strata.length) * stratum.group.length) / total))
    if (extra > 0 && remaining > 0) {
      const add = Math.min(extra, remaining)
      stratum.take += add
      remaining -= add
    }
  }
  for (const stratum of strata) {
    while (remaining > 0 && stratum.take < stratum.group.length) {
      stratum.take++
      remaining--
    }
  }
  return shuffle(
    strata.flatMap(stratum => stratum.group.slice(0, stratum.take)),
    rng,
  )
}

export async function mapPool<T, R>(items: readonly T[], concurrency: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index] as T, index)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, worker))
  return results
}

/** Keeps the start of the text, ending at a word boundary when one is close to the cut. */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  if (maxLength <= 0) return ''
  const head = text.slice(0, maxLength - 1)
  const boundary = Math.max(head.lastIndexOf(' '), head.lastIndexOf('\n'))
  return `${boundary > 0 && boundary >= head.length * 0.8 ? head.slice(0, boundary) : head}…`
}

export function extractJsonObject(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) throw new Error('no JSON object in response')
  return JSON.parse(text.slice(start, end + 1))
}

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

export const domainMatches = (host: string, domain: string): boolean => host === domain || host.endsWith(`.${domain}`)

const VERSIONED_PATH_RULES: { host: string; pattern: RegExp; replacement: string }[] = [
  { host: 'docs.rs', pattern: /^\/([^/]+)\/[^/]+\//, replacement: '/$1/latest/' },
  { host: 'docs.python.org', pattern: /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?3(?:\.\d+)?\//, replacement: '/3/' },
  { host: 'nodejs.org', pattern: /^\/docs\/(?:latest(?:-v\d+\.x)?|v\d+\.\d+\.\d+)\/api\//, replacement: '/api/' },
  { host: 'developer.mozilla.org', pattern: /^\/[a-z]{2}(?:-[A-Za-z]{2})?\/docs\//, replacement: '/en-US/docs/' },
  { host: 'readthedocs.io', pattern: /^\/([a-z]{2})\/(?:stable|latest|v?\d[\w.-]*)\//, replacement: '/$1/latest/' },
]

/** Host without `www.`, path without trailing slash or `index.html`; query and fragment dropped; version segments collapsed for doc sites that version their URLs. */
export function normalizeUrl(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
  let path = parsed.pathname
  try {
    path = decodeURIComponent(path)
  } catch {
    // keep the encoded form for malformed escapes
  }
  path = path.replace(/\/index\.html?$/, '/')
  for (const rule of VERSIONED_PATH_RULES) {
    if (domainMatches(host, rule.host)) path = path.replace(rule.pattern, rule.replacement)
  }
  path = path.replace(/\/+$/, '')
  return `${host}${path}`
}

export const normalizeText = (text: string): string =>
  text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
