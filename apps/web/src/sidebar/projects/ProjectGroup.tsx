import { ExpandRow } from '@/components/expand-row'
import { Button } from '@/components/desktop-button'
import {
  Archive,
  ChevronRight,
  FolderClosed,
  FolderOpen,
  FolderSearch,
  GitBranch,
  Link2,
  Pencil,
  Plus,
  SquarePen,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { HoverCard, HoverCardTrigger } from '@/components/ui/hover-card'
import type { Project } from '@ramu/shared/types'
import { t, useLanguage } from '../../i18n'
import { invoke } from '../../ipc'
import { useContextMenu, type MenuEntry } from '../../Menu'
import { errorText } from '../../workspace/TaskPane'
import { projectCtx, useWorkspace } from '../../workspace/workspace'
import { useAppSettings } from '../../settings/AppSettings'
import { FadeText } from '../../FadeText'
import { ICON_BUTTON_CLASS, ROW_ACTIONS_CLASS, ROW_ERROR_CLASS, pinnedFirst } from './constants'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { InlineEdit } from './InlineEdit'
import { ProjectHoverCard } from './ProjectHoverCard'
import { TaskRow } from './TaskRow'
import { useSlideMount } from './useSlideMount'

export function ProjectGroup({ project }: { project: Project }) {
  useLanguage()
  const ws = useWorkspace()
  const repos = ws.repos[project.id] ?? []
  const { preferences } = useAppSettings()
  const recent = preferences.recentChats
  const all = ws.tasks.filter((t) => t.projectId === project.id)
  const sorted = all.filter((t) => t.status !== 'archived' && !t.pinnedAt).sort(pinnedFirst)
  const others = sorted.filter((t) => !t.pinnedAt)
  const [showAll, setShowAll] = useState(false)
  // Like Codex: the latest few chats, with the rest behind "Show more"; the open chat always shows.
  const tasks = showAll
    ? sorted
    : sorted.filter((t) => t.pinnedAt || others.indexOf(t) < recent || t.id === ws.ui.activeTaskId)
  const open = ws.isExpanded(`project:${project.id}`)
  const setOpen = (next: boolean | ((current: boolean) => boolean)) =>
    ws.setExpanded(`project:${project.id}`, typeof next === 'function' ? next(open) : next)
  // The chat list stays mounted while it slides closed, and slides open once it is mounted.
  const { ref: list, visible } = useSlideMount(open)
  const [renaming, setRenaming] = useState(false)
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: project.id,
    disabled: renaming,
  })
  const [error, setError] = useState<string | null>(null)
  const [hover, setHover] = useState(false)
  const active = ws.ui.activeTaskId === projectCtx(project.id) && !ws.composing
  const connect = async () => {
    setError(null)
    try {
      const dir = await invoke('repos.pick', 'repository')
      if (!dir) return
      await invoke('repos.add', project.id, dir)
      await ws.refresh()
    } catch (e) {
      setError(errorText(e))
    }
  }

  const act = async (fn: () => Promise<unknown>) => {
    setError(null)
    try {
      await fn()
      await ws.refresh()
    } catch (e) {
      setError(errorText(e))
    }
  }

  const items: MenuEntry[] = [
    {
      key: 'new',
      label: (
        <>
          <SquarePen size={14} /> {t(' New chat')}
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
      onSelect: () => setRenaming(true),
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
      label: (
        <>
          <FolderSearch size={14} /> {t(' Reveal in Finder')}
        </>
      ),
      onSelect: () => void act(() => invoke('projects.reveal', project.id)),
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
                  <span className="muted text-muted-foreground">{t('Disconnect')}</span>
                </>
              ),
              onSelect: () => void act(() => invoke('repos.remove', r.id)),
            })),
          } as MenuEntry,
        ]
      : []),
    { key: 'sep2', separator: true },
    {
      key: 'archive',
      label: (
        <>
          <Archive size={14} /> {t(' Archive chats')}
        </>
      ),
      disabled: tasks.length === 0,
      onSelect: () =>
        void act(async () => {
          for (const t of tasks) {
            await invoke('tasks.archive', t.id, true)
            ws.forgetTask(t.id)
          }
        }),
    },
    { key: 'sep3', separator: true },
    {
      key: 'remove',
      label: (
        <>
          <X size={14} /> {t(' Remove project')}
        </>
      ),
      onSelect: () => void act(() => invoke('projects.remove', project.id)),
    },
  ]

  const contextMenu = useContextMenu(`${project.name} actions`, items)

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
              value={project.name}
              onDone={(v) => {
                setRenaming(false)
                if (v && v !== project.name) void act(() => invoke('projects.rename', project.id, v))
              }}
            />
          ) : (
            <FadeText
              className="project-name font-normal overflow-hidden whitespace-nowrap flex-1 min-w-0"
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
              aria-label={t('New chat in {0}', { '0': project.name })}
              title={t('New chat')}
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
      {error && <div className={ROW_ERROR_CLASS}>{error}</div>}
      {visible && (
        <div ref={list} className="task-list flex flex-col gap-0.5 pt-0.5">
          {tasks.length === 0 && (
            <div className="muted text-muted-foreground small text-caption empty-tasks p-[2px_10px]">
              {t('No chats yet')}
            </div>
          )}
          {tasks.map((t) => (
            <TaskRow key={t.id} task={t} nested />
          ))}
          {others.length > recent && (
            <ExpandRow
              expanded={showAll}
              onToggle={() => setShowAll((s) => !s)}
              className="h-[30px] min-h-[30px] px-2 text-body leading-5"
            >
              {showAll ? t('Show less') : t('Show more')}
            </ExpandRow>
          )}
        </div>
      )}
    </section>
  )
}
