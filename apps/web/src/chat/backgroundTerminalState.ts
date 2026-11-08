import type { BackgroundTerminalInfo } from '@ramu/shared/api'

const isLiveTerminal = (terminal: Pick<BackgroundTerminalInfo, 'state'>) =>
  terminal.state === 'running' || terminal.state === 'stopping'

/**
 * A thread's commands that are still running: the host's answer is the only truth, so a failed read keeps the last
 * known rows. A finished command leaves the list; how it ended stays in the thread's transcript.
 */
export async function readBackgroundTerminals(
  invoke: (method: 'term.background.list', taskId: string) => Promise<BackgroundTerminalInfo[]>,
  taskId: string,
  previous: BackgroundTerminalInfo[],
): Promise<{ terminals: BackgroundTerminalInfo[]; stale: boolean }> {
  try {
    return { terminals: (await invoke('term.background.list', taskId)).filter(isLiveTerminal), stale: false }
  } catch {
    return { terminals: previous, stale: true }
  }
}

/** Force stop is offered only after a graceful stop is under way and the owner supports it. */
export const canForceStop = (terminal: BackgroundTerminalInfo) =>
  terminal.state === 'stopping' && terminal.capabilities.forceStop
