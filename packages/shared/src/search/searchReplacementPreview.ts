import type { SearchMatch, SearchOptions } from '../types'

/** Expand a visible match without changing files; null means its context was truncated. */
export function searchReplacementPreview(
  match: SearchMatch,
  options: SearchOptions,
  replacement: string,
): string | null {
  if (!options.regex) return replacement
  if (match.endColumn - match.column !== match.end - match.start) return null
  if ((replacement.includes('$`') && match.column - 1 > match.start) || replacement.includes("$'")) return null
  try {
    const regex = new RegExp(options.query.replace(/\(\?P</g, '(?<'), `uy${options.caseSensitive ? '' : 'i'}`)
    regex.lastIndex = match.start
    const found = regex.exec(match.text)
    if (!found || found[0] !== match.text.slice(match.start, match.end)) return null
    regex.lastIndex = match.start
    const next = match.text.replace(regex, replacement)
    return next.slice(match.start, next.length - (match.text.length - match.end))
  } catch {
    return null
  }
}
