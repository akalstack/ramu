/** Only content belonging to the old partition's host moves; device preferences remain in the shell. */
export function partitionHostEntries(host: string, entries: Record<string, string>): Record<string, string> {
  const prefix = `host:${host}:`
  const result: Record<string, string> = {}
  const perHost = (key: string) =>
    [
      'ramu.unread',
      'ramu.workspace.resume',
      'ramu.outbox',
      'ramu.navigation-locations',
      'ramu.inbox-tab',
      'ramu.last-visit',
      'ramu.last-project',
    ].includes(key) ||
    ['ramu.draft.', 'ramu.last-action:', 'ramu.review-viewed:', 'ramu.layout.'].some((part) => key.startsWith(part))
  for (const [key, value] of Object.entries(entries)) {
    if (key.startsWith(prefix)) result[key] = value
    else if (
      perHost(key) &&
      !key.startsWith('ramu.layout.tools-rail') &&
      !key.startsWith('ramu.layout.react-resizable-panels:')
    ) {
      if (!(prefix + key in entries)) result[prefix + key] = value
    }
  }
  return result
}
