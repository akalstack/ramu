import type { GitStatus } from '@ramu/shared/types'
import type { Chat } from './types'
import type { useStore } from './store'

type Invoke = ReturnType<typeof useStore>['invoke']
type GitChat = Pick<Chat, 'computerId' | 'taskId' | 'sessionId' | 'provider' | 'model'>

/** Model settings for drafting a commit message: the chat's own session when it has one. */
export async function commitSettings(invoke: Invoke, chat: GitChat) {
  return chat.sessionId ? (await invoke(chat.computerId, 'agent.get', chat.sessionId)).settings : { provider: chat.provider, model: chat.model, effort: null, access: 'auto' as const, autoFallback: true }
}

/** Stages everything when nothing is staged, then drafts a message with AI. Shared by Source Control and the header shortcut. */
export async function draftCommit(invoke: Invoke, chat: GitChat, repoId: string, stageAll?: string[]) {
  if (stageAll?.length) await invoke(chat.computerId, 'git.stage', chat.taskId, repoId, stageAll)
  return invoke(chat.computerId, 'git.generateCommit', chat.taskId, repoId, await commitSettings(invoke, chat))
}

export const isStaged = (entry: GitStatus['entries'][number]) => Boolean(entry.staged)

/** The header's one-tap Commit & push: stage all if needed, AI message, commit, push. */
export async function commitAndPush(invoke: Invoke, chat: GitChat, repoId: string) {
  const status = await invoke(chat.computerId, 'git.status', chat.taskId, repoId)
  if (!status.entries.length) throw new Error('There are no changes to commit.')
  const draft = await draftCommit(invoke, chat, repoId, status.entries.some(isStaged) ? undefined : status.entries.map(e => e.path))
  await invoke(chat.computerId, 'git.commit', chat.taskId, repoId, draft.message, draft.fingerprint)
  await invoke(chat.computerId, 'git.push', chat.taskId, repoId)
  return draft.message
}

export const pushBranch = (invoke: Invoke, chat: GitChat, repoId: string) => invoke(chat.computerId, 'git.push', chat.taskId, repoId)
