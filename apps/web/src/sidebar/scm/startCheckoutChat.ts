import type { AgentSettings } from '@ramu/shared/types'
import { invoke } from '../../ipc'
import { isWorktreeCtx, type useWorkspace } from '../../workspace/workspace'

/**
 * Starts a chat in the same checkout as `taskId` and opens it. The chat is its own record of what was
 * decided and why; when the first message fails, the empty chat is removed again.
 */
export async function startCheckoutChat(
  ws: ReturnType<typeof useWorkspace>,
  taskId: string,
  title: string,
  prompt: string,
  settings: AgentSettings,
): Promise<void> {
  const project = ws.projectOf(taskId)
  if (!project) throw new Error('This checkout is not part of a project.')
  const context = ws.workspaceOf(taskId)
  const isolated = isWorktreeCtx(context) ? context.slice('worktree:'.length) : undefined
  const task = await invoke('tasks.create', {
    projectId: project.id,
    title,
    mode: isolated ? 'worktree' : 'current',
    workspaceId: isolated,
  })
  try {
    const session = await invoke('agent.start', task.id, prompt, settings, [], [])
    await ws.refresh()
    ws.openTask(task.id)
    ws.openView(task.id, { kind: 'agent', sessionId: session.id })
  } catch (error) {
    await invoke('tasks.delete', task.id, false).catch(() => {})
    await ws.refresh().catch(() => {})
    throw error
  }
}
