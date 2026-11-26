import type { Ref } from 'react'
import { ChevronDown } from 'lucide-react'
import type { Task } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { t, useLanguage } from '../../i18n'
import { TaskRow } from './TaskRow'
import { projectThreadPreview } from './threadLists'
import { useWorkspaceOf } from '../../workspace/workspace'
import { useSidebarExpansion } from './sidebarExpansion'
import { useAppSettings } from '../../settings/AppSettings'

/** How many threads each group previews when every host shares the sidebar. */
export const EMBEDDED_THREAD_LIMIT = 5

/** A bounded thread list whose Show more survives the sidebar remounting when another host comes on screen. */
export function useThreadPreview(
  host: string,
  tasks: Task[],
  projectId: string,
  limit: number,
  activeId?: string | null,
) {
  const tree = useSidebarExpansion(host)
  const key = `preview:${projectId}`
  const showAll = !tree.isExpanded(key)
  const unread = useWorkspaceOf(host)?.unread
  return {
    ...projectThreadPreview(tasks, projectId, limit, showAll, activeId, unread),
    showAll,
    toggle: () => tree.setExpanded(key, showAll),
  }
}

/** The threads under a project or a host's projectless group, the same on the host on screen and on every other. */
export function ThreadPreviewList({
  preview,
  ref,
}: {
  preview: ReturnType<typeof useThreadPreview>
  ref?: Ref<HTMLDivElement>
}) {
  useLanguage()
  const { preferences } = useAppSettings()
  return (
    <div ref={ref} className="task-list relative flex flex-col gap-0.5 pt-0.5">
      {preview.tasks.length === 0 && (
        <div className="muted text-muted-foreground small text-caption empty-tasks p-[4px_10px_4px_31px]">
          {t('No threads yet')}
        </div>
      )}
      {preview.tasks.map((task) => (
        <TaskRow
          key={task.id}
          task={task}
          nested
          hideBranch={!preferences.threadRowBranches}
          earlierRuns={preview.earlierRuns[task.id]}
        />
      ))}
      {preview.hasMore && (
        <Button
          variant="tree"
          aria-expanded={preview.showAll}
          onClick={preview.toggle}
          className="h-[30px] min-h-[30px] gap-2 pl-[31px] pr-2 text-body leading-5 hover:bg-accent"
        >
          {preview.showAll ? t('Show less') : t('Show more')}
          <ChevronDown className={`size-3.5 flex-none transition-transform${preview.showAll ? ' rotate-180' : ''}`} />
        </Button>
      )}
    </div>
  )
}
