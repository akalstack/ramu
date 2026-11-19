import type { SearchMatch, SearchOptions } from '@ramu/shared/types'

/** Matches in one file, in the order the host found them. */
interface SearchFileGroup {
  repoId: string
  path: string
  matches: SearchMatch[]
}

/** A plain text search over the whole checkout, as the desktop's Search panel runs before any filter is set. */
export const contentSearchOptions = (query: string): SearchOptions => ({
  query,
  caseSensitive: false,
  wholeWord: false,
  regex: false,
  include: '',
  exclude: '',
})

/** Groups matches by file, keeping the host's file order and each file's line order. */
export function groupSearchMatches(matches: readonly SearchMatch[]): SearchFileGroup[] {
  const groups = new Map<string, SearchFileGroup>()
  for (const match of matches) {
    const key = `${match.repoId}\n${match.path}`
    const group = groups.get(key)
    if (group) group.matches.push(match)
    else groups.set(key, { repoId: match.repoId, path: match.path, matches: [match] })
  }
  return [...groups.values()]
}
