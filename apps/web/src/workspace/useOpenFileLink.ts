import { useCallback } from 'react'
import { localFileLink } from '@ramu/shared/workspace/fileLinks'
import { t } from '../i18n'
import { notifyError } from '../chat/Notifications'
import { useHost } from './HostProvider'
import { errorText } from '../lib/errors'
import { useWorkspace } from './workspace'

/**
 * Opens a path as written in chat, the composer or a Markdown file (`src/a.ts:12`, `repo/docs/`, `file:///…`): a file
 * opens in the editor at its line, a folder is revealed in the Explorer.
 */
export function useOpenFileLink(taskId: string | undefined) {
  const ws = useWorkspace()
  const { invoke } = useHost()
  return useCallback(
    (href: string) => {
      const local = localFileLink(href)
      if (!taskId || !local) return
      // Composer mentions carry a repository name; resolve that prefix to the checkout first.
      const binding = (ws.bindings[ws.workspaceOf(taskId)] ?? ws.bindings[taskId] ?? []).find((entry) =>
        local.path.startsWith(`${entry.repoName}/`),
      )
      const target = binding
        ? `${binding.cwd}/${local.path.slice(binding.repoName.length + 1)}${local.line ? `:${local.line}:${local.column ?? 1}` : ''}`
        : href
      void invoke('files.resolveLink', taskId, target, { folders: true })
        .then((file) => {
          if (!file)
            throw new Error(t('This path was not found in this thread’s folders, or it matches more than one place.'))
          if (file.kind === 'folder') {
            ws.setSidebar('explorer')
            requestAnimationFrame(() =>
              window.dispatchEvent(
                new CustomEvent('ramu:explorer-reveal', { detail: { repoId: file.repoId, path: file.path } }),
              ),
            )
            return
          }
          ws.openView(taskId, {
            kind: 'file',
            repoId: file.repoId,
            path: file.path,
            ...(file.line
              ? {
                  selection: {
                    line: file.line,
                    column: file.column ?? 1,
                    endColumn: file.column ?? 1,
                    requestId: crypto.randomUUID(),
                  },
                }
              : {}),
          })
        })
        .catch((error) => notifyError(errorText(error), 'Open file'))
    },
    [taskId, ws, invoke],
  )
}
