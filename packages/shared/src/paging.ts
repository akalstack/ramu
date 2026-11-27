/**
 * One page of a list the host keeps longer than a screen shows: its items, newest first, and the cursor that continues
 * after the last of them, or null when nothing older is left.
 */
export interface Page<T> {
  items: T[]
  next: string | null
}

/** The most a page may ask for, so one request stays small however long the list is. */
export const PAGE_LIMIT_MAX = 100

/**
 * The next page added to what is already shown. A row that moved while paging (a run that started again, an artifact
 * edited and so newer) keeps its first place instead of showing twice.
 */
export function appendPage<T>(shown: readonly T[], page: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set(shown.map(key))
  return [...shown, ...page.filter((item) => !seen.has(key(item)))]
}
