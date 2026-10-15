import { invoke } from './ipc'
import { t } from './i18n'

/** Terminal view id -> the shell backing it, so closing a view can ask whether that shell is busy. */
const shells = new Map<string, string>()

/** The shell lives on the host, so it outlives the view: a pane that unmounts (switching project) reattaches later. */
export function trackTerminal(viewId: string, termId: string): void {
  shells.set(viewId, termId)
}
export function shellOf(viewId: string): string | undefined {
  return shells.get(viewId)
}
export function forgetTerminal(viewId: string, termId: string): void {
  if (shells.get(viewId) === termId) shells.delete(viewId)
}

// Shells another device opened (the phone) wait here until the view that will show them mounts and takes them.
const adoptable = new Map<string, string[]>()
export function queueAdopt(taskId: string, termId: string): void {
  const list = adoptable.get(taskId) ?? []
  if (!list.includes(termId)) adoptable.set(taskId, [...list, termId])
}
export function adoptQueued(taskId: string, termId: string): boolean {
  return !!adoptable.get(taskId)?.includes(termId)
}
export function takeAdopted(taskId: string): string | undefined {
  const list = adoptable.get(taskId) ?? []
  const next = list[0]
  if (next) adoptable.set(taskId, list.slice(1))
  return next
}
export function allShells(): string[] {
  return [...shells.values()]
}

// A view that is opening its own shell must not be mistaken for one opened elsewhere while the host answers.
const opening = new Map<string, number>()
export function beginOpening(taskId: string): () => void {
  opening.set(taskId, (opening.get(taskId) ?? 0) + 1)
  let done = false
  return () => {
    if (!done) {
      done = true
      opening.set(taskId, Math.max(0, (opening.get(taskId) ?? 1) - 1))
    }
  }
}
export function isOpening(taskId: string): boolean {
  return (opening.get(taskId) ?? 0) > 0
}

/** Kills the shells behind views the user closed. */
function release(viewIds: string[]) {
  for (const id of viewIds) {
    const termId = shells.get(id)
    if (!termId) continue
    shells.delete(id)
    void invoke('term.close', termId).catch(() => {})
  }
}

/**
 * Run `proceed` once it is safe to close these views. Closing a terminal kills its shell, so when a
 * command is still running the user confirms first. Views without a live shell close immediately.
 */
export function closeAfterTerminalCheck(viewIds: string[], proceed: () => void): void {
  const termIds = viewIds.flatMap((id) => shells.get(id) ?? [])
  if (!termIds.length) return proceed()
  const go = () => {
    proceed()
    release(viewIds)
  }
  // An idle prompt closes without asking; only a running command does.
  void invoke('term.busy', termIds)
    .catch(() => 0)
    .then((busy) => {
      if (
        !busy ||
        confirm(
          busy === 1
            ? t('A command is still running in this terminal. Close it anyway?')
            : t('Commands are still running in {count} terminals. Close them anyway?', { count: busy }),
        )
      )
        go()
    })
}
