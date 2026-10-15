import { Check, Sparkles } from 'lucide-react'
import type { GitStatusEntry } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { t } from '../../i18n'
import { useWorkspace } from '../../workspace'
import { CHANGE_ROW, SUB_TITLE } from './classes'

/** "Merge changes" group: conflicted files that open in the editor and can be marked resolved. */
export function ConflictList({
  taskId,
  repoId,
  conflicts,
  canResolveWithAi,
  busy,
  resolving,
  onResolveWithAi,
  onMarkResolved,
}: {
  taskId: string
  repoId: string
  conflicts: GitStatusEntry[]
  /** Hidden while a merge or rebase is running, where the banner offers it instead. */
  canResolveWithAi: boolean
  busy: boolean
  resolving: boolean
  onResolveWithAi: () => void
  onMarkResolved: (path: string) => void
}) {
  const ws = useWorkspace()
  return (
    <>
      <div className={`${SUB_TITLE} warn text-warn`}>
        <span>{t('Merge changes ({0})', { '0': conflicts.length })}</span>
        {canResolveWithAi && (
          <Button
            variant="ghost"
            size="sm"
            className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover small text-caption"
            disabled={busy || resolving}
            onClick={onResolveWithAi}
          >
            <Sparkles size={12} />
            {resolving ? t('Starting…') : t('Resolve with AI')}
          </Button>
        )}
      </div>
      {conflicts.map((e) => (
        <div key={e.path} className={`${CHANGE_ROW} flex items-center gap-1 rounded-(--radius-s)`}>
          <Button
            variant="secondary"
            className="bg-fill hover:bg-fill-hover change-name min-h-0 leading-4 text-control [&:hover:not(:disabled)]:bg-transparent [&:hover:not(:disabled)]:[border:none] [&:hover:not(:disabled)]:text-foreground flex-1 min-w-0 text-left bg-transparent [border:none] p-[1px_4px] gap-1.5 whitespace-nowrap overflow-hidden text-ellipsis [direction:rtl] text-soft block justify-start"
            onClick={() => ws.openView(taskId, { kind: 'file', repoId, path: e.path })}
          >
            {e.path}
          </Button>
          <Button
            variant="secondary"
            size="icon-sm"
            className="bg-fill hover:bg-fill-hover icon p-0 size-(--action-size) flex-none justify-center"
            disabled={busy}
            aria-label={t('Mark {0} resolved', { '0': e.path })}
            onClick={() => onMarkResolved(e.path)}
          >
            <Check size={13} />
          </Button>
        </div>
      ))}
    </>
  )
}
