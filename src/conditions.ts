import { formatResult, RESULT_SEPARATOR } from './prompt'
import type { ConditionId, SearchHit } from './types'
import { CHARS_PER_TOKEN, truncateText } from './util'

export interface Condition {
  id: ConditionId
  label: string
  topK?: number
  tokenBudget?: number
}

export const CONDITIONS: Record<ConditionId, Condition> = {
  native: { id: 'native', label: 'native (as returned)' },
  'k5-2k': { id: 'k5-2k', label: 'top 5, 2k tokens', topK: 5, tokenBudget: 2000 },
  'k5-8k': { id: 'k5-8k', label: 'top 5, 8k tokens', topK: 5, tokenBudget: 8000 },
}

/** Water-filling: equal shares, with whatever short items leave unused redistributed to longer ones. */
export function fairShares(lengths: readonly number[], budget: number): number[] {
  const shares = lengths.map(() => 0)
  let remaining = Math.max(0, Math.floor(budget))
  let open = lengths.map((_, i) => i)
  while (open.length > 0 && remaining > 0) {
    const share = Math.floor(remaining / open.length)
    if (share === 0) break
    const stillOpen: number[] = []
    for (const i of open) {
      const need = (lengths[i] ?? 0) - (shares[i] ?? 0)
      const grant = Math.min(need, share)
      shares[i] = (shares[i] ?? 0) + grant
      remaining -= grant
      if (need > share) stillOpen.push(i)
    }
    if (stillOpen.length === open.length) break
    open = stillOpen
  }
  return shares
}

const hitOverhead = (hit: SearchHit, index: number): number => formatResult({ ...hit, content: '' }, index).length + RESULT_SEPARATOR.length

/** The budget covers the whole formatted results block, so long titles and URLs cost content. */
export function applyCondition(hits: readonly SearchHit[], condition: Condition): SearchHit[] {
  const top = condition.topK ? hits.slice(0, condition.topK) : [...hits]
  if (!condition.tokenBudget) return top
  const totalChars = Math.floor(condition.tokenBudget * CHARS_PER_TOKEN)
  const overhead = top.reduce((sum, hit, i) => sum + hitOverhead(hit, i), 0)
  const shares = fairShares(
    top.map(hit => hit.content.length),
    totalChars - overhead,
  )
  return top.map((hit, i) => ({ ...hit, content: truncateText(hit.content, shares[i] ?? 0) }))
}
