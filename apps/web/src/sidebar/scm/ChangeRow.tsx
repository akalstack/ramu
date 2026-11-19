import { Minus, Plus, Undo2 } from 'lucide-react'
import type { GitStatusEntry } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { t } from '../../i18n'
import type { useContextMenu } from '../../Menu'
import { FILE_DRAG_TYPE } from '../../composer/ComposerSuggestions'
import { useWorkspace } from '../../workspace/workspace'
import { FILE_ROW, FileRowLabel } from '../FileRow'
import { CHANGE_ROW, ICON_BUTTON } from './classes'
import { LETTER } from './constants'

/** One changed file in the Staged or Changes group: opens its diff, drags into the composer, stages or discards. */
export function ChangeRow({
  taskId,
  repoId,
  entry: e,
  staged: isStaged,
  busy,
  contextMenu,
  onContextEntry,
  onToggleStage,
  onDiscard,
}: {
  taskId: string
  repoId: string
  entry: GitStatusEntry
  staged: boolean | 'all'
  busy: boolean
  contextMenu: Pick<ReturnType<typeof useContextMenu>, 'onContextMenu' | 'onKeyDown'>
  onContextEntry: (entry: GitStatusEntry, staged: boolean | 'all') => void
  onToggleStage: () => void
  onDiscard: () => void
}) {
  const ws = useWorkspace()
  const change = isStaged === 'all' ? (e.unstaged ?? e.staged) : isStaged ? e.staged : e.unstaged
  return (
    <div
      draggable={change !== 'deleted'}
      onDragStart={(event) => {
        event.dataTransfer.setData(FILE_DRAG_TYPE, JSON.stringify({ repoId, path: e.path, kind: 'file' }))
        event.dataTransfer.effectAllowed = 'copy'
      }}
      className={`${CHANGE_ROW} ${FILE_ROW} pl-2 pr-1`}
      onContextMenu={(event) => {
        onContextEntry(e, isStaged)
        contextMenu.onContextMenu(event)
      }}
      onKeyDown={(event) => {
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
          onContextEntry(e, isStaged)
          contextMenu.onKeyDown(event)
        }
      }}
    >
      <Button
        variant="tree"
        className="change-name h-full min-h-0 py-0 items-center w-auto flex-1 min-w-0 gap-1.5 px-0 [&:hover:not(:disabled)]:bg-transparent"
        title={e.origPath ? `${e.origPath} → ${e.path}` : e.path}
        onClick={() => ws.openView(taskId, { kind: 'diff', repoId, path: e.path, staged: isStaged })}
        onDoubleClick={() =>
          ws.openView(taskId, { kind: 'diff', repoId, path: e.path, staged: isStaged, preview: false })
        }
      >
        <FileRowLabel
          gutter={false}
          path={e.path}
          name={e.path.slice(e.path.lastIndexOf('/') + 1)}
          dir={e.path.includes('/') ? e.path.slice(0, e.path.lastIndexOf('/')) : undefined}
        />
      </Button>
      <span className="change-actions hidden items-center gap-0.5 flex-none">
        {isStaged !== true && !!e.unstaged && (
          <Button
            variant="ghost"
            size="icon-xs"
            className={ICON_BUTTON}
            disabled={busy}
            aria-label={t(isStaged === 'all' ? 'Discard unstaged changes to {0}' : 'Discard changes to {0}', {
              '0': e.path,
            })}
            title={t(isStaged === 'all' ? 'Discard unstaged changes' : 'Discard changes')}
            onClick={onDiscard}
          >
            <Undo2 size={13} />
          </Button>
        )}
        {isStaged !== 'all' && (
          <Button
            variant="ghost"
            size="icon-xs"
            className={ICON_BUTTON}
            disabled={busy}
            aria-label={`${isStaged ? 'Unstage' : 'Stage'} ${e.path}`}
            title={isStaged ? 'Unstage' : 'Stage'}
            onClick={onToggleStage}
          >
            {isStaged ? <Minus size={13} /> : <Plus size={13} />}
          </Button>
        )}
      </span>
      <span
        className={`letter [&.modified]:text-warn [&.added]:text-ok [&.untracked]:text-ok [&.deleted]:text-bad [.commit-file-M_&]:text-warn [.commit-file-R_&]:text-warn tabular-nums font-mono text-caption w-3.5 text-center text-muted-foreground ${change}`}
        title={e.origPath ? t('Renamed') : undefined}
      >
        {LETTER[change ?? '']}
      </span>
    </div>
  )
}
