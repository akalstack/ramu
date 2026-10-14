import { invoke } from './ipc'
import { t } from './i18n'

/** Terminal view id -> the shell backing it, so closing a view can ask whether that shell is busy. */
const shells = new Map<string, string>()

export function trackTerminal(viewId: string, termId: string): () => void {
  shells.set(viewId, termId)
  return () => { if (shells.get(viewId) === termId) shells.delete(viewId) }
}

/**
 * Run `proceed` once it is safe to close these views. Closing a terminal kills its shell, so when a
 * command is still running the user confirms first. Views without a live shell close immediately.
 */
export function closeAfterTerminalCheck(viewIds: string[], proceed: () => void): void {
  const termIds = viewIds.flatMap((id) => shells.get(id) ?? [])
  if (!termIds.length) return proceed()
  void invoke('term.busy', termIds).catch(() => 0).then((busy) => {
    if (!busy || confirm(busy === 1 ? t('A command is still running in this terminal. Close it anyway?') : t('Commands are still running in {count} terminals. Close them anyway?', { count: busy }))) proceed()
  })
}
