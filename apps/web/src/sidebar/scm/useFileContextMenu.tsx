import { useState } from 'react'
import { Copy, FileText, Minus, Plus, Undo2 } from 'lucide-react'
import type { GitStatusEntry } from '@ramu/shared/types'
import { t } from '../../i18n'
import { copyText } from '../../ipc'
import { useContextMenu } from '../../Menu'
import { errorText } from '../../workspace/TaskPane'
import { useWorkspace } from '../../workspace/workspace'

/** Right-click menu of a Staged / Changes row; `selectEntry` records which row it was opened on. */
export function useFileContextMenu({
  taskId,
  repoId,
  busy,
  stagePaths,
  onDiscard,
  reportError,
}: {
  taskId: string
  repoId: string
  busy: boolean
  stagePaths: (paths: string[], stage: boolean) => void
  onDiscard: (paths: string[]) => void
  reportError: (message: string) => void
}) {
  const ws = useWorkspace()
  const [contextEntry, setContextEntry] = useState<{ entry: GitStatusEntry; staged: boolean } | null>(null)
  const copyPath = async (path: string) => {
    try {
      await copyText(path)
    } catch (reason) {
      reportError(errorText(reason))
    }
  }
  const contextMenu = useContextMenu(
    'Source control file actions',
    contextEntry
      ? [
          {
            key: 'diff',
            label: t('Open changes'),
            onSelect: () =>
              ws.openView(taskId, {
                kind: 'diff',
                repoId,
                path: contextEntry.entry.path,
                staged: contextEntry.staged,
              }),
          },
          {
            key: 'open',
            label: (
              <>
                <FileText size={14} />
                {t('Open file')}
              </>
            ),
            disabled: (contextEntry.staged ? contextEntry.entry.staged : contextEntry.entry.unstaged) === 'deleted',
            onSelect: () => ws.openView(taskId, { kind: 'file', repoId, path: contextEntry.entry.path }),
          },
          {
            key: 'stage',
            label: (
              <>
                {contextEntry.staged ? <Minus size={14} /> : <Plus size={14} />}
                {contextEntry.staged ? t('Unstage changes') : t('Stage changes')}
              </>
            ),
            disabled: busy,
            onSelect: () => stagePaths([contextEntry.entry.path], !contextEntry.staged),
          },
          ...(!contextEntry.staged
            ? [
                {
                  key: 'discard',
                  label: (
                    <>
                      <Undo2 size={14} />
                      {t('Discard changes…')}
                    </>
                  ),
                  danger: true,
                  disabled: busy,
                  onSelect: () => onDiscard([contextEntry.entry.path]),
                },
              ]
            : []),
          {
            key: 'copy',
            label: (
              <>
                <Copy size={14} />
                {t('Copy relative path')}
              </>
            ),
            onSelect: () => void copyPath(contextEntry.entry.path),
          },
        ]
      : [],
  )
  const selectEntry = (entry: GitStatusEntry, staged: boolean) => setContextEntry({ entry, staged })
  return { contextMenu, selectEntry }
}
