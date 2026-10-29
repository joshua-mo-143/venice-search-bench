import { describe, expect, test } from 'bun:test'
import { buildAnswerPrompt, formatResults, RESULTS_HEADING } from '../src/prompt'
import type { SearchHit } from '../src/types'

const hits: SearchHit[] = [
  { title: 'First', url: 'https://a.example/1', content: 'Alpha.', date: '' },
  { title: 'Second', url: 'https://b.example/2', content: 'Beta.', date: '2026-10-01' },
]

describe('answer prompt', () => {
  test('numbers results from 1 with title, URL, and content', () => {
    expect(formatResults(hits)).toBe('[1] First\nURL: https://a.example/1\nAlpha.\n\n[2] Second\nURL: https://b.example/2\nBeta.')
  })

  test('asks for caret citations and puts the question last', () => {
    const prompt = buildAnswerPrompt('What is alpha?', hits)
    expect(prompt).toContain('^1^')
    expect(prompt.indexOf(RESULTS_HEADING)).toBeLessThan(prompt.indexOf('[1] First'))
    expect(prompt).toEndWith('\n\nQuestion: What is alpha?')
  })
})
