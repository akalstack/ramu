/** A bare host such as example.com or example.com/path, optionally with a port. */
const HOST_LIKE = /^[^\s/?#]+\.[^\s/?#.]{2,}(:\d+)?([/?#]\S*)?$/
const LOCAL_HOST = /^(localhost|127\.|\[::1\])/i

/**
 * What the address box makes of typed text: a full address, a bare host such as localhost:3000 or example.com, or,
 * when a search template is given, a search for anything else (`%s` in the template stands for the words).
 */
export function addressFrom(raw: string, searchTemplate?: string): string | null {
  const text = raw.trim()
  if (!text) return null
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return /\s/.test(text) ? null : text
  if (!/\s/.test(text) && (LOCAL_HOST.test(text) || HOST_LIKE.test(text)))
    // localhost and private-looking hosts are local development servers; everything else is a website.
    return `${LOCAL_HOST.test(text) ? 'http' : 'https'}://${text}`
  return searchTemplate ? searchTemplate.replace('%s', encodeURIComponent(text)) : null
}
