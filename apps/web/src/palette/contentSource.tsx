import { searchSnippet } from '@ramu/shared/search/searchSnippet'
import type { SearchMatch, SearchOptions, SearchResults } from '@ramu/shared/types'
import { FileIcon } from '../editor/FileIcon'
import { t } from '../i18n'
import type { PaletteResult, PaletteSource } from './sources'

/** Characters of context kept around a hit; longer lines (minified bundles) are cropped before measuring. */
const BEFORE = 60
const AFTER = 200
const LOCATION = /:\d+(?::\d+)?$/

/** A match as a result row: the line around the hit, cropped so a huge line stays cheap. */
export function contentResult(
  match: SearchMatch,
  open: (match: SearchMatch) => void | Promise<void>,
  repoName?: string,
): PaletteResult {
  const from = Math.max(0, match.start - BEFORE)
  const text = match.text.replace(/[\r\n]+$/, '').slice(from, match.end + AFTER)
  const snippet = searchSnippet(text, match.start - from, match.end - from, 100, (value) => value.length, from > 0)
  return {
    key: `${match.repoId}:${match.path}:${match.line}:${match.column}`,
    label: `${match.path}:${match.line}`,
    detail: `${repoName ? `${repoName} · ` : ''}${match.path}:${match.line}`,
    icon: <FileIcon path={match.path} />,
    snippet,
    run: () => open(match),
  }
}

/**
 * Text inside the project's files, through the same ripgrep-backed `files.search` the Search panel uses:
 * literal, case-insensitive, honouring ignore files and skipping binaries and large files. The server has
 * no cancellation, so a superseded request finishes (its own 15 s timeout bounds it) and is ignored.
 */
export function contentSource({
  taskId,
  search,
  open,
  repoName,
  limit,
}: {
  taskId: string
  search: (taskId: string, options: SearchOptions) => Promise<SearchResults>
  open: (match: SearchMatch) => void | Promise<void>
  /** Repository label for multi-repository projects. */
  repoName?: (repoId: string) => string | undefined
  limit: number
}): PaletteSource {
  return {
    id: 'content',
    label: t('Text in files'),
    priority: 40,
    modes: ['all', 'content'],
    minLength: 3,
    minLengthExplicit: 2,
    debounceMs: 250,
    limit,
    initialShow: 8,
    scope: taskId,
    async query(text, { signal }) {
      // "file.ts:42" is a jump to a line, not text to look for.
      if (LOCATION.test(text)) return { results: [] }
      const found = await search(taskId, {
        query: text.slice(0, 1000),
        caseSensitive: false,
        wholeWord: false,
        regex: false,
        include: '',
        exclude: '',
      })
      if (signal.aborted) return { results: [] }
      return {
        results: found.matches.slice(0, limit).map((match) => contentResult(match, open, repoName?.(match.repoId))),
        limited: found.limited || found.matches.length > limit,
      }
    },
  }
}
