// One host's terminals: which shell backs each terminal view, shells waiting to be adopted, and that host's terminal
// output. Each host's workspace store owns one (see hostRuntime.ts); nothing here is shared between hosts.
import type { PushEvents } from '@ramu/shared/api'
import type { HostChannel } from './hostEvents'
import { TerminalOutputBuffer, type TerminalChunk } from './terminalOutput'

type Invoke = (method: 'term.close' | 'term.busy', ...args: unknown[]) => Promise<unknown>
type Subscribe = <E extends HostChannel>(channel: E, listener: (payload: PushEvents[E]) => void) => () => void

export interface TerminalRegistryDeps {
  /** The host's bound `invoke`. */
  invoke: Invoke
  /** The host's own push events (`term:data`, `term:exit`). */
  on: Subscribe
  confirm?: (message: string) => boolean
  /** Confirmation copy; `count` is how many shells are busy. */
  busyMessage?: (count: number) => string
  buffer?: TerminalOutputBuffer
}

export type TerminalRegistry = ReturnType<typeof createTerminalRegistry>

export function createTerminalRegistry({
  invoke,
  on,
  confirm = (message) => globalThis.confirm(message),
  busyMessage = (count) => `Commands are still running in ${count} terminals. Close them anyway?`,
  buffer = new TerminalOutputBuffer(),
}: TerminalRegistryDeps) {
  /** Terminal view id -> the shell backing it, so closing a view can ask whether that shell is busy. */
  const shells = new Map<string, string>()
  // Shells another device opened (the phone) wait here until the view that will show them mounts and takes them.
  const adoptable = new Map<string, string[]>()
  // A view that is opening its own shell must not be mistaken for one opened elsewhere while the host answers.
  const opening = new Map<string, number>()

  // Output: straight to the view while the host is on screen; held (bounded) while it is not.
  const dataListeners = new Map<string, Set<(chunk: TerminalChunk) => void>>()
  const exitListeners = new Map<string, Set<(code: number) => void>>()
  const exits = new Map<string, number>()
  let active = true
  let offData: (() => void) | undefined
  let offExit: (() => void) | undefined
  const emitData = (chunk: TerminalChunk) => {
    for (const listener of [...(dataListeners.get(chunk.id) ?? [])]) listener(chunk)
  }
  const emitExit = (id: string, code: number) => {
    for (const listener of [...(exitListeners.get(id) ?? [])]) listener(code)
  }
  const listen = () => {
    offData ??= on('term:data', (payload) => {
      // Nobody shows this shell: the host keeps its output and a view that mounts later replays it (`term.snapshot`).
      if (!dataListeners.has(payload.id)) return
      if (active) emitData(payload)
      else buffer.add(payload)
    })
    offExit ??= on('term:exit', ({ id, code }) => {
      if (!exitListeners.has(id)) return
      if (active) emitExit(id, code)
      else exits.set(id, code)
    })
  }
  const unlisten = () => {
    if (dataListeners.size || exitListeners.size) return
    offData?.()
    offExit?.()
    offData = offExit = undefined
  }
  const subscribe = <T>(map: Map<string, Set<T>>, id: string, listener: T) => {
    const set = map.get(id) ?? new Set<T>()
    map.set(id, set)
    set.add(listener)
    listen()
    return () => {
      if (!set.delete(listener) || set.size) return
      map.delete(id)
      if (map === dataListeners) buffer.drop(id)
      else exits.delete(id)
      unlisten()
    }
  }

  /** Kills the shells behind views the user closed. */
  const release = (viewIds: string[]) => {
    for (const id of viewIds) {
      const termId = shells.get(id)
      if (!termId) continue
      shells.delete(id)
      void invoke('term.close', termId).catch(() => {})
    }
  }

  return {
    /** The shell lives on the host, so it outlives the view: a pane that unmounts (switching project) reattaches later. */
    trackTerminal(viewId: string, termId: string) {
      shells.set(viewId, termId)
    },
    shellOf: (viewId: string): string | undefined => shells.get(viewId),
    forgetTerminal(viewId: string, termId: string) {
      if (shells.get(viewId) === termId) shells.delete(viewId)
    },
    queueAdopt(taskId: string, termId: string) {
      const list = adoptable.get(taskId) ?? []
      if (!list.includes(termId)) adoptable.set(taskId, [...list, termId])
    },
    adoptQueued: (taskId: string, termId: string) => !!adoptable.get(taskId)?.includes(termId),
    takeAdopted(taskId: string): string | undefined {
      const list = adoptable.get(taskId) ?? []
      const next = list[0]
      if (next) adoptable.set(taskId, list.slice(1))
      return next
    },
    allShells: () => [...shells.values()],
    beginOpening(taskId: string): () => void {
      opening.set(taskId, (opening.get(taskId) ?? 0) + 1)
      let done = false
      return () => {
        if (!done) {
          done = true
          opening.set(taskId, Math.max(0, (opening.get(taskId) ?? 1) - 1))
        }
      }
    },
    isOpening: (taskId: string) => (opening.get(taskId) ?? 0) > 0,
    /** Output of one shell on this host. */
    onData: (termId: string, listener: (chunk: TerminalChunk) => void) => subscribe(dataListeners, termId, listener),
    onExit: (termId: string, listener: (code: number) => void) => subscribe(exitListeners, termId, listener),
    /** Whether this host is on screen. Coming back delivers what was held while it was not. */
    setActive(next: boolean) {
      if (active === next) return
      active = next
      if (!active) return
      for (const chunk of buffer.drain()) emitData(chunk)
      const ended = [...exits]
      exits.clear()
      for (const [id, code] of ended) emitExit(id, code)
    },
    /** Characters of output held for views of this host while it is off screen. */
    bufferedChars: () => buffer.size,
    /**
     * Run `proceed` once it is safe to close these views. Closing a terminal kills its shell, so when a
     * command is still running the user confirms first. Views without a live shell close immediately.
     */
    closeAfterTerminalCheck(viewIds: string[], proceed: () => void): void {
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
          if (typeof busy !== 'number' || !busy || confirm(busyMessage(busy))) go()
        })
    },
  }
}
