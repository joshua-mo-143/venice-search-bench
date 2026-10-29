import type { SearchHit } from './types'

export const RESULTS_HEADING = 'Sources:'

const INSTRUCTIONS = `Answer the question at the end using the sources below, which come from a web search. Sources can be outdated, incomplete, or off topic, so ignore the ones that are not useful. Cite each source you rely on by its number in carets, like ^1^ or ^1,2^, right after the sentence it supports. If the sources do not answer the question, say so before giving your best answer.`

export const RESULT_SEPARATOR = '\n\n'

export const formatResult = (hit: SearchHit, index: number): string => `[${index + 1}] ${hit.title}\nURL: ${hit.url}\n${hit.content}`

export const formatResults = (hits: readonly SearchHit[]): string => hits.map((hit, i) => formatResult(hit, i)).join(RESULT_SEPARATOR)

export const buildAnswerPrompt = (question: string, hits: readonly SearchHit[]): string =>
  `${INSTRUCTIONS}\n\n${RESULTS_HEADING}\n\n${formatResults(hits)}\n\nQuestion: ${question}`
