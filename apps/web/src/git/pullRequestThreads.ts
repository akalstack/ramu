import type { AgentSettings } from '@ramu/shared/types'
import type { RamuBridge } from '@ramu/shared/api'
import { t } from '../i18n'
import type { useWorkspace } from '../workspace/workspace'

/**
 * Opens a pull request in a thread: the thread already on it, or a new worktree on its branch whose agent catches up
 * on it (`work`) or reviews it read-only (`review`). The new thread is removed again when its first message fails.
 */
export async function openPullRequestThread(
  ws: ReturnType<typeof useWorkspace>,
  invoke: RamuBridge['invoke'],
  input: { taskId: string; repoId: string; url: string; purpose: 'work' | 'review'; settings: AgentSettings },
): Promise<void> {
  const handoff = await invoke('forge.pullRequestHandoff', input.taskId, input.repoId, input.url, input.purpose)
  if (handoff.existing) {
    ws.openTask(handoff.existing.taskId)
    return
  }
  if (!handoff.checkout) throw new Error(t('This pull request comes from a fork that cannot be checked out here.'))
  const project = ws.projectOf(input.taskId)
  if (!project) throw new Error(t('This checkout is not part of a project.'))
  const task = await invoke('tasks.create', {
    projectId: project.id,
    title: handoff.title,
    mode: 'worktree',
    checkout: handoff.checkout,
  })
  try {
    const bindings = await invoke('tasks.setup', task.id)
    const failed = bindings.find((binding) => binding.setupState === 'failed')
    if (failed) throw new Error(failed.setupError || t('Workspace setup failed'))
    const session = await invoke('agent.start', task.id, handoff.prompt, input.settings, [], [])
    await invoke('forge.linkPullRequest', task.id, input.repoId, input.url, input.purpose).catch(() => {
      // The thread works without the link; its row picks the pull request up from its branch on the next look.
    })
    await ws.refresh()
    ws.openTask(task.id)
    ws.openView(task.id, { kind: 'agent', sessionId: session.id })
  } catch (error) {
    await invoke('tasks.delete', task.id, true).catch(() => {})
    await ws.refresh().catch(() => {})
    throw error
  }
}
