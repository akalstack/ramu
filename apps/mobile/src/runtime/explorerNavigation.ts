export interface ExplorerNavigation {
  expanded: string[]
  offset: number
  at: number
}
const PREFIX = ':explorer-navigation:'
const MAX_SCOPES = 12
const MAX_FOLDERS = 80
const keyOf = (host: string, context: string) => `${host}${PREFIX}${encodeURIComponent(context)}`

function parse(value: unknown): ExplorerNavigation | null {
  if (typeof value !== 'string' || value.length > 100_000) return null
  try {
    const data = JSON.parse(value)
    if (!data || !Array.isArray(data.expanded) || !Number.isFinite(data.offset) || !Number.isFinite(data.at))
      return null
    return {
      expanded: [
        ...new Set<string>(
          data.expanded.filter(
            (path: unknown): path is string =>
              typeof path === 'string' && path.length <= 1024 && !/[\x00-\x1f]/.test(path),
          ),
        ),
      ].slice(0, MAX_FOLDERS),
      offset: Math.max(0, Math.min(data.offset, 10_000_000)),
      at: data.at,
    }
  } catch {
    return null
  }
}

/** Navigation only: no directory listings, file contents, search text or mutation intent. */
export function readExplorerNavigation(
  drafts: Record<string, string>,
  host: string,
  context: string,
): ExplorerNavigation {
  return parse(drafts[keyOf(host, context)]) ?? { expanded: [], offset: 0, at: 0 }
}

export function rememberExplorerNavigation(
  drafts: Record<string, string>,
  host: string,
  context: string,
  navigation: Omit<ExplorerNavigation, 'at'>,
  now = Date.now(),
): Record<string, string> {
  const key = keyOf(host, context)
  const value = parse(JSON.stringify({ ...navigation, at: now }))
  if (!value) return drafts
  const next = { ...drafts, [key]: JSON.stringify(value) }
  const entries = Object.entries(next)
    .filter(([name]) => name.includes(PREFIX))
    .map(([name, text]) => ({ name, at: parse(text)?.at ?? -Infinity }))
    .sort((a, b) => b.at - a.at)
  for (const entry of entries.slice(MAX_SCOPES)) delete next[entry.name]
  return next
}
