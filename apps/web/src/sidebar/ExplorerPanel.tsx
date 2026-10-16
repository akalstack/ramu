import { OverlayScrollArea } from '@/components/overlay-scroll-area'
import { t, useLanguage } from './../i18n'
import { useWorkspace } from '../workspace/workspace'
import { ExplorerHeader } from './explorer/ExplorerHeader'
import { RepoTree } from './explorer/RepoTree'

export function ExplorerPanel() {
  useLanguage()
  const ws = useWorkspace()
  const taskId = ws.ui.activeTaskId
  if (!taskId) return <NoTask />
  const bindings = ws.bindings[taskId] ?? []
  return (
    <div className="panel [&_>_.hint]:m-[8px_0_12px] [&_>_.hint]:p-[4px_8px] [&_>_.hint]:leading-[1.55] [&_>_.hint]:[overflow-wrap:anywhere] [&_:is(.scm-empty,_.empty-tasks)]:m-[8px_0] [&_:is(.scm-empty,_.empty-tasks)]:p-2 [&_:is(.scm-empty,_.empty-tasks)]:leading-[1.5] [&_:is(.scm-empty,_.empty-tasks)]:[overflow-wrap:anywhere] p-[2px_8px_16px] explorer-panel [&_>_.explorer-title]:flex-none [&_>_.explorer-context]:flex-none [&_.tree-root-children::before]:hidden [&_.tree-row]:h-7 [&_.tree-row]:min-h-7 [&_.tree-row]:whitespace-nowrap [&_.tree-row]:overflow-hidden [&_.tree-root]:h-7 [&_.tree-root]:min-h-7 [&_.tree-root]:sticky [&_.tree-root]:top-0 [&_.tree-root]:z-40 [&_.tree-root]:mb-0 [&_.tree-root]:whitespace-nowrap [&_.tree-root]:overflow-hidden [&_.tree-folder-sticky]:sticky [&_.tree-folder-sticky]:top-[var(--tree-sticky-top)] [&_.tree-folder-sticky]:z-[var(--tree-sticky-layer)] [&_.tree-name]:flex-initial [&_.tree-name]:min-w-0 [&_.tree-name]:overflow-hidden [&_.tree-name]:text-ellipsis [&_.tree-name]:whitespace-nowrap flex flex-col w-full h-full min-h-0 pb-0">
      <ExplorerHeader />
      <OverlayScrollArea
        className="explorer-scroll-area flex-1 min-h-0"
        viewportClassName="explorer-tree-scroll flex-1 min-h-0 overflow-auto pb-3"
        contentClassName="min-h-full flex flex-col [&>.repo-tree:last-child]:flex-1"
      >
        {bindings.map((b, index) =>
          b.setupState === 'ready' ? (
            <RepoTree key={`${ws.workspaceOf(taskId)}:${b.repoId}`} taskId={taskId} binding={b} primary={index === 0} />
          ) : (
            <div key={b.repoId} className="muted text-muted-foreground">
              {b.repoName}: worktree {b.setupState}
            </div>
          ),
        )}
      </OverlayScrollArea>
    </div>
  )
}

export function NoTask() {
  useLanguage()
  return (
    <div className="panel [&_>_.hint]:m-[8px_0_12px] [&_>_.hint]:p-[4px_8px] [&_>_.hint]:leading-[1.55] [&_>_.hint]:[overflow-wrap:anywhere] [&_:is(.scm-empty,_.empty-tasks)]:m-[8px_0] [&_:is(.scm-empty,_.empty-tasks)]:p-2 [&_:is(.scm-empty,_.empty-tasks)]:leading-[1.5] [&_:is(.scm-empty,_.empty-tasks)]:[overflow-wrap:anywhere] p-[2px_8px_16px]">
      <p className="muted text-muted-foreground hint m-[4px_0_8px] text-control leading-[1.5]">
        {t('Open a project or thread to see its files here.')}
      </p>
    </div>
  )
}
