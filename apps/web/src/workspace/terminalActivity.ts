// The dot on the Terminal button: output in a workspace's terminals that nobody has seen. A shell that just opened,
// including every terminal restored after a restart, prints a prompt and its startup files' output; that isn't news.
// Workspace ids belong to one host, so each host's store has its own tracker (see hostRuntime.ts).
import { useSyncExternalStore } from 'react'

/** Startup output counts as over once the shell has been quiet this long. */
export const SETTLE_MS = 2000

/** Per terminal: is this output news? Not until the shell has settled, someone typed, or a command was run in it. */
export function createOutputGate(now = Date.now, settleMs = SETTLE_MS) {
  let armed = false,
    last = now()
  return {
    arm() {
      armed = true
    },
    output(): boolean {
      if (armed) return true
      const at = now()
      if (at - last >= settleMs) return (armed = true)
      last = at
      return false
    },
  }
}

export type TerminalActivity = ReturnType<typeof createTerminalActivity>

export function createTerminalActivity() {
  const unseen = new Set<string>()
  /** Shells another device opened in a workspace, waiting to be shown here when its terminal panel opens. */
  const held = new Map<string, Set<string>>()
  const listeners = new Set<() => void>()
  let shown: string | null = null
  const publish = () => {
    for (const listener of listeners) listener()
  }
  return {
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    /** A terminal in `workspace` printed news. Ignored while that workspace's terminal panel is on screen. */
    markTerminalOutput(workspace: string) {
      if (workspace === shown || unseen.has(workspace)) return
      unseen.add(workspace)
      publish()
    },
    /** The workspace whose terminal panel is on screen, if any. Showing it counts as seeing its output. */
    setShownTerminal(workspace: string | null) {
      shown = workspace
      if (workspace && unseen.delete(workspace)) publish()
    },
    hasUnseenTerminalOutput: (workspace: string | null) => !!workspace && unseen.has(workspace),
    /** Whether that workspace's terminal panel is on screen now. */
    isShown: (workspace: string) => shown === workspace,
    /**
     * A shell another device (the phone) opened here. It does not open a tab on its own: the Terminal button gets its
     * dot, and the shell joins the panel the next time it is opened.
     */
    holdShell(workspace: string, shell: string) {
      const set = held.get(workspace) ?? new Set<string>()
      if (set.has(shell)) return
      set.add(shell)
      held.set(workspace, set)
      if (workspace !== shown) unseen.add(workspace)
      publish()
    },
    /** A held shell ended or closed elsewhere before anyone here looked. */
    dropShell(workspace: string, shell: string) {
      if (held.get(workspace)?.delete(shell)) publish()
    },
    heldShells: (workspace: string | null) => (workspace ? [...(held.get(workspace) ?? [])] : []),
    /** The held shells, handed over once to be shown as tabs. */
    releaseShells(workspace: string): string[] {
      const shells = [...(held.get(workspace) ?? [])]
      held.delete(workspace)
      if (shells.length) publish()
      return shells
    },
  }
}

export function useUnseenTerminalOutput(activity: TerminalActivity, workspace: string | null): boolean {
  return useSyncExternalStore(activity.subscribe, () => activity.hasUnseenTerminalOutput(workspace))
}

/** How many shells another device opened in `workspace` that this window has not shown yet. */
export function useHeldShells(activity: TerminalActivity, workspace: string | null): number {
  return useSyncExternalStore(activity.subscribe, () => activity.heldShells(workspace).length)
}
