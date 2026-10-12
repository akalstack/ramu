import { t } from './i18n'
import { notify } from '@/components/app-toaster'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/types'
import { invoke } from './ipc'
import { notifyError } from './Notifications'
import { errorText } from './TaskPane'
import type { WorkspaceApi } from './workspace'

/** A Source Control repository section that can run its own Commit & Push (with whatever message is typed there). */
export interface CommitTarget {
  taskId: string
  repoId: string
  staged: () => number
  /** Every change, staged or not. */
  changes: () => number
  focused: () => boolean
  commitAndPush: () => Promise<void>
}

const SEVERAL = () => t("Several repositories have changes. Click into one in Source Control, then press the shortcut again.")
const NOTHING = () => t("There is nothing to commit.")

/** Staged changes win; with nothing staged anywhere, any repository with changes counts. Focus picks between several. */
function pick<T>(entries: T[], staged: (entry: T) => boolean, changed: (entry: T) => boolean, focused: (entry: T) => boolean): T | 'several' | null {
  const pool = entries.some(staged) ? entries.filter(staged) : entries.filter(changed)
  return pool.find(focused) ?? (pool.length === 1 ? pool[0]! : pool.length ? 'several' : null)
}

const targets = new Set<CommitTarget>()
export function registerCommitTarget(target: CommitTarget) {
  targets.add(target)
  return () => { targets.delete(target) }
}

/**
 * The Commit & Push shortcut, with VS Code's smart-commit rule: what is staged gets committed; with nothing staged,
 * every change is staged first (as T3 Code's Commit & push does). It runs through the open Source Control panel when
 * there is one (using any message typed there), otherwise directly with an AI-drafted message.
 * When several repositories qualify and none is focused, it opens Source Control instead of guessing.
 */
export async function commitAndPush(ws: WorkspaceApi, ctx: string) {
  const showScm = (message: string) => { ws.setSidebar('scm'); notifyError(message, t("Commit & Push")) }
  const mounted = [...targets].filter((target) => target.taskId === ctx)
  if (mounted.length) {
    const target = pick(mounted, (entry) => entry.staged() > 0, (entry) => entry.changes() > 0, (entry) => entry.focused())
    if (target && target !== 'several') return target.commitAndPush()
    return showScm(target ? SEVERAL() : NOTHING())
  }
  const bindings = (ws.bindings[ctx] ?? []).filter((binding) => binding.setupState === 'ready' && !binding.folderOnly)
  const states = (await Promise.allSettled(bindings.map(async (binding) => ({ binding, status: await invoke('git.status', ctx, binding.repoId) }))))
    .flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
  const hasStaged = (state: (typeof states)[number]) => state.status.entries.some((entry) => entry.staged && entry.staged !== 'unmerged')
  const target = pick(states, hasStaged, (state) => state.status.entries.length > 0, () => false)
  if (!target || target === 'several') return showScm(target ? SEVERAL() : NOTHING())
  const { binding, status } = target
  if (status.operation || status.entries.some((entry) => entry.staged === 'unmerged' || entry.unstaged === 'unmerged')) return showScm(t("Resolve the conflicts in {0} first.", { "0": binding.repoName }))
  if (!status.branch || !status.remote) return showScm(t("{0} has no branch with a remote to push to.", { "0": binding.repoName }))
  const stageAll = !hasStaged(target)
  const run = async () => {
    if (stageAll) await invoke('git.stage', ctx, binding.repoId, status.entries.filter((entry) => entry.unstaged).map((entry) => entry.path))
    const draft = await invoke('git.generateCommit', ctx, binding.repoId, DEFAULT_AGENT_SETTINGS)
    if (!draft.message.trim()) throw new Error(t('Could not draft a commit message.'))
    await invoke('git.commit', ctx, binding.repoId, draft.message, draft.fingerprint)
    await invoke('git.push', ctx, binding.repoId)
    return draft.message.split('\n')[0]!
  }
  const work = run().finally(() => window.dispatchEvent(new Event('ramu:git-updated')))
  void notify.promise(work, {
    loading: { title: t("Committing and pushing {0}…", { "0": binding.repoName }), type: 'loading' },
    success: (subject) => ({ title: t("Pushed “{0}” to {1}", { "0": subject, "1": status.branch! }), type: 'success' }),
    error: (reason) => ({ title: errorText(reason), description: t("Commit & Push"), type: 'error', timeout: 0 }),
  }).catch(() => {})
  await work.catch(() => {})
}
