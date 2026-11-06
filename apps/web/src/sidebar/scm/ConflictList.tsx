import { Check, CheckCheck, MoreHorizontal, Sparkles } from 'lucide-react'
import type { ConflictChoice } from '@ramu/shared/conflicts'
import type { GitStatusEntry } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { Menu } from '../../Menu'
import { t } from '../../i18n'
import { useWorkspace } from '../../workspace/workspace'
import { CHANGE_ROW, SUB_TITLE } from './classes'

const GHOST =
  'ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover small text-caption'

/** The three sides, in the words editors use, for a file or for every conflicted file. */
export const CHOICE_LABEL: Record<ConflictChoice, string> = {
  current: 'Accept current',
  incoming: 'Accept incoming',
  both: 'Accept both',
}

const ALL_LABEL: Record<ConflictChoice, string> = {
  current: 'Accept current in all files',
  incoming: 'Accept incoming in all files',
  both: 'Accept both in all files',
}

/**
 * "Merge changes" group: conflicted files open in the conflict view, where each conflict gets a side. A file or every
 * file can take one side at once, go to an agent, or be marked resolved after editing it by hand.
 */
export function ConflictList({
  taskId,
  repoId,
  conflicts,
  canResolveWithAi,
  busy,
  resolving,
  onResolveWithAi,
  onChoose,
  onMarkResolved,
}: {
  taskId: string
  repoId: string
  conflicts: GitStatusEntry[]
  /** Hidden while a merge or rebase is running, where the banner offers it instead. */
  canResolveWithAi: boolean
  busy: boolean
  resolving: boolean
  /** All files, or only the given ones. */
  onResolveWithAi: (paths?: string[]) => void
  /** One side for one file, or for every conflicted file when `path` is null. */
  onChoose: (path: string | null, choice: ConflictChoice) => void
  onMarkResolved: (path: string) => void
}) {
  const ws = useWorkspace()
  const choices = (path: string | null) =>
    (['current', 'incoming', 'both'] as const).map((choice) => ({
      key: choice,
      label: t((path ? CHOICE_LABEL : ALL_LABEL)[choice]),
      disabled: busy,
      onSelect: () => onChoose(path, choice),
    }))
  return (
    <>
      <div className={`${SUB_TITLE} warn text-warn`}>
        <span>{t('Merge changes ({0})', { '0': conflicts.length })}</span>
        <span className="flex items-center gap-0.5">
          {canResolveWithAi && (
            <Button
              variant="ghost"
              size="sm"
              className={GHOST}
              disabled={busy || resolving}
              onClick={() => onResolveWithAi()}
            >
              <Sparkles size={12} />
              {resolving ? t('Starting…') : t('Resolve with AI')}
            </Button>
          )}
          <Menu
            label={t('Accept a side in every conflicted file')}
            icon={<CheckCheck size={13} />}
            align="end"
            disabled={busy}
            items={choices(null)}
          />
        </span>
      </div>
      {conflicts.map((e) => (
        <div key={e.path} className={`${CHANGE_ROW} flex items-center gap-1 rounded-(--radius-s)`}>
          <Button
            variant="secondary"
            className="bg-fill hover:bg-fill-hover change-name min-h-0 leading-4 text-control [&:hover:not(:disabled)]:bg-transparent [&:hover:not(:disabled)]:[border:none] [&:hover:not(:disabled)]:text-foreground flex-1 min-w-0 text-left bg-transparent [border:none] p-[1px_4px] gap-1.5 whitespace-nowrap overflow-hidden text-ellipsis [direction:rtl] text-soft block justify-start"
            title={t('Choose a side for each conflict in {0}', { '0': e.path })}
            onClick={() => ws.openView(taskId, { kind: 'conflict', repoId, path: e.path })}
          >
            {e.path}
          </Button>
          <Menu
            label={t('Resolve {0}', { '0': e.path })}
            icon={<MoreHorizontal size={13} />}
            align="end"
            disabled={busy}
            items={[
              ...choices(e.path),
              { key: 'sep', separator: true },
              {
                key: 'ai',
                label: t('Resolve this file with AI'),
                disabled: busy || resolving,
                onSelect: () => onResolveWithAi([e.path]),
              },
              {
                key: 'edit',
                label: t('Edit in the editor'),
                onSelect: () => ws.openView(taskId, { kind: 'file', repoId, path: e.path }),
              },
            ]}
          />
          <Button
            variant="secondary"
            size="icon-sm"
            className="bg-fill hover:bg-fill-hover icon p-0 size-(--action-size) flex-none justify-center"
            disabled={busy}
            aria-label={t('Mark {0} resolved', { '0': e.path })}
            title={t('Mark resolved after editing it yourself')}
            onClick={() => onMarkResolved(e.path)}
          >
            <Check size={13} />
          </Button>
        </div>
      ))}
    </>
  )
}
