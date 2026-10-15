import { useState } from 'react'
import type { AgentSettings, GitStatus, GitStatusEntry, RepositoryBinding } from '@ramu/shared/types'
import { t } from '../../i18n'
import { invoke } from '../../ipc'
import { useModelSets } from '../../ModelSets'
import { errorText } from '../../TaskPane'
import { isWorktreeCtx, useWorkspace } from '../../workspace'

/** Starts an agent chat in this checkout that resolves the conflicted files. */
export function useResolveWithAi({
  taskId,
  binding,
  status,
  conflicts,
  settings,
  requireSaved,
  reportError,
}: {
  taskId: string
  binding: RepositoryBinding
  status: GitStatus | null
  conflicts: GitStatusEntry[]
  settings: AgentSettings
  requireSaved: () => void
  reportError: (message: string) => void
}) {
  const ws = useWorkspace()
  const { initialSettings } = useModelSets()
  const [resolving, setResolving] = useState(false)
  // Conflicts get their own chat in this checkout, so the transcript is a record of what was decided and why.
  const resolveWithAi = async () => {
    const project = ws.projectOf(taskId)
    if (!project || !conflicts.length) return
    setResolving(true)
    let created: string | null = null
    try {
      requireSaved()
      const context = ws.workspaceOf(taskId)
      const isolated = isWorktreeCtx(context) ? context.slice('worktree:'.length) : undefined
      const kind = status?.operation ?? 'merge'
      const prompt = [
        `Resolve ${conflicts.length} ${kind} ${conflicts.length === 1 ? 'conflict' : 'conflicts'} in ${binding.repoName}.`,
        '',
        '<ramu-context>',
        `Repository: ${binding.repoName} (${binding.cwd})`,
        'Conflicted files:',
        ...conflicts.map((entry) => `- ${entry.path}`),
        '',
        'For each file: read it, work out what each side intended (git log/diff if unclear), edit it into one correct result with no conflict markers, and git add it.',
        'Run cheap quick checks (typecheck or nearby tests) if available.',
        `Do not commit, continue, abort or skip the ${kind}, and do not push. I will review and continue from Source Control.`,
        'Reply briefly: one line per file on how it was resolved, plus anything you were unsure about. No preamble.',
        '</ramu-context>',
      ].join('\n')
      const task = await invoke('tasks.create', {
        projectId: project.id,
        title: t('Resolve {0} conflicts in {1}', { '0': kind, '1': binding.repoName }),
        mode: isolated ? 'worktree' : 'current',
        workspaceId: isolated,
      })
      created = task.id
      const session = await invoke('agent.start', task.id, prompt, settings.model ? settings : initialSettings, [], [])
      created = null
      await ws.refresh()
      ws.openTask(task.id)
      ws.openView(task.id, { kind: 'agent', sessionId: session.id })
    } catch (e) {
      if (created) {
        await invoke('tasks.delete', created, false).catch(() => {})
        await ws.refresh().catch(() => {})
      }
      reportError(errorText(e))
    } finally {
      setResolving(false)
    }
  }
  return { resolving, resolveWithAi }
}
