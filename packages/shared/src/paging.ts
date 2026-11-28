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

/**
 * Several sources' pages (one per host) as one list in `order`. A source with more to load has shown down to its last
 * row; rows past the highest of those wait, so one host's older row never sits above another's that has not loaded yet.
 */
export function mergedPages<T>(
  sources: readonly { items: readonly T[]; next: string | null }[],
  order: (a: T, b: T) => number,
): T[] {
  const edges = sources.flatMap((source) => {
    const last = source.next ? source.items.at(-1) : undefined
    return last === undefined ? [] : [last]
  })
  const edge = edges.sort(order)[0]
  return sources
    .flatMap((source) => source.items)
    .filter((item) => edge === undefined || order(item, edge) <= 0)
    .sort(order)
}
