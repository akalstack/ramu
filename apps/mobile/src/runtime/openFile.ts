import { useSay } from '../i18n'
import { Alert, Linking } from 'react-native'
import { useRouter } from 'expo-router'
import { localFileLink } from '@ramu/shared/workspace/fileLinks'
import { isTerminalUrl, terminalPathTargets, type TerminalLinkKind } from '@ramu/shared/workspace/terminalLinks'
import { useStore } from './store'
import type { Chat } from './types'

export type FileMode = 'file' | 'changes' | 'staged' | 'all'

/**
 * Resolves a path as written in text (`src/a.ts`, `repo/src/a.ts:12`, `docs/`, `file:///…`) against a thread's or
 * project's folders, as the desktop does: a file goes to `openFile`, a folder is revealed in the Explorer. Returns
 * whether it opened something. `quiet` skips the alert for a path that is not there, for text that only looks like one,
 * such as a word tapped in a terminal.
 */
export function useOpenLink(
  computerId: string | undefined,
  contextId: string | undefined,
  openFile: (repoId: string, path: string, line?: number) => void,
) {
  const store = useStore()
  const say = useSay()
  const router = useRouter()
  return async (href: string, { quiet = false }: { quiet?: boolean } = {}): Promise<boolean> => {
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
      return true
    } catch (error) {
      if (!quiet) Alert.alert(say('Could not open file'), error instanceof Error ? error.message : String(error))
      return false
    }
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

/**
 * Opens what was tapped in a terminal: a web address in the phone's browser, a path on the file screen. A path is tried
 * from the shell's folder first, then among the thread's folders; text that only looks like a path opens nothing.
 */
export function useOpenTerminalLink(computerId: string | undefined, contextId: string | undefined) {
  const router = useRouter()
  const openLink = useOpenLink(computerId, contextId, (repoId, path, line) =>
    router.push({
      pathname: '/file',
      params: { computer: computerId!, ctx: contextId!, repoId, path, ...(line ? { line: String(line) } : {}) },
    }),
  )
  return async (kind: TerminalLinkKind, text: string, cwd: string | undefined) => {
    if (kind === 'url') {
      if (isTerminalUrl(text)) await Linking.openURL(text).catch(() => {})
      return
    }
    for (const target of terminalPathTargets(text, cwd)) if (await openLink(target, { quiet: true })) return
  }
}
