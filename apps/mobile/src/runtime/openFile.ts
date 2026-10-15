import { Alert } from 'react-native'
import { useRouter } from 'expo-router'
import { localFileLink } from '@ramu/shared/workspace/fileLinks'
import { useStore } from './store'
import type { Chat } from './types'

export type FileMode = 'file' | 'changes' | 'staged' | 'all'

/**
 * Opens files the way the desktop does: from a reference in the chat (an `@file`, a markdown link, a tool's path),
 * from a changed-file row (its unstaged or staged diff) or from the explorer. All of them land on one file screen.
 */
export function useOpenFile(chat: Pick<Chat, 'id' | 'computerId' | 'taskId'> | undefined) {
  const store = useStore()
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
  /** A path or link as written in text: `src/a.ts`, `repo/src/a.ts:12`, `file:///…`. Returns whether it was a file reference. */
  const openLink = async (href: string): Promise<boolean> => {
    const local = localFileLink(href)
    if (!local || !chat?.taskId) return false
    try {
      // Composer mentions carry the repository's name; resolve that prefix to its checkout first, as the desktop does.
      const bindings = await store.invoke(chat.computerId, 'tasks.bindings', chat.taskId)
      const binding = bindings.find((entry) => local.path.startsWith(`${entry.repoName}/`))
      const target = binding
        ? `${binding.cwd}/${local.path.slice(binding.repoName.length + 1)}${local.line ? `:${local.line}:${local.column ?? 1}` : ''}`
        : href
      const file = await store.invoke(chat.computerId, 'files.resolveLink', chat.taskId, target)
      if (!file)
        throw new Error('This file was not found in this chat’s folders, or the path matches more than one file.')
      open(file.repoId, file.path, { line: file.line })
    } catch (error) {
      Alert.alert('Could not open file', error instanceof Error ? error.message : String(error))
    }
    return true
  }
  return { open, openLink }
}
