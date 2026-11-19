import { useState } from 'react'
import type { AgentSettings, GitStatus, GitStatusEntry, RepositoryBinding } from '@ramu/shared/types'
import { t } from '../../i18n'
import { useModelSets } from '../../models/ModelSets'
import { errorText } from '../../workspace/TaskPane'
import { useWorkspace } from '../../workspace/workspace'
import { startCheckoutChat } from './startCheckoutChat'
import { useHost } from '../../workspace/HostProvider'
import type { RamuBridge } from '@ramu/shared/api'

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
  /** All conflicts, or only the given files. */
  const resolveWithAi = async (only?: string[]) => {
    const files = only ? conflicts.filter((entry) => only.includes(entry.path)) : conflicts
    if (!ws.projectOf(taskId) || !files.length) return
    setResolving(true)
    try {
      requireSaved()
      await startConflictChat(ws, invoke, {
        taskId,
        binding,
        kind: status?.operation ?? 'merge',
        paths: files.map((entry) => entry.path),
        whole: !only,
        settings: settings.model ? settings : initialSettings,
      })
    } catch (e) {
      reportError(errorText(e))
    } finally {
      setResolving(false)
    }
  }
  return { resolving, resolveWithAi }
}

/**
 * Starts an agent thread in this checkout that resolves the given conflicted files. Conflicts get their own thread, so
 * its transcript is a record of what was decided and why.
 */
export async function startConflictChat(
  ws: ReturnType<typeof useWorkspace>,
  invoke: RamuBridge['invoke'],
  input: {
    taskId: string
    binding: RepositoryBinding
    kind: string
    paths: string[]
    /** Every conflicted file, rather than a chosen few. */
    whole: boolean
    settings: AgentSettings
  },
): Promise<void> {
  const { binding, kind, paths } = input
  const prompt = [
    `Resolve ${paths.length} ${kind} ${paths.length === 1 ? 'conflict' : 'conflicts'} in ${binding.repoName}.`,
    '',
    '<ramu-context>',
    `Repository: ${binding.repoName} (${binding.cwd})`,
    input.whole ? 'Conflicted files:' : 'Resolve only these files; leave other conflicted files as they are:',
    ...paths.map((path) => `- ${path}`),
    '',
    'For each file: read it, work out what each side intended (git log/diff if unclear), edit it into one correct result with no conflict markers, and git add it.',
    'Run cheap quick checks (typecheck or nearby tests) if available.',
    `Do not commit, continue, abort or skip the ${kind}, and do not push. I will review and continue from Source Control.`,
    'Reply briefly: one line per file on how it was resolved, plus anything you were unsure about. No preamble.',
    '</ramu-context>',
  ].join('\n')
  await startCheckoutChat(
    ws,
    input.taskId,
    paths.length === 1 && !input.whole
      ? t('Resolve conflicts in {0}', { '0': paths[0]! })
      : t('Resolve {0} conflicts in {1}', { '0': kind, '1': binding.repoName }),
    prompt,
    input.settings,
    invoke,
  )
}
