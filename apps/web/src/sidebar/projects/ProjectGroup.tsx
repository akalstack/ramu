import { usePageIndex } from '../../pages/pageIndex'
import { openPage } from '../../pages/openPage'
import { useHostWriteAccess } from '../../composer/useHostWriteAccess'
import { VIEW_ONLY_WRITE_NOTICE } from '../../composer/viewerAccess'
import { animateThreadListChange } from '../../workspace/threadListMotion'
import { offerThreadUndo } from './threadUndo'
import { Button } from '@/components/desktop-button'
import {
  AppWindow,
  Archive,
  ChevronRight,
  CircleCheck,
  FolderClosed,
  FolderOpen,
  FolderSearch,
  GitBranch,
  Link2,
  Megaphone,
  Pencil,
  Rocket,
  Route,
  Plus,
  SquarePen,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { HoverCard, HoverCardTrigger } from '@/components/ui/hover-card'
import type { Project } from '@ramu/shared/types'
import { t, useLanguage } from '../../i18n'
import { invoke } from '../../ipc'
import { pickHostFolder } from '../../workspace/addProject'
import { useContextMenu, type MenuEntry } from '../../Menu'
import { errorText } from '../../workspace/TaskPane'
import { projectCtx, useWorkspace } from '../../workspace/workspace'
import { useAppSettings } from '../../settings/AppSettings'
import { FadeText } from '../../FadeText'
import { ICON_BUTTON_CLASS, ROW_ACTIONS_CLASS, ROW_ERROR_CLASS, STICKY_PROJECT_CLASS } from './constants'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { InlineEdit } from './InlineEdit'
import { ProjectHoverCard } from './ProjectHoverCard'
import { ProjectRoutingDialog } from './ProjectRoutingDialog'
import { DeployDialog } from './DeployDialog'
import { CiSetupDialog } from './CiSetup'
import { useSidebarExpansion } from './sidebarExpansion'
import { ThreadPreviewList, useThreadPreview } from './ThreadPreviewList'
import { useSlideMount } from './useSlideMount'
import { useHost } from '../../workspace/HostProvider'
import { draftKey, draftStore, saveDraft } from '../../composer/drafts'

export function ProjectGroup({ project, previewLimit }: { project: Project; previewLimit?: number }) {
  useLanguage()
  const ws = useWorkspace()
  const host = useHost()
  const { viewOnly, canWrite } = useHostWriteAccess()
  // Artifacts made for this project, found from its menu as well as from Artifacts.
  const projectPages = [...usePageIndex().pages.values()].filter((page) => page.projectId === project.id)
  const repos = ws.repos[project.id] ?? []
  const { preferences } = useAppSettings()
  const recent = Math.min(preferences.recentChats, previewLimit ?? Infinity)
  const all = ws.tasks.filter((t) => t.projectId === project.id)
  const preview = useThreadPreview(host.id, ws.tasks, project.id, recent, ws.ui.activeTaskId)
  const { tasks } = preview
  const tree = useSidebarExpansion(host.id)
  const open = tree.isExpanded(`project:${project.id}`)
  const setOpen = (next: boolean | ((current: boolean) => boolean)) =>
    tree.setExpanded(`project:${project.id}`, typeof next === 'function' ? next(open) : next)
  // The chat list stays mounted while it slides closed, and slides open once it is mounted.
  const { ref: list, visible } = useSlideMount(open)
  const [renaming, setRenaming] = useState(false)
  const [routing, setRouting] = useState(false)
  const [deploying, setDeploying] = useState(false)
  const [settingUpCi, setSettingUpCi] = useState(false)
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: project.id,
    disabled: renaming,
  })
  const [error, setError] = useState<string | null>(null)
  const [hover, setHover] = useState(false)
  const active = ws.ui.activeTaskId === projectCtx(project.id) && !ws.composing
  const connect = async () => {
    if (!canWrite()) return
    setError(null)
    try {
      // The native folder picker runs on this machine (see the plan ledger for other hosts).
      const dir = host.isLocal ? await invoke('repos.pick', 'repository') : await pickHostFolder(host.id)
      if (!dir || !canWrite()) return
      await host.invoke('repos.add', project.id, dir)
      await ws.refresh()
    } catch (e) {
      setError(errorText(e))
    }
  }

  // A launch write-up starts as a request already in New chat's box, so the person can adjust it before it goes.
  const writeUp = (request: string) => {
    saveDraft(draftKey.newChat(project.id), request, draftStore(host.id))
    ws.newTask(project.id)
  }

  const act = async (fn: () => Promise<unknown>): Promise<boolean> => {
    if (!canWrite()) return false
    setError(null)
    try {
      await animateThreadListChange(async () => {
        if (!canWrite()) return
        await fn()
        await ws.refresh()
      })
      return true
    } catch (e) {
      setError(errorText(e))
      return false
    }
  }

  const items: MenuEntry[] = [
    {
      key: 'new',
      label: (
        <>
          <SquarePen size={14} /> {t(' New thread')}
        </>
      ),
      onSelect: () => ws.newTask(project.id),
    },
    {
      key: 'rename',
      label: (
        <>
          <Pencil size={14} /> {t(' Rename')}
        </>
      ),
      onSelect: () => {
        if (canWrite()) setRenaming(true)
      },
    },
    {
      key: 'routing',
      label: (
        <>
          <Route size={14} /> {t(' Names for Auto…')}
        </>
      ),
      onSelect: () => {
        if (canWrite()) setRouting(true)
      },
    },
    ...(projectPages.length
      ? [
          {
            key: 'artifacts',
            label: (
              <>
                <AppWindow size={14} /> {t(' Artifacts')}
              </>
            ),
            submenu: projectPages.map((page) => ({
              key: page.id,
              label: `${page.icon} ${page.title}`,
              onSelect: () => openPage(page.id),
            })),
          } as MenuEntry,
        ]
      : []),
    {
      key: 'deploy',
      label: (
        <>
          <Rocket size={14} /> {t(' Deploy…')}
        </>
      ),
      onSelect: () => {
        if (canWrite()) setDeploying(true)
      },
    },
    ...(repos.length
      ? [
          {
            key: 'launch',
            label: (
              <>
                <Megaphone size={14} /> {t(' Tell people what shipped')}
              </>
            ),
            submenu: [
              {
                key: 'release-note',
                label: t('Make a release note'),
                onSelect: () =>
                  writeUp(
                    t(
                      'Make a release note as a Doc artifact from the pull requests merged since the last release: what changed for the people who use it, grouped by what they would notice, with each pull request linked.',
                    ),
                  ),
              },
              {
                key: 'launch-deck',
                label: t('Make a launch deck'),
                onSelect: () =>
                  writeUp(
                    t(
                      'Make a short launch deck as a Slides artifact from the pull requests merged since the last release: the problem, what is new, how it looks, and what comes next, with speaker notes.',
                    ),
                  ),
              },
            ],
          } as MenuEntry,
        ]
      : []),
    {
      key: 'ci',
      label: (
        <>
          <CircleCheck size={14} /> {t(' Set up CI…')}
        </>
      ),
      onSelect: () => {
        if (canWrite()) setSettingUpCi(true)
      },
    },
    { key: 'sep1', separator: true },
    {
      key: 'connect',
      label: (
        <>
          <Link2 size={14} /> {t(' Connect a repository…')}
        </>
      ),
      onSelect: () => void connect(),
    },
    {
      key: 'reveal',
      disabled: !host.isLocal,
      label: (
        <>
          <FolderSearch size={14} /> {t(' Reveal in Finder')}
        </>
      ),
      onSelect: () => void act(() => host.invoke('projects.reveal', project.id)),
    },
    ...(repos.length > 1
      ? [
          {
            key: 'repos',
            label: (
              <>
                <GitBranch size={14} /> {t(' Repositories')}
              </>
            ),
            submenu: repos.map((r) => ({
              key: r.id,
              label: (
                <>
                  <span className="menu-label [.chat-switch-menu_&]:flex-1 [.chat-switch-menu_&]:max-w-[none] [.chat-switch-menu_&]:leading-[18px] [.chat-switch-menu_&]:font-medium [.chat-switch-menu_&]:min-w-0 [.dropdown-menu_&]:min-w-0 [.dropdown-menu_&]:max-w-[none] [.dropdown-menu_&]:whitespace-nowrap [.project-switch-menu_&]:max-w-[none] [.project-switch-menu_&]:leading-[18px] [.project-switch-menu_&]:font-medium [.project-switch-menu_&]:min-w-0 [.project-switch-menu_&_.block]:max-w-[none] [.project-switch-menu_&_.block]:overflow-hidden [.project-switch-menu_&_.block]:text-ellipsis [.project-switch-menu_&_.block]:whitespace-nowrap [.project-switch-menu_&_.block]:m-[2px_0_0] [.project-switch-menu_&_.block]:text-caption [.project-switch-menu_&_.block]:leading-[16px] [.project-switch-menu_&_.block]:font-normal [.project-switch-menu_&_.block]:text-muted-foreground [.chat-switch-menu_&_.block]:overflow-hidden [.chat-switch-menu_&_.block]:text-ellipsis [.chat-switch-menu_&_.block]:whitespace-nowrap [.chat-switch-menu_&_.block]:m-[2px_0_0] [.chat-switch-menu_&_.block]:text-caption [.chat-switch-menu_&_.block]:leading-[16px] [.chat-switch-menu_&_.block]:font-normal [.chat-switch-menu_&_.block]:text-muted-foreground max-w-[220px] overflow-hidden text-ellipsis">
                    {r.name}
                  </span>
                  <span className="muted ml-auto shrink-0 text-muted-foreground">{t('Disconnect')}</span>
                </>
              ),
              onSelect: () => void act(() => host.invoke('repos.remove', r.id)),
            })),
          } as MenuEntry,
        ]
      : []),
    { key: 'sep2', separator: true },
    {
      key: 'archive',
      label: (
        <>
          <Archive size={14} /> {t(' Archive threads')}
        </>
      ),
      disabled: tasks.length === 0,
      onSelect: () =>
        void (async () => {
          const archived: string[] = []
          const finished = await act(async () => {
            for (const t of tasks) {
              if (!canWrite()) return
              await host.invoke('tasks.archive', t.id, true)
              archived.push(t.id)
              ws.forgetTask(t.id)
            }
          })
          if (finished && archived.length)
            offerThreadUndo('archived', archived.length, () =>
              act(async () => {
                for (const id of archived) await host.invoke('tasks.archive', id, false)
              }),
            )
        })(),
    },
    { key: 'sep3', separator: true },
    {
      key: 'remove',
      label: (
        <>
          <X size={14} /> {t(' Remove project')}
        </>
      ),
      onSelect: () => void act(() => host.invoke('projects.remove', project.id)),
    },
  ]

  const contextMenu = useContextMenu(
    `${project.name} actions`,
    viewOnly ? items.filter((entry) => entry.key === 'new') : items,
  )

  return (
    <section
      ref={setNodeRef}
      className="project-group mb-0 [&:has(.task-list)]:mb-2.5 relative"
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : undefined,
        zIndex: isDragging ? 3 : undefined,
      }}
    >
      {contextMenu.menu}
      <div className={STICKY_PROJECT_CLASS}>
        <HoverCard open={hover && !renaming && !isDragging} onOpenChange={setHover}>
          <HoverCardTrigger
            delay={150}
            closeDelay={120}
            render={<div />}
            {...listeners}
            className={
              active
                ? 'project-row [&:hover]:bg-accent [&:hover]:text-foreground [&:hover_.row-actions]:opacity-100 [&.active]:bg-accent [&.active]:text-foreground [&_.row-actions]:gap-0.5 [&_.row-actions]:mr-0 [&_.caret]:[transition:transform_0.15s_var(--ease)] [transition:background-color_140ms_ease,_color_140ms_ease] flex items-center gap-2 rounded-(--radius-s) cursor-default text-soft text-body leading-5 min-h-[30px] p-[0_8px] active'
                : 'project-row [&:hover]:bg-accent [&:hover]:text-foreground [&:hover_.row-actions]:opacity-100 [&.active]:bg-accent [&.active]:text-foreground [&_.row-actions]:gap-0.5 [&_.row-actions]:mr-0 [&_.caret]:[transition:transform_0.15s_var(--ease)] [transition:background-color_140ms_ease,_color_140ms_ease] flex items-center gap-2 rounded-(--radius-s) cursor-default text-soft text-body leading-5 min-h-[30px] p-[0_8px]'
            }
            role="button"
            tabIndex={0}
            aria-label={t('Open {0}', { '0': project.name })}
            onContextMenu={contextMenu.onContextMenu}
            onClick={() => {
              setOpen(true)
              ws.openProject(project.id)
            }}
            onKeyDown={(e) => {
              contextMenu.onKeyDown(e)
              if (e.key === 'Enter') ws.openProject(project.id)
            }}
            onMouseDown={() => setHover(false)}
          >
            {open ? (
              <FolderOpen size={15} className="muted text-muted-foreground" />
            ) : (
              <FolderClosed size={15} className="muted text-muted-foreground" />
            )}
            {renaming ? (
              <InlineEdit
                readOnly={viewOnly}
                value={project.name}
                onDone={(v) => {
                  if (v !== null && !canWrite()) return
                  setRenaming(false)
                  if (v && v !== project.name) void act(() => host.invoke('projects.rename', project.id, v))
                }}
              />
            ) : (
              <FadeText
                className="project-name font-medium overflow-hidden whitespace-nowrap flex-1 min-w-0"
                text={project.name}
              />
            )}
            <span className={ROW_ACTIONS_CLASS}>
              <Button
                variant="ghost"
                size="icon-xs"
                className={ICON_BUTTON_CLASS}
                aria-label={t('Toggle {0}', { '0': project.name })}
                title={open ? t('Collapse') : t('Expand')}
                onClick={(e) => {
                  e.stopPropagation()
                  setOpen((o) => !o)
                }}
              >
                <ChevronRight
                  size={14}
                  className={
                    open
                      ? 'caret [&.open]:[transform:rotate(90deg)] text-muted-foreground flex-none [transition:transform_0.15s_var(--ease)] open'
                      : 'caret [&.open]:[transform:rotate(90deg)] text-muted-foreground flex-none [transition:transform_0.15s_var(--ease)]'
                  }
                />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                className={ICON_BUTTON_CLASS}
                aria-label={t('New thread in {0}', { '0': project.name })}
                title={t('New thread')}
                onClick={(e) => {
                  e.stopPropagation()
                  ws.newTask(project.id)
                }}
              >
                <Plus size={14} />
              </Button>
            </span>
          </HoverCardTrigger>
          <ProjectHoverCard
            project={project}
            folders={repos.map((r) => ({ id: r.id, name: r.name, root: r.root }))}
            chats={all.filter((t) => t.status !== 'archived').length}
          />
        </HoverCard>
      </div>
      {routing && (
        <ProjectRoutingDialog
          project={project}
          readOnly={viewOnly}
          onSave={async (aliases, description) => {
            if (!canWrite()) throw new Error(t(VIEW_ONLY_WRITE_NOTICE))
            await host.invoke('projects.setRouting', project.id, aliases, description)
            await ws.refresh()
          }}
          onClose={() => setRouting(false)}
        />
      )}
      {deploying && <DeployDialog project={project} repos={repos} onClose={() => setDeploying(false)} />}
      {settingUpCi && <CiSetupDialog project={project} repos={repos} onClose={() => setSettingUpCi(false)} />}
      {error && <div className={ROW_ERROR_CLASS}>{error}</div>}
      {visible && <ThreadPreviewList ref={list} preview={preview} />}
    </section>
  )
}
