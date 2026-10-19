import { useState } from 'react'
import type { AgentSettings, GitStatus, GitStatusEntry, RepositoryBinding } from '@ramu/shared/types'
import { t } from '../../i18n'
import { useModelSets } from '../../models/ModelSets'
import { errorText } from '../../workspace/TaskPane'
import { useWorkspace } from '../../workspace/workspace'
import { startCheckoutChat } from './startCheckoutChat'
import { useHost } from '../../workspace/HostProvider'

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
  const { invoke } = useHost()
  const { initialSettings } = useModelSets()
  const [resolving, setResolving] = useState(false)
  // Conflicts get their own chat in this checkout, so the transcript is a record of what was decided and why.
  const resolveWithAi = async () => {
    if (!ws.projectOf(taskId) || !conflicts.length) return
    setResolving(true)
    try {
      requireSaved()
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
      await startCheckoutChat(
        ws,
        taskId,
        t('Resolve {0} conflicts in {1}', { '0': kind, '1': binding.repoName }),
        prompt,
        settings.model ? settings : initialSettings,
        invoke,
      )
    } catch (e) {
      reportError(errorText(e))
    } finally {
      setResolving(false)
    }
  }
  return { resolving, resolveWithAi }
}
