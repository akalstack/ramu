import type { BackgroundTerminalInfo } from '../api'

/** Acknowledges only the command identities displayed for this thread, on its selected host. */
export interface TaskRemovalReview {
  backgroundIds: string[]
  forgetUnknown?: boolean
}
export const removalCommands = (commands: BackgroundTerminalInfo[]) =>
  commands.filter(
    (command) => command.state === 'running' || command.state === 'stopping' || command.state === 'unknown',
  )
export const removalReview = (commands: BackgroundTerminalInfo[]): TaskRemovalReview => ({
  backgroundIds: removalCommands(commands).map((command) => command.id),
  forgetUnknown: commands.some((command) => command.state === 'unknown'),
})
export function removalError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return /This value has too many items \(2 at most\)\./.test(message)
    ? 'Update Ramu on this host to review background commands before deleting.'
    : message
}

/** Connection errors cannot. */
export async function readRemovalCommands(
  invoke: (method: 'term.background.list', taskId: string) => Promise<BackgroundTerminalInfo[]>,
  taskId: string,
): Promise<BackgroundTerminalInfo[]> {
  const commands = await invoke('term.background.list', taskId)
  if (commands.some((command) => command.taskId !== taskId))
    throw new Error('Background command scope changed. Reload the thread before deleting.')
  return removalCommands(commands)
}
