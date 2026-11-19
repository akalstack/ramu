import type { AgentSettings } from '@ramu/shared/types'
import { invoke } from '../../ipc'
import { t } from '../../i18n'
import { isWorktreeCtx, type useWorkspace } from '../../workspace/workspace'
import type { RamuBridge } from '@ramu/shared/api'

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
  /** The host of `ws` (`useHost().invoke`); the window's own host by default. */
  hostInvoke: RamuBridge['invoke'] = invoke,
): Promise<void> {
  const project = ws.projectOf(taskId)
  if (!project) throw new Error(t('This checkout is not part of a project.'))
  const context = ws.workspaceOf(taskId)
  const isolated = isWorktreeCtx(context) ? context.slice('worktree:'.length) : undefined
  const task = await hostInvoke('tasks.create', {
    projectId: project.id,
    title,
    mode: isolated ? 'worktree' : 'current',
    workspaceId: isolated,
  })
  try {
    const session = await hostInvoke('agent.start', task.id, prompt, settings, [], [])
    await ws.refresh()
    ws.openTask(task.id)
    ws.openView(task.id, { kind: 'agent', sessionId: session.id })
  } catch (error) {
    await hostInvoke('tasks.delete', task.id, false).catch(() => {})
    await ws.refresh().catch(() => {})
    throw error
  }
}
