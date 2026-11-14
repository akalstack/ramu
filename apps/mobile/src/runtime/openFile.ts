import { useSay } from '../i18n'
import { Alert } from 'react-native'
import { useRouter } from 'expo-router'
import { localFileLink } from '@ramu/shared/workspace/fileLinks'
import { useStore } from './store'
import type { Chat } from './types'

export type FileMode = 'file' | 'changes' | 'staged' | 'all'

/**
 * Resolves a path as written in text (`src/a.ts`, `repo/src/a.ts:12`, `docs/`, `file:///…`) against a thread's or
 * project's folders, as the desktop does: a file goes to `openFile`, a folder is revealed in the Explorer. Returns
 * whether it was a local reference at all.
 */
export function useOpenLink(
  computerId: string | undefined,
  contextId: string | undefined,
  openFile: (repoId: string, path: string, line?: number) => void,
) {
  const store = useStore()
  const say = useSay()
  const router = useRouter()
  return async (href: string): Promise<boolean> => {
    const local = localFileLink(href)
    if (!local || !computerId || !contextId) return false
    try {
      // Composer mentions carry the repository's name; resolve that prefix to its checkout first.
      const bindings = await store.invoke(computerId, 'tasks.bindings', contextId)
      const binding = bindings.find((entry) => local.path.startsWith(`${entry.repoName}/`))
      const target = binding
        ? `${binding.cwd}/${local.path.slice(binding.repoName.length + 1)}${local.line ? `:${local.line}:${local.column ?? 1}` : ''}`
        : href
      const file = await store.invoke(computerId, 'files.resolveLink', contextId, target, { folders: true })
      if (!file) throw new Error('This path was not found in this thread’s folders, or it matches more than one place.')
      if (file.kind === 'folder')
        router.push({
          pathname: '/explorer',
          params: {
            computer: computerId,
            ctx: contextId,
            repoId: file.repoId,
            path: file.path,
            revealId: String(Date.now()),
          },
        })
      else openFile(file.repoId, file.path, file.line)
    } catch (error) {
      Alert.alert(say('Could not open file'), error instanceof Error ? error.message : String(error))
    }
    return true
  }
}

/**
 * Opens files the way the desktop does: from a reference in the chat (an `@file`, a markdown link, a tool's path),
 * from a changed-file row (its unstaged or staged diff) or from the explorer. All of them land on one file screen.
 */
export function useOpenFile(chat: Pick<Chat, 'id' | 'computerId' | 'taskId'> | undefined) {
  const router = useRouter()
  const open = (repoId: string, path: string, options: { line?: number; mode?: FileMode } = {}) => {
    if (!chat) return
    router.push({
      pathname: '/chat/[id]/file',
      params: {
        id: chat.id,
        repoId,
        path,
        ...(options.line ? { line: String(options.line) } : {}),
        ...(options.mode ? { mode: options.mode } : {}),
      },
    })
  }
  const openLink = useOpenLink(chat?.computerId, chat?.taskId, (repoId, path, line) => open(repoId, path, { line }))
  return { open, openLink }
}
