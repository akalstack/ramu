import type { BackgroundTerminalInfo } from '@ramu/shared/api'

/** A thread's persistent commands: the host's answer is the only truth, so a failed read keeps the last known rows. */
export async function readBackgroundTerminals(
  invoke: (method: 'term.background.list', taskId: string) => Promise<BackgroundTerminalInfo[]>,
  taskId: string,
  previous: BackgroundTerminalInfo[],
): Promise<{ terminals: BackgroundTerminalInfo[]; stale: boolean }> {
  try {
    return { terminals: await invoke('term.background.list', taskId), stale: false }
  } catch {
    return { terminals: previous, stale: true }
  }
}

export const isLiveTerminal = (terminal: Pick<BackgroundTerminalInfo, 'state'>) =>
  terminal.state === 'running' || terminal.state === 'stopping'

/** Force stop is offered only after a graceful stop is under way and the owner supports it. */
export const canForceStop = (terminal: BackgroundTerminalInfo) =>
  terminal.state === 'stopping' && terminal.capabilities.forceStop
