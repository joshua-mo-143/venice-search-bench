import { describe, expect, test } from 'bun:test'
import {
  answerStringInResults,
  authoritativeShare,
  combinePairwise,
  formatHitsForJudge,
  goldDomainHit,
  goldUrlRank,
  identifierCoverage,
  parseCitations,
  stripCitations,
} from '../src/grade'
import type { SearchHit } from '../src/types'
import { normalizeUrl } from '../src/util'

const hit = (url: string, content = ''): SearchHit => ({ title: 'T', url, content, date: '' })

describe('parseCitations', () => {
  test('splits claims at caret citations', () => {
    const claims = parseCitations('Rust 1.85 shipped the 2024 edition.^1^ It also stabilised async closures.^1,3^\nUnrelated line.')
    expect(claims).toEqual([
      { text: 'Rust 1.85 shipped the 2024 edition.', indices: [1] },
      { text: 'It also stabilised async closures.', indices: [1, 3] },
    ])
  })

  test('tolerates spaces inside carets and merges back-to-back citations', () => {
    expect(parseCitations('A fact.^1, 2^^4^')).toEqual([{ text: 'A fact.', indices: [1, 2, 4] }])
  })

  test('starts a new claim at a line break', () => {
    expect(parseCitations('Heading\n- point one^2^')).toEqual([{ text: '- point one', indices: [2] }])
  })

  test('stripCitations removes markers only', () => {
    expect(stripCitations('One.^1^ Two.^2,3^ x^2 stays')).toBe('One. Two. x^2 stays')
  })
})

describe('combinePairwise', () => {
  test('needs agreement across both orders to name a winner', () => {
    expect(combinePairwise('A', 'B', 'exa', 'brave')).toBe('exa')
    expect(combinePairwise('B', 'A', 'exa', 'brave')).toBe('brave')
    expect(combinePairwise('A', 'A', 'exa', 'brave')).toBe('tie')
    expect(combinePairwise('A', 'TIE', 'exa', 'brave')).toBe('exa')
    expect(combinePairwise('TIE', 'TIE', 'exa', 'brave')).toBe('tie')
  })
})

describe('formatHitsForJudge', () => {
  test('numbers results and keeps all of their text', () => {
    const page = `${'Accept cookies. '.repeat(500)}The answer is 42.`
    const text = formatHitsForJudge([hit('https://a.example/', 'short'), hit('https://b.example/', page)])
    expect(text.startsWith('[1] T\nhttps://a.example/\nshort\n\n[2] T\nhttps://b.example/\n')).toBe(true)
    expect(text.endsWith('The answer is 42.')).toBe(true)
  })
})

describe('normalizeUrl', () => {
  test('ignores scheme, www, trailing slash, query, fragment, and index pages', () => {
    expect(normalizeUrl('https://www.example.com/a/b/?x=1#frag')).toBe('example.com/a/b')
    expect(normalizeUrl('http://example.com/docs/index.html')).toBe('example.com/docs')
    expect(normalizeUrl('not a url')).toBeNull()
  })

  test('collapses versioned doc paths', () => {
    expect(normalizeUrl('https://docs.rs/tokio/1.40.0/tokio/macro.select.html')).toBe('docs.rs/tokio/latest/tokio/macro.select.html')
    expect(normalizeUrl('https://docs.python.org/3.12/library/json.html')).toBe('docs.python.org/3/library/json.html')
    expect(normalizeUrl('https://docs.python.org/ja/3/library/json.html')).toBe('docs.python.org/3/library/json.html')
    expect(normalizeUrl('https://nodejs.org/docs/latest-v20.x/api/esm.html')).toBe('nodejs.org/api/esm.html')
    expect(normalizeUrl('https://developer.mozilla.org/fr/docs/Web/API')).toBe('developer.mozilla.org/en-US/docs/Web/API')
    expect(normalizeUrl('https://requests.readthedocs.io/en/stable/user/advanced/')).toBe('requests.readthedocs.io/en/latest/user/advanced')
  })

  test('survives malformed escapes', () => {
    expect(normalizeUrl('https://example.com/%E0%A4%A')).toBe('example.com/%E0%A4%A')
  })
})

describe('deterministic retrieval metrics', () => {
  const hits = [
    hit('https://blog.example.com/post', 'Use the --break-system-packages flag'),
    hit('https://docs.python.org/3.13/library/json.html', 'ensure_ascii defaults to True'),
    hit('https://github.com/astral-sh/uv/issues/1'),
  ]

  test('goldUrlRank finds the first matching result', () => {
    expect(goldUrlRank(hits, ['https://docs.python.org/3/library/json.html#json.dumps'])).toBe(2)
    expect(goldUrlRank(hits, ['https://peps.python.org/pep-0668/'])).toBe(0)
    expect(goldUrlRank(hits, undefined)).toBeNull()
  })

  test('goldDomainHit matches subdomains', () => {
    expect(goldDomainHit([hit('https://sub.docs.python.org/x')], ['https://docs.python.org/3/'])).toBe(true)
    expect(goldDomainHit(hits, ['https://peps.python.org/pep-0668/'])).toBe(false)
  })

  test('authoritativeShare counts official domains in the top k', () => {
    expect(authoritativeShare(hits)).toBeCloseTo(2 / 3)
    expect(authoritativeShare(hits, ['blog.example.com'])).toBe(1)
    expect(authoritativeShare([])).toBeNull()
  })

  test('identifierCoverage is verbatim and case-sensitive', () => {
    expect(identifierCoverage('pass --break-system-packages', ['--break-system-packages', 'pipx'])).toBe(0.5)
    expect(identifierCoverage('ENSURE_ASCII', ['ensure_ascii'])).toBe(0)
    expect(identifierCoverage('anything', undefined)).toBeNull()
  })

  test('answerStringInResults normalises and skips long or tiny golds', () => {
    expect(answerStringInResults(hits, 'True')).toBe(true)
    expect(answerStringInResults(hits, 'May 7, 2025')).toBe(false)
    expect(answerStringInResults(hits, 'No')).toBeNull()
    expect(answerStringInResults(hits, 'x'.repeat(41))).toBeNull()
    expect(answerStringInResults(hits, undefined)).toBeNull()
  })
})
