import type { CommitBranchOptions, GitStatus } from '@ramu/shared/types'
import type { Chat } from './types'
import type { useStore } from './store'

type Invoke = ReturnType<typeof useStore>['invoke']
type GitChat = Pick<Chat, 'computerId' | 'taskId' | 'sessionId' | 'provider' | 'model'>

/** Model settings for drafting a commit message: the chat's own session when it has one. */
export async function commitSettings(invoke: Invoke, chat: GitChat) {
  return chat.sessionId
    ? (await invoke(chat.computerId, 'agent.get', chat.sessionId)).settings
    : { provider: chat.provider, model: chat.model, effort: null, access: 'auto' as const, autoFallback: true }
}

/**
 * Leaves out files another thread in the same checkout wrote last, so "stage everything" takes only this thread's
 * work. A host without the check stages them all, as before.
 */
export async function ownPaths(invoke: Invoke, chat: GitChat, repoId: string, paths: string[]) {
  const theirs = new Set(
    await invoke(chat.computerId, 'git.otherThreadPaths', chat.taskId, repoId).catch(() => [] as string[]),
  )
  return paths.filter((path) => !theirs.has(path))
}

/** Stages everything when nothing is staged, then drafts a message with AI. Shared by Source Control and the header shortcut. */
export async function draftCommit(invoke: Invoke, chat: GitChat, repoId: string, stageAll?: string[]) {
  const mine = stageAll?.length ? await ownPaths(invoke, chat, repoId, stageAll) : []
  if (mine.length) await invoke(chat.computerId, 'git.stage', chat.taskId, repoId, mine)
  return invoke(chat.computerId, 'git.generateCommit', chat.taskId, repoId, await commitSettings(invoke, chat))
}

export const isStaged = (entry: GitStatus['entries'][number]) => Boolean(entry.staged)

/**
 * The header's one-tap Commit & push: stage all if needed, AI message, commit, push. `chooseBranch` asks where the commit
 * goes on the default branch, as Source Control does; null from it cancels before anything changes, and returns null.
 */
export async function commitAndPush(
  invoke: Invoke,
  chat: GitChat,
  repoId: string,
  chooseBranch?: () => Promise<CommitBranchOptions | null>,
) {
  const status = await invoke(chat.computerId, 'git.status', chat.taskId, repoId)
  if (!status.entries.length) throw new Error('There are no changes to commit.')
  if (status.entries.some((entry) => entry.staged === 'unmerged' || entry.unstaged === 'unmerged'))
    throw new Error('Resolve conflicts before committing.')
  const onBranch = chooseBranch ? await chooseBranch() : undefined
  if (onBranch === null) return null
  const draft = await draftCommit(
    invoke,
    chat,
    repoId,
    !status.entries.some(isStaged)
      ? status.entries.filter((entry) => entry.unstaged).map((entry) => entry.path)
      : undefined,
  )
  if (onBranch)
    await invoke(
      chat.computerId,
      'git.commit',
      chat.taskId,
      repoId,
      draft.message,
      draft.fingerprint,
      undefined,
      onBranch,
    )
  else await invoke(chat.computerId, 'git.commit', chat.taskId, repoId, draft.message, draft.fingerprint)
  await invoke(chat.computerId, 'git.push', chat.taskId, repoId)
  return draft.message
}

export const pushBranch = (invoke: Invoke, chat: GitChat, repoId: string) =>
  invoke(chat.computerId, 'git.push', chat.taskId, repoId)
