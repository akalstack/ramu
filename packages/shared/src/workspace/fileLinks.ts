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

/** Relative images and links resolve from the document's directory; the main process validates scope. */
export function previewImagePath(documentPath: string, url: string): string | null {
  if (!url || /^[a-z][a-z\d+.-]*:/i.test(url) || url.startsWith('//') || url.startsWith('#')) return null
  try {
    const base = new URL(documentPath.split('/').map(encodeURIComponent).join('/'), 'https://ramu.local/')
    const resolved = new URL(url, base)
    if (resolved.origin !== base.origin) return null
    return decodeURIComponent(resolved.pathname.slice(1))
  } catch {
    return null
  }
}

export type MarkdownLinkTarget = { kind: 'repository'; path: string } | { kind: 'local'; href: string }

/**
 * Where a link in a Markdown document points, as a path the host can resolve: relative and `/root` links resolve from
 * the document inside its repository (keeping a `#L12` line), `file://` and other local paths stay as written. External
 * links return null.
 */
export function markdownLinkTarget(documentPath: string, href: string): MarkdownLinkTarget | null {
  const relative = previewImagePath(documentPath, href)
  const location = localFileLink(href)
  if (relative)
    return {
      kind: 'repository',
      path: location?.line ? `${relative}:${location.line}:${location.column ?? 1}` : relative,
    }
  return location && !/^https?:/i.test(href) ? { kind: 'local', href } : null
}
