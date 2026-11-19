import type { AgentSettings } from '../types'

/** Settings are equal when every field a person chooses matches once defaults are filled in. */
export function sameAgentSettings(a: AgentSettings, b: AgentSettings): boolean {
  const norm = (s: AgentSettings) =>
    JSON.stringify([
      s.provider,
      s.accountId ?? 'default',
      s.model,
      s.effort ?? null,
      s.serviceTier ?? 'standard',
      s.access,
      s.autoFallback,
    ])
  return norm(a) === norm(b)
}

/**
 * Settings changes with nothing said between them read as one: from the first one's earlier settings to the last
 * one's. A change that ends where it began (switching back, trying a login and returning) leaves no line at all, so
 * flipping settings does not stack separators in the conversation.
 */
export function foldSettingsChanges<T>(
  items: readonly T[],
  change: (item: T) => { settings: AgentSettings; previous?: AgentSettings } | null,
  merge: (first: T, last: T) => T,
): T[] {
  const out: T[] = []
  for (const item of items) {
    const now = change(item)
    const before = out.length ? out[out.length - 1]! : undefined
    const earlier = before === undefined ? null : change(before)
    if (!now || !earlier) {
      out.push(item)
      continue
    }
    const merged = merge(before!, item)
    const net = change(merged)
    out.pop()
    if (net?.previous && sameAgentSettings(net.previous, net.settings)) continue
    out.push(merged)
  }
  return out
}
