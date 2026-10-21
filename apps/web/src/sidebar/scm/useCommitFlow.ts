import { syncRepositories } from '../../git/syncRepositories'
import { useState } from 'react'
import type { AgentSettings, CommitDraft, GitStatus, RepositoryBinding } from '@ramu/shared/types'
import { errorText } from '../../workspace/TaskPane'
import { chooseCommitBranch } from '../../git/CommitBranchDialog'
import { applyCommitScope, chooseCommit, type CommitPlan } from '../../git/CommitDialog'
import { withGitBusy } from '../../git/gitBusy'
import { openCreatePullRequest } from '../../git/CreatePullRequestHost'
import { reportGitJob } from '../../git/reportGitJob'
import { t } from '../../i18n'
import { commitActionLabel } from './helpers'
import type { GitRun } from './types'
import { useHost } from '../../workspace/HostProvider'

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
  const { invoke } = useHost()
  // Smart commit: what is staged gets committed; with nothing staged, every change is staged first.
  const hasStaged = !!status?.entries.some((entry) => entry.staged && entry.staged !== 'unmerged')
  const allPaths = hasStaged
    ? undefined
    : status?.entries.filter((entry) => entry.unstaged && entry.unstaged !== 'unmerged').map((entry) => entry.path)
  const [message, setMessage] = useState('')
  const [draft, setDraft] = useState<CommitDraft | null>(null)
  const [generating, setGenerating] = useState(false)
  const draftMessage = async (includeBranch = false, stageAll = true) => {
    setGenerating(true)
    try {
      const value = await withGitBusy(taskId, binding.repoId, async () => {
        if (stageAll && allPaths?.length) await invoke('git.stage', taskId, binding.repoId, allPaths)
        return invoke('git.generateCommit', taskId, binding.repoId, settings, includeBranch)
      })
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
    /** Open the commit popup even when files are staged (the shortcut and the header button do). */
    ask = false,
    /** Open the popup with "Create a pull request after pushing" ticked. */
    pullRequest = false,
  ) => {
    if (loading || busy || generating || conflictCount) return
    // The popup picks files, message, action and branch; with files staged, Source Control's own button skips it.
    if (
      status &&
      (action === 'commit' || action === 'push' || action === 'sync') &&
      (ask || pullRequest || !hasStaged)
    ) {
      const plan = await chooseCommit({
        taskId,
        repoId: binding.repoId,
        repoName: binding.repoName,
        status,
        action: pullRequest ? 'push' : action,
        message,
        pullRequest,
      })
      if (!plan) return
      return commitPlan(plan)
    }
    const branchOptions =
      action === 'push' || action === 'sync' || action === 'new-branch'
        ? await chooseCommitBranch(
            taskId,
            binding.repoId,
            action === 'new-branch',
            action === 'sync' ? 'sync' : 'push',
            invoke,
          )
        : undefined
    if (branchOptions === null) return
    if (branchOptions?.newBranch || branchOptions?.autoBranch) requireSaved()
    // An amend rewrites the last commit with what is staged; it never takes unstaged edits.
    if (action !== 'amend') stagePaths = allPaths ?? stagePaths
    if (stagePaths?.length) await invoke('git.stage', taskId, binding.repoId, stagePaths)
    let text = message,
      fingerprint = draft?.fingerprint,
      suggested = draft?.branch
    const amendHead = action === 'amend' ? (status?.oid ?? undefined) : undefined
    if (action === 'amend' && !amendHead) return
    if (!text.trim() && action !== 'amend') {
      // The draft also names the feature branch when one is about to be created.
      const value = await draftMessage(!!branchOptions?.autoBranch, false)
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
      if (action === 'sync') await syncRepositories(invoke, taskId, [binding])
    })
  }
  /**
   * Runs what the commit popup chose as one git job, as one job reported in the notification bell: scope the index, draft a message if none was
   * written, commit, then push or sync. Every failure ends in an error toast and a bell notice instead of returning silently.
   */
  const commitPlan = async (plan: CommitPlan) => {
    const { branch } = plan
    let pushedTo: string | null = branch.newBranch ?? branch.expectedBranch
    const work = withGitBusy(taskId, binding.repoId, async () => {
      if (branch.newBranch || branch.autoBranch || plan.action === 'sync') requireSaved()
      await applyCommitScope(taskId, binding.repoId, status!, plan.paths, invoke)
      // A typed message has no draft fingerprint: the index was just rescoped, so an older draft's no longer matches.
      const drafted = plan.message.trim()
        ? null
        : await invoke('git.generateCommit', taskId, binding.repoId, settings, !!branch.autoBranch)
      const text = drafted?.message ?? plan.message
      if (!text.trim()) throw new Error(t('Could not draft a commit message.'))
      await invoke(
        'git.commit',
        taskId,
        binding.repoId,
        text,
        drafted?.fingerprint,
        undefined,
        branch.autoBranch && drafted?.branch ? { ...branch, newBranch: drafted.branch } : branch,
      )
      setMessage('')
      setDraft(null)
      if (branch.autoBranch) pushedTo = (await invoke('git.commitBranchInfo', taskId, binding.repoId)).branch
      if (plan.action === 'push') await invoke('git.push', taskId, binding.repoId, pushedTo ?? undefined)
      if (plan.action === 'sync') await syncRepositories(invoke, taskId, [binding])
      return text.split('\n')[0]!
    }).finally(() => window.dispatchEvent(new Event('ramu:git-updated')))
    void reportGitJob(work, {
      id: `git-job:${taskId}:${binding.repoId}`,
      success: (subject) =>
        plan.action === 'commit'
          ? t('Committed “{0}”', { '0': subject })
          : t('Committed “{0}” and {1} {2}', {
              '0': subject,
              '1': plan.action === 'sync' ? t('synced') : t('pushed to'),
              '2': plan.action === 'sync' ? '' : (pushedTo ?? ''),
            }),
      failure: { message: errorText, description: commitActionLabel(plan.action) },
    })
    // A failed commit or push leaves nothing to propose; otherwise the pull request dialog opens on the pushed branch.
    if (
      plan.pullRequest &&
      (await work.then(
        () => true,
        () => false,
      ))
    ) {
      await openCreatePullRequest(taskId, binding.repoId)
      return
    }
    await work.catch(() => {})
  }
  return { message, setMessage, draft, setDraft, generating, generate, commit }
}

export type CommitFn = ReturnType<typeof useCommitFlow>['commit']
