// Search, filter and paging for long settings lists (memories, skills, rules, MCP servers, approvals), shared by the
// desktop and the phone so the same query finds the same items and "Show more" counts agree.

/** Lists this short need no search field; the person can scan them. */
export const LIST_SEARCH_MIN = 6

export const searchWords = (query: string): string[] => query.trim().toLowerCase().split(/\s+/).filter(Boolean)

/** Every word must appear somewhere in the item's text. */
export const matchesWords = (text: string, words: readonly string[]): boolean => {
  if (!words.length) return true
  const haystack = text.toLowerCase()
  return words.every((word) => haystack.includes(word))
}

export interface ListPage<T> {
  shown: T[]
  /** Items still hidden. */
  remaining: number
  /** How many the next "Show more" reveals. */
  next: number
}

/** The first `count` items, and what "Show more" would add. */
export function pageOf<T>(items: readonly T[], count: number, size: number): ListPage<T> {
  const shown = items.slice(0, Math.max(0, count))
  const remaining = Math.max(0, items.length - shown.length)
  return { shown, remaining, next: Math.min(size, remaining) }
}

/** Which empty message applies: nothing exists yet, or filters hide everything that does. */
export const listEmptyState = (total: number, matched: number): 'none' | 'filtered' | 'ok' =>
  matched > 0 ? 'ok' : total > 0 ? 'filtered' : 'none'
