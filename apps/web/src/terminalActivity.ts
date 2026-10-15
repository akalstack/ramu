// The dot on the Terminal button: output in a workspace's terminals that nobody has seen. A shell that just opened,
// including every terminal restored after a restart, prints a prompt and its startup files' output; that isn't news.
import { useSyncExternalStore } from 'react'

/** Startup output counts as over once the shell has been quiet this long. */
export const SETTLE_MS = 2000

/** Per terminal: is this output news? Not until the shell has settled, someone typed, or a command was run in it. */
export function createOutputGate(now = Date.now, settleMs = SETTLE_MS) {
  let armed = false, last = now()
  return {
    arm() { armed = true },
    output(): boolean {
      if (armed) return true
      const at = now()
      if (at - last >= settleMs) return armed = true
      last = at
      return false
    },
  }
}

const unseen = new Set<string>()
const listeners = new Set<() => void>()
let shown: string | null = null
const publish = () => { for (const listener of listeners) listener() }
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }

/** A terminal in `workspace` printed news. Ignored while that workspace's terminal panel is on screen. */
export function markTerminalOutput(workspace: string) {
  if (workspace === shown || unseen.has(workspace)) return
  unseen.add(workspace); publish()
}

/** The workspace whose terminal panel is on screen, if any. Showing it counts as seeing its output. */
export function setShownTerminal(workspace: string | null) {
  shown = workspace
  if (workspace && unseen.delete(workspace)) publish()
}

export const hasUnseenTerminalOutput = (workspace: string | null) => !!workspace && unseen.has(workspace)

export function useUnseenTerminalOutput(workspace: string | null): boolean {
  return useSyncExternalStore(subscribe, () => hasUnseenTerminalOutput(workspace))
}
