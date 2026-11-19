import type { AgentSettings } from '@ramu/shared/types'
import type { useStore } from './store'

type Invoke = ReturnType<typeof useStore>['invoke']

/**
 * Opens a pull request in a thread, as the desktop does: the thread already on it, or a new worktree on its branch whose
 * agent catches up on it (`work`) or reviews it read-only (`review`). The new thread is removed again when its first
 * message fails. Resolves with the host's task id to open.
 */
export async function openPullRequestThread(
  invoke: Invoke,
  input: {
    computerId: string
    taskId: string
    /** The project's id on the host. */
    projectId: string
    repoId: string
    url: string
    purpose: 'work' | 'review'
    settings: AgentSettings
    /** Reasons in the phone's language. */
    say: (text: string) => string
  },
): Promise<string> {
  const { computerId } = input
  const handoff = await invoke(
    computerId,
    'forge.pullRequestHandoff',
    input.taskId,
    input.repoId,
    input.url,
    input.purpose,
  )
  if (handoff.existing) return handoff.existing.taskId
  if (!handoff.checkout)
    throw new Error(input.say('This pull request comes from a fork that cannot be checked out here.'))
  const task = await invoke(computerId, 'tasks.create', {
    projectId: input.projectId,
    title: handoff.title,
    mode: 'worktree',
    checkout: handoff.checkout,
  })
  try {
    const bindings = await invoke(computerId, 'tasks.setup', task.id)
    const failed = bindings.find((binding) => binding.setupState === 'failed')
    if (failed) throw new Error(failed.setupError || input.say('Workspace setup failed'))
    await invoke(computerId, 'agent.start', task.id, handoff.prompt, input.settings, [], [])
    await invoke(computerId, 'forge.linkPullRequest', task.id, input.repoId, input.url, input.purpose).catch(() => {
      // The thread works without the link; its row picks the pull request up from its branch on the next look.
    })
    return task.id
  } catch (error) {
    await invoke(computerId, 'tasks.delete', task.id, true).catch(() => {})
    throw error
  }
}
