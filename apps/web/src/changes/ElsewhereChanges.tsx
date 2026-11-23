import { ChevronRight } from 'lucide-react'
import type { ChangeElsewhere } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { LineStats } from '../git/LineStats'
import { t, useLanguage } from '../i18n'
import { useWorkspace } from '../workspace/workspace'
import { FilePath } from './FilePath'

const groupKey = (group: ChangeElsewhere) => (group.byYou ? 'you' : (group.taskId ?? 'unknown'))

/**
 * What else changed in the checkout during this turn, set apart by who wrote it. It is not part of this thread's
 * changes, so it is never undone or committed with them; each group opens the thread that wrote it, and a group the
 * person knows is this thread's work joins its changes with one click.
 */
export function ElsewhereChanges({
  groups,
  busy,
  onClaim,
}: {
  groups: ChangeElsewhere[]
  busy: boolean
  /** Moves these files into this turn's own changes; absent where the person may not change the review. */
  onClaim?: (fileIds: string[]) => void
}) {
  useLanguage()
  const ws = useWorkspace()
  const label = (group: ChangeElsewhere) =>
    group.byYou
      ? t('Changed by you · {0} files', { 0: group.files.length })
      : group.taskId
        ? t('Changed by “{0}” · {1} files', {
            0: ws.task(group.taskId)?.title ?? t('Another thread'),
            1: group.files.length,
          })
        : t('Changed outside this thread · {0} files', { 0: group.files.length })
  return (
    <div className="flex flex-col gap-1">
      {groups.map((group) => (
        <Collapsible key={groupKey(group)} className="rounded-(--radius-s) bg-card">
          <div className="flex items-center gap-1 p-[2px_4px]">
            <CollapsibleTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  className="group min-w-0 flex-1 justify-start text-caption text-muted-foreground"
                />
              }
            >
              <ChevronRight size={14} className="flex-none transition-transform group-data-[panel-open]:rotate-90" />
              <span className="truncate">{label(group)}</span>
            </CollapsibleTrigger>
            {group.taskId && (
              <Button variant="ghost" size="xs" onClick={() => ws.openTask(group.taskId!)}>
                {t('Open thread')}
              </Button>
            )}
            {onClaim && !group.taskId && (
              <Button
                variant="ghost"
                size="xs"
                disabled={busy}
                title={t('Undo and commit these files with this thread’s changes.')}
                onClick={() => onClaim(group.files.map((file) => file.id))}
              >
                {t('Add to this thread’s changes')}
              </Button>
            )}
          </div>
          <CollapsibleContent>
            <ul className="flex flex-col gap-0.5 p-[0_8px_6px_28px]">
              {group.files.map((file) => (
                <li
                  key={file.id}
                  className="flex items-center gap-2 text-caption"
                  title={`${file.repoName} · ${file.path}`}
                >
                  <FilePath className="min-w-0 flex-1 truncate" path={file.path} />
                  <LineStats files={[file]} />
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      ))}
    </div>
  )
}
