import { useState } from 'react'
import type { AgentSettings, CommitDraft, GitStatus, RepositoryBinding } from '@ramu/shared/types'
import { invoke } from '../../ipc'
import { errorText } from '../../workspace/TaskPane'
import { chooseCommitBranch } from '../../git/CommitBranchDialog'
import { withGitBusy } from '../../git/gitBusy'
import type { GitRun } from './types'

/** Commit message, AI draft and the commit action (with optional push, sync, amend or new branch). */
export function useCommitFlow({
  taskId,
  binding,
  settings,
  status,
  conflictCount,
  loading,
  busy,
  run,
  requireSaved,
  reportError,
}: {
  taskId: string
  binding: RepositoryBinding
  settings: AgentSettings
  status: GitStatus | null
  conflictCount: number
  loading: boolean
  busy: boolean
  run: GitRun
  requireSaved: () => void
  reportError: (message: string) => void
}) {
  const [message, setMessage] = useState('')
  const [draft, setDraft] = useState<CommitDraft | null>(null)
  const [generating, setGenerating] = useState(false)
  const draftMessage = async (includeBranch = false) => {
    setGenerating(true)
    try {
      const value = await withGitBusy(taskId, binding.repoId, () =>
        invoke('git.generateCommit', taskId, binding.repoId, settings, includeBranch),
      )
      setDraft(value)
      setMessage(value.message)
      return value
    } catch (e) {
      reportError(errorText(e))
      return null
    } finally {
      setGenerating(false)
    }
  }
  const generate = () => void draftMessage()
  // With no message typed, Commit drafts one from the staged changes first and commits it as written.
  const commit = async (
    action: 'commit' | 'amend' | 'push' | 'sync' | 'new-branch' = 'commit',
    stagePaths?: string[],
  ) => {
    if (loading || busy || generating || conflictCount) return
    const branchOptions =
      action === 'push' || action === 'sync' || action === 'new-branch'
        ? await chooseCommitBranch(taskId, binding.repoId, action === 'new-branch', action === 'sync' ? 'sync' : 'push')
        : undefined
    if (branchOptions === null) return
    if (branchOptions?.newBranch || branchOptions?.autoBranch) requireSaved()
    if (stagePaths?.length) await invoke('git.stage', taskId, binding.repoId, stagePaths)
    let text = message,
      fingerprint = draft?.fingerprint,
      suggested = draft?.branch
    const amendHead = action === 'amend' ? (status?.oid ?? undefined) : undefined
    if (action === 'amend' && !amendHead) return
    if (!text.trim() && action !== 'amend') {
      // The draft also names the feature branch when one is about to be created.
      const value = await draftMessage(!!branchOptions?.autoBranch)
      if (!value?.message.trim()) return
      text = value.message
      fingerprint = value.fingerprint
      suggested = value.branch
    }
    await run(async () => {
      if (action === 'sync') requireSaved()
      await invoke(
        'git.commit',
        taskId,
        binding.repoId,
        text,
        fingerprint,
        amendHead,
        branchOptions?.autoBranch && suggested ? { ...branchOptions, newBranch: suggested } : branchOptions,
      )
      setMessage('')
      setDraft(null)
      const target = branchOptions?.autoBranch
        ? (await invoke('git.commitBranchInfo', taskId, binding.repoId)).branch
        : (branchOptions?.newBranch ?? branchOptions?.expectedBranch)
      if (action === 'push') await invoke('git.push', taskId, binding.repoId, target ?? undefined)
      if (action === 'sync') await invoke('git.sync', taskId, binding.repoId)
    })
  }
  return { message, setMessage, draft, setDraft, generating, generate, commit }
}

export type CommitFn = ReturnType<typeof useCommitFlow>['commit']
