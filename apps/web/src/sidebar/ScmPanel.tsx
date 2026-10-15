import { OverlayScrollArea } from '@/components/overlay-scroll-area'
import { useEffect, useRef, useState } from 'react'
import { usePanelRef } from 'react-resizable-panels'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { t, useLanguage } from './../i18n'
import { useLayoutEpoch, usePanelLayout } from '../workspace/panelLayout'
import { useWorkspace } from '../workspace/workspace'
import { NoTask } from './ExplorerPanel'
import { GIT_COLLAPSED_HEIGHT, SCM_MIN_HEIGHT, defaultScmLayout } from './scm/constants'
import { InitializeRepository } from './scm/InitializeRepository'
import { RepositoryControl } from './scm/RepositoryControl'

export function ScmPanel() {
  useLanguage()
  const ws = useWorkspace()
  const taskId = ws.ui.activeTaskId
  const bindings = taskId ? (ws.bindings[taskId] ?? []).filter((b) => b.setupState === 'ready' && !b.folderOnly) : []
  const plainFolders = taskId ? (ws.bindings[taskId] ?? []).filter((b) => b.setupState === 'ready' && b.notGit) : []
  // With several repositories every one is listed and can be folded; the first starts open.
  const [open, setOpen] = useState<Record<string, boolean>>({})
  // The Git section (branches, commits, stashes) exists once, pinned below the list, for the repository last opened.
  const [gitHost, setGitHost] = useState<HTMLElement | null>(null)
  const [gitRepoId, setGitRepoId] = useState<string | null>(null)
  const layoutEpoch = useLayoutEpoch()
  const layout = usePanelLayout('scm', ['repos', 'git'], defaultScmLayout)
  const gitPanel = usePanelRef()
  const [gitCollapsed, setGitCollapsed] = useState(false)
  const gitExpandedHeight = useRef(0)
  // Folding the Git heading shrinks its panel to the heading; unfolding restores the size it had.
  useEffect(() => {
    const panel = gitPanel.current
    if (!panel) return
    if (gitCollapsed) panel.resize(GIT_COLLAPSED_HEIGHT)
    else if (gitExpandedHeight.current > GIT_COLLAPSED_HEIGHT) panel.resize(gitExpandedHeight.current)
  }, [gitCollapsed, gitPanel])
  if (!taskId) return <NoTask />
  const many = bindings.length > 1
  const isOpen = (repoId: string, index: number) => open[repoId] ?? index === 0
  const gitRepo =
    bindings.find((b) => b.repoId === gitRepoId) ?? bindings.find((b, index) => isOpen(b.repoId, index)) ?? bindings[0]
  return (
    <div className="panel [&_>_.hint]:m-[8px_0_12px] [&_>_.hint]:p-[4px_8px] [&_>_.hint]:leading-[1.55] [&_>_.hint]:[overflow-wrap:anywhere] [&_:is(.scm-empty,_.empty-tasks)]:m-[8px_0] [&_:is(.scm-empty,_.empty-tasks)]:p-2 [&_:is(.scm-empty,_.empty-tasks)]:leading-[1.5] [&_:is(.scm-empty,_.empty-tasks)]:[overflow-wrap:anywhere] scm-panel flex flex-col w-full h-full min-w-0 min-h-0 overflow-hidden pt-0.5">
      {bindings.length === 0 && plainFolders.length > 0 && taskId ? (
        plainFolders.map((b) => <InitializeRepository key={b.repoId} taskId={taskId} binding={b} />)
      ) : bindings.length === 0 ? (
        <p className="muted text-muted-foreground hint m-[4px_0_8px] text-control leading-[1.5]">
          {t('No repository available.')}
        </p>
      ) : (
        <>
          <ResizablePanelGroup
            key={layoutEpoch}
            orientation="vertical"
            id="scm"
            groupRef={layout.groupRef}
            defaultLayout={layout.defaultLayout}
            onLayoutChanged={layout.onLayoutChanged}
            className="flex-1 min-h-0"
          >
            <ResizablePanel id="repos" minSize={SCM_MIN_HEIGHT}>
              <OverlayScrollArea className="scm-repos h-full min-h-0" contentClassName="px-2">
                {bindings.map((b, index) => {
                  const expanded = isOpen(b.repoId, index)
                  return (
                    <RepositoryControl
                      key={`${taskId}:${b.repoId}`}
                      taskId={taskId}
                      binding={b}
                      compact
                      collapsed={many && !expanded}
                      gitHost={gitHost}
                      showGit={gitRepo?.repoId === b.repoId}
                      gitRepos={bindings}
                      onGitRepo={setGitRepoId}
                      onGitCollapsed={setGitCollapsed}
                      onToggle={
                        many
                          ? () => {
                              setOpen((current) => ({ ...current, [b.repoId]: !expanded }))
                              if (!expanded) setGitRepoId(b.repoId)
                            }
                          : undefined
                      }
                    />
                  )
                })}
              </OverlayScrollArea>
            </ResizablePanel>
            <ResizableHandle
              disabled={gitCollapsed}
              aria-label={t('Resize Git section')}
              className="scm-git-resizer"
              onDoubleClick={() => {
                layout.groupRef.current?.setLayout(defaultScmLayout())
                layout.onLayoutChanged(defaultScmLayout(), { isUserInteraction: true })
              }}
            />
            <ResizablePanel
              id="git"
              panelRef={gitPanel}
              minSize={GIT_COLLAPSED_HEIGHT}
              maxSize="75%"
              onResize={(size) => {
                if (size.inPixels > GIT_COLLAPSED_HEIGHT + 4) gitExpandedHeight.current = size.inPixels
              }}
            >
              <div
                className="scm-git-host [&_.git-inspector]:flex-1 [&_.git-inspector]:h-auto [&_.git-inspector]:min-h-0 [&_.git-inspector]:max-h-[none] [&_.git-inspector]:[border-top:0] [&_.git-inspector:not(.collapsed)]:flex-1 [&_.git-inspector:not(.collapsed)]:h-auto [&_.git-inspector:not(.collapsed)]:min-h-0 [&_.git-inspector:not(.collapsed)]:max-h-[none] [&_.git-inspector:not(.collapsed)]:[border-top:0] flex flex-col h-full min-w-0 min-h-0 px-2"
                ref={setGitHost}
              />
            </ResizablePanel>
          </ResizablePanelGroup>
        </>
      )}
    </div>
  )
}
