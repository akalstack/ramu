import type { LinkTarget } from './browser'

/** Device-state key (device-wide, kept by the desktop shell) for where clicked web links open. */
export const LINK_TARGET_KEY = 'ramu.browser.linkTarget'

/** Anything but an explicit choice of the integrated browser keeps the person's own browser. */
export function linkTargetFrom(value: string | null | undefined): LinkTarget {
  return value === 'integrated' ? 'integrated' : 'system'
}

/** Only plain web links ever open in either browser; other schemes never leave the app this way. */
export function isWebLink(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

/** Site-provided icon only; never let page metadata load file/app URLs or another origin in the app shell. */
export function browserFaviconFrom(page: string, icon: string | null | undefined): string | null {
  if (!icon || icon.length > 4000) return null
  try {
    const url = new URL(icon)
    return ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      url.origin === new URL(page).origin
      ? url.href
      : null
  } catch {
    return null
  }
}

/** A phone must never reinterpret the execution host's loopback/private address as its own. */
export function canOpenBrowserLinkOnDevice(value: string): boolean {
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      host.includes('.') &&
      !host.startsWith('[') &&
      !/^\d+(\.\d+){3}$/.test(host) &&
      !/(^|\.)(localhost|local|internal|test|invalid|example)$/.test(host)
    )
  } catch {
    return false
  }
}

const LOOPBACK = /^(localhost|.+\.localhost|127(\.\d+){3}|0\.0\.0\.0|\[::1?\])$/

/**
 * Where a phone can load a host browser page itself: the execution host's loopback address becomes the address the
 * phone already reaches the host at, keeping port and path. Null for non-web pages, URLs with credentials, or a host the
 * phone only reaches through its own loopback (an SSH tunnel), where the rewritten address would point at the phone.
 */
export function phoneBrowserUrl(page: string, hostAddress: string): string | null {
  try {
    const url = new URL(page)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null
    if (!LOOPBACK.test(url.hostname.toLowerCase())) return url.href
    const host = new URL(hostAddress).hostname.toLowerCase()
    if (!host || LOOPBACK.test(host)) return null
    url.hostname = host
    return url.href
  } catch {
    return null
  }
}

/** A web page served on the execution host's own loopback, which a phone opens through a forward. */
export function isHostLoopbackPage(page: string): boolean {
  try {
    const url = new URL(page)
    return ['http:', 'https:'].includes(url.protocol) && LOOPBACK.test(url.hostname.toLowerCase())
  } catch {
    return false
  }
}

/**
 * The address a phone opens for a forward the host made for it: the forward's port on the address the phone already
 * reaches the host at, with its one-time open path. Null when the phone reaches the host only through its own
 * loopback (an SSH tunnel), where that port would be the phone's.
 */
export function phoneForwardUrl(hostAddress: string, port: number, openPath: string): string | null {
  try {
    const host = new URL(hostAddress).hostname
    if (!host || LOOPBACK.test(host.toLowerCase()) || !Number.isInteger(port)) return null
    const origin = `http://${host}:${port}`
    const url = new URL(openPath, origin)
    // Only a path on the forward itself: `//elsewhere` or a full address would leave the host.
    return openPath.startsWith('/') && url.origin === new URL(origin).origin ? url.href : null
  } catch {
    return null
  }
}

/** Device-state keys for what the address box searches with when typed text is not an address. */
export const SEARCH_ENGINE_KEY = 'ramu.browser.searchEngine'
export const SEARCH_CUSTOM_KEY = 'ramu.browser.searchCustom'
/** `%s` stands for the typed words. */
export const SEARCH_ENGINES = [
  { id: 'duckduckgo', name: 'DuckDuckGo', template: 'https://duckduckgo.com/?q=%s' },
  { id: 'google', name: 'Google', template: 'https://www.google.com/search?q=%s' },
  { id: 'bing', name: 'Bing', template: 'https://www.bing.com/search?q=%s' },
  { id: 'brave', name: 'Brave Search', template: 'https://search.brave.com/search?q=%s' },
  { id: 'ecosia', name: 'Ecosia', template: 'https://www.ecosia.org/search?q=%s' },
] as const
export const CUSTOM_SEARCH = 'custom'

export const validSearchTemplate = (value: string | null | undefined): value is string =>
  !!value && /^https?:\/\/\S+$/i.test(value) && value.includes('%s')

/** The chosen engine's address template; an unknown choice or an unusable custom address falls back to DuckDuckGo. */
export function searchTemplateFrom(engine: string | null | undefined, custom: string | null | undefined): string {
  if (engine === CUSTOM_SEARCH && validSearchTemplate(custom)) return custom
  return (SEARCH_ENGINES.find((entry) => entry.id === engine) ?? SEARCH_ENGINES[0]).template
}

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
