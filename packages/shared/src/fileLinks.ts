/** Markdown file references can include editor line and column suffixes. */
export function localFileLink(href: string): { path: string; line?: number; column?: number } | null {
  if (!href || href.startsWith('#') || href.startsWith('//')) return null
  const filenameLocation =
    /^[^:/\\]+\.[^:/\\]+:\d+(?::\d+)?$/.test(href) ||
    /^(?:README|LICENSE|Makefile|Dockerfile):\d+(?::\d+)?$/i.test(href)
  if (!filenameLocation && /^[a-z][a-z\d+.-]*:/i.test(href) && !/^file:/i.test(href) && !/^[a-z]:[\\/]/i.test(href))
    return null
  let path = href
  if (/^file:/i.test(path)) {
    try {
      const url = new URL(path)
      if (url.hostname && url.hostname !== 'localhost') return null
      path = url.pathname + url.hash
    } catch {
      return null
    }
  }
  const location = path.match(/(?:#L?(\d+)(?:[C:](\d+)|-L?\d+)?|:(\d+)(?::(\d+))?)$/i)
  let line: number | undefined, column: number | undefined
  if (location) {
    line = Number(location[1] ?? location[3])
    column = Number(location[2] ?? location[4] ?? 1)
    path = path.slice(0, location.index)
    if (!Number.isSafeInteger(line) || line < 1 || !Number.isSafeInteger(column) || column < 1) return null
  } else path = path.split('#')[0]!
  path = path.split('?')[0]!
  try {
    path = decodeURIComponent(path)
  } catch {
    return null
  }
  if (/^\/[a-z]:[\\/]/i.test(path)) path = path.slice(1)
  if (!path || path.includes('\0')) return null
  return { path, ...(line ? { line, column } : {}) }
}
