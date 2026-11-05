import { threadOriginLabel } from '@ramu/shared/workspace/threadOrigin'
import { animateThreadListChange } from '../../workspace/threadListMotion'
import { useComputers } from '../../workspace/computers'
import { useHost } from '../../workspace/HostProvider'
import { useHostSelection } from '../../workspace/HostSelection'
import { Button } from '@/components/desktop-button'
import {
  Archive,
  ArchiveRestore,
  Check,
  GitBranch,
  GitFork,
  Pencil,
  Pin,
  PinOff,
  RotateCcw,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Task } from '@ramu/shared/types'
import { t, useLanguage } from '../../i18n'
import { copyText } from '../../ipc'
import { useContextMenu, type MenuEntry } from '../../Menu'
import { VIEW_ONLY_WRITE_NOTICE } from '../../composer/viewerAccess'
import { useHostWriteAccess } from '../../composer/useHostWriteAccess'
import { DeleteThreadDialog } from '../../chat/DeleteThreadDialog'
import { errorText } from '../../workspace/TaskPane'
import { notifyError } from '../../chat/Notifications'
import { useRowStore } from '../../workspace/workspace'
import { FadeText } from '../../FadeText'
import { useModelSets } from '../../models/ModelSets'
import { WorkspaceNameDialog } from '../../workspace/WorkspaceNameDialog'
import { ICON_BUTTON_CLASS, ROW_ACTIONS_CLASS, ROW_ERROR_CLASS } from './constants'
import { InlineEdit } from './InlineEdit'
import { TaskStateIcon } from './TaskStateIcon'
import { AgentStack } from './AgentStack'
import { offerThreadUndo } from './threadUndo'
import { ThreadHoverCard } from './ThreadHoverCard'
import { HoverCard, HoverCardTrigger } from '@/components/ui/hover-card'
import { threadStatus } from '@ramu/shared/chat/threadStatus'
import { threadSelection, useThreadSelection } from './threadSelection'
import { useBulkActionsContext } from './ThreadSelectionBar'

/**
 * One thread in the sidebar, on whichever host it lives: the host comes from the nearest `HostScope` (or the store on
 * screen), and every action goes through that host's own `invoke` and store.
 */
export function TaskRow({
  task,
  projectName,
  hidePin,
  nested,
  merged,
  earlierRuns,
}: {
  task: Task
  projectName?: string
  hidePin?: boolean
  nested?: boolean
  /** Rows from several hosts share one list, so each says where it lives. */
  merged?: boolean
  /** Older quiet runs of the same schedule folded into this row. */
  earlierRuns?: number
}) {
  useLanguage()
  const ws = useRowStore()
  const host = useHost()
  const { activeHost, select } = useHostSelection()
  // The host on screen: its store opens the thread directly. Another host's opens through the selection.
  const onScreen = host.id === activeHost
  // Another host's rows act once its store has loaded and while it is connected; until then they show what is known.
  const unavailable = !ws || (!onScreen && host.status !== 'connected')
  const computers = useComputers()
  const hostName =
    (projectName || merged) && computers && computers.computers.length > 1
      ? computers.computers.find((c) => c.id === host.id)?.name
      : undefined
  // Threads of the host on screen can be picked together for a bulk action, where the list offers one.
  const bulk = useBulkActionsContext()
  const picked = useThreadSelection()
  const selectable = !!bulk && onScreen && !unavailable
  const selected = selectable && picked.has(task.id)
  const refresh = () => ws?.refresh() ?? Promise.resolve()
  const forget = () => ws?.forgetTask(task.id)
  const open = () => {
    if (onScreen) ws?.openTask(task.id)
    else if (!unavailable) select(host.id, { kind: 'task', taskId: task.id })
  }
  const [renaming, setRenaming] = useState(false)
  const [hover, setHover] = useState(false)
  const [renamingWorkspace, setRenamingWorkspace] = useState<{
    host: string
    openedOn: string
    workspace: { id: string; name: string }
  } | null>(null)
  useEffect(() => {
    setRenamingWorkspace((current) =>
      current && (current.host !== host.id || current.openedOn !== activeHost) ? null : current,
    )
  }, [host.id, activeHost])
  const workspace = task.workspaceId ? ws?.workspaces?.find((entry) => entry.id === task.workspaceId) : undefined
  const [deleting, setDeleting] = useState(false)
  const sharedWorktree =
    !!task.workspaceId && (ws?.tasks ?? []).some((t) => t.id !== task.id && t.workspaceId === task.workspaceId)
  const [error, setError] = useState<string | null>(null)
  const active = onScreen && ws?.ui.activeTaskId === task.id && !ws.composing
  const archived = task.status === 'archived'
  const done = !!task.doneAt
  const { initialSettings } = useModelSets()
  const [naming, setNaming] = useState(false)
  const { viewOnly, canWrite } = useHostWriteAccess()
  const titleRequest = useRef(false)

  const run = async (fn: () => Promise<unknown>): Promise<boolean> => {
    if (!canWrite()) return false
    setError(null)
    try {
      await animateThreadListChange(async () => {
        if (!canWrite()) return
        await fn()
        await refresh()
      })
      return true
    } catch (e) {
      setError(errorText(e))
      return false
    }
  }
  const markDone = async () => {
    const changed = await run(() => host.invoke('tasks.done', task.id, true))
    if (changed) offerThreadUndo('done', 1, () => run(() => host.invoke('tasks.done', task.id, false)))
  }
  const archive = async () => {
    const changed = await run(async () => {
      await host.invoke('tasks.archive', task.id, true)
      forget()
    })
    if (changed) offerThreadUndo('archived', 1, () => run(() => host.invoke('tasks.archive', task.id, false)))
  }

  const group = selected && picked.size > 1 && bulk ? bulk.pick(picked) : null
  const groupItems: MenuEntry[] = group
    ? [
        { key: 'count', heading: t('{0} selected', { 0: group.length }) },
        {
          key: 'g-pin',
          label: (
            <>
              {group.every((entry) => entry.pinnedAt) ? <PinOff size={14} /> : <Pin size={14} />}{' '}
              {group.every((entry) => entry.pinnedAt) ? t('Unpin selected') : t('Pin selected')}
            </>
          ),
          onSelect: () => bulk!.pin(group),
        },
        {
          key: 'g-done',
          label: (
            <>
              <Check size={14} />{' '}
              {group.every((entry) => entry.doneAt) ? t('Reopen selected') : t('Mark selected done')}
            </>
          ),
          onSelect: () => bulk!.done(group),
        },
        {
          key: 'g-archive',
          label: (
            <>
              <Archive size={14} /> {t('Archive selected')}
            </>
          ),
          onSelect: () => bulk!.archive(group),
        },
        { key: 'g-sep', separator: true },
        {
          key: 'g-delete',
          label: (
            <>
              <Trash2 size={14} /> {t('Delete selected…')}
            </>
          ),
          danger: true,
          onSelect: () => bulk!.requestDelete(group),
        },
        { key: 'g-sep2', separator: true },
        {
          key: 'g-clear',
          label: (
            <>
              <X size={14} /> {t('Clear selection')}
            </>
          ),
          onSelect: () => threadSelection.clear(),
        },
      ]
    : []
  const items: MenuEntry[] = [
    ...(selectable && !group
      ? [
          {
            key: 'select',
            label: (
              <>
                <Check size={14} /> {t('Select')}
              </>
            ),
            title: t('Pick several threads to act on together. Cmd/Ctrl-click or Shift-click also select.'),
            onSelect: () => threadSelection.toggle(task.id),
          },
          { key: 'select-sep', separator: true as const },
        ]
      : []),
    {
      key: 'copy-id',
      label: t('Copy thread ID'),
      onSelect: () => void copyText(task.id).catch((reason) => notifyError(errorText(reason), 'Copy thread ID')),
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
      key: 'pin',
      label: (
        <>
          {task.pinnedAt ? <PinOff size={14} /> : <Pin size={14} />} {task.pinnedAt ? t('Unpin') : t('Pin')}
        </>
      ),
      onSelect: () => void run(() => host.invoke('tasks.pin', task.id, !task.pinnedAt)),
    },
    ...(workspace
      ? [
          {
            key: 'rename-workspace',
            label: t('Rename workspace…'),
            disabled: unavailable || host.status !== 'connected',
            onSelect: () => {
              if (canWrite()) setRenamingWorkspace({ host: host.id, openedOn: activeHost, workspace })
            },
          },
        ]
      : []),
    {
      key: 'rename-ai',
      label: (
        <>
          <Sparkles size={14} />{' '}
          {t(
            naming || task.titleGenerationState === 'pending'
              ? 'Naming thread'
              : task.titleGenerationState === 'failed'
                ? 'Retry title generation'
                : 'Rename with AI',
          )}
        </>
      ),
      // The model settings are this window's own host's, so naming stays with the host on screen.
      disabled: naming || task.titleGenerationState === 'pending' || !onScreen,
      onSelect: () => {
        if (!canWrite() || !onScreen || titleRequest.current) return
        titleRequest.current = true
        setNaming(true)
        void run(() => host.invoke('tasks.generateTitle', task.id, initialSettings, true)).finally(() => {
          titleRequest.current = false
          setNaming(false)
        })
      },
    },
    ...(!archived
      ? [
          {
            key: 'done',
            label: (
              <>
                <Check size={14} /> {done ? t('Reopen') : t('Mark done')}
              </>
            ),
            disabled: !done && (task.status === 'running' || task.status === 'needs-input'),
            onSelect: () => void (done ? run(() => host.invoke('tasks.done', task.id, false)) : markDone()),
          },
        ]
      : []),
    archived
      ? {
          key: 'unarchive',
          label: (
            <>
              <ArchiveRestore size={14} /> {t(' Unarchive')}
            </>
          ),
          onSelect: () => void run(() => host.invoke('tasks.archive', task.id, false)),
        }
      : {
          key: 'archive',
          label: (
            <>
              <Archive size={14} /> {t(' Archive')}
            </>
          ),
          onSelect: () => void archive(),
        },
    ...(onScreen && ws?.ui.openTaskIds.includes(task.id)
      ? [
          {
            key: 'close',
            label: (
              <>
                <X size={14} /> {t(' Close workspace')}
              </>
            ),
            title: t('Closes the tab. Threads keep running and nothing is deleted.'),
            onSelect: () => ws?.closeTask(task.id),
          },
        ]
      : []),
    { key: 'sep', separator: true },
    {
      key: 'delete',
      label: (
        <>
          <Trash2 size={14} /> {t(' Delete…')}
        </>
      ),
      danger: true,
      onSelect: () => {
        if (canWrite()) setDeleting(true)
      },
    },
  ]

  // A view-only device may copy a thread's ID; everything else here changes the host and would be refused.
  const shownItems = viewOnly
    ? items.filter((entry) => 'key' in entry && ['copy-id', 'close'].includes(entry.key))
    : items
  const contextMenu = useContextMenu(`${task.title} actions`, group && !viewOnly ? groupItems : shownItems)

  const status = threadStatus(task, !!ws?.unread.has(task.id), task.goalState)
  return (
    <>
      <HoverCard open={hover && !renaming} onOpenChange={setHover}>
        <HoverCardTrigger
          delay={400}
          closeDelay={120}
          render={<div />}
          data-thread-motion-row=""
          data-task-row=""
          data-task-id={task.id}
          aria-selected={selectable ? selected : undefined}
          onContextMenu={
            unavailable
              ? undefined
              : (e: React.MouseEvent<HTMLElement>) => {
                  setHover(false)
                  contextMenu.onContextMenu(e)
                }
          }
          className={`task-row [&:hover_.row-actions]:opacity-100 [&:hover_.row-actions]:flex [&:focus-within_.row-actions]:opacity-100 [&:focus-within_.row-actions]:flex [&:hover]:bg-accent [&:hover]:text-foreground [&.active]:text-foreground [&.active]:bg-accent [&.active]:[box-shadow:none] [&.archived]:[opacity:0.6] [&:hover_.task-time]:hidden [&:hover_.task-pin]:hidden [&:focus-within_.task-pin]:hidden [&:focus-within_.task-time]:hidden [&_.row-actions]:hidden [&_.row-actions]:mr-0 [&_.row-actions:has([aria-expanded='true'])]:flex [&_>_:not(.task-title)]:mt-0 [&_.task-actions]:hidden [&_.task-actions]:opacity-100 [&_.task-actions]:gap-1 [&_.task-actions_button]:size-5 [&:hover_.task-actions]:flex [&:focus-within_.task-actions]:flex [&:hover_.task-trailing]:hidden [&:focus-within_.task-trailing]:hidden [&:hover_.agent-stack]:hidden [&:focus-within_.agent-stack]:hidden [transition:background-color_140ms_ease,_color_140ms_ease] flex items-center gap-2 text-soft cursor-default [transition:background_0.1s_var(--ease),_color_0.1s_var(--ease)] text-body leading-5 ${projectName || hostName ? 'min-h-11' : 'min-h-[30px]'} rounded-(--radius-s) p-[0_8px] ${active ? ' active' : ''}${selected ? ' selected bg-accent [box-shadow:inset_2px_0_0_var(--primary)]' : ''}${archived ? ' archived' : ''}${nested ? ' pl-[31px]' : ''}`}
          role="button"
          tabIndex={0}
          aria-disabled={unavailable || undefined}
          onClick={(e: React.MouseEvent<HTMLElement>) => {
            if (renaming) return
            if (selectable && (e.metaKey || e.ctrlKey)) return threadSelection.toggle(task.id)
            if (selectable && e.shiftKey) {
              const ordered = [
                ...new Set(
                  [...document.querySelectorAll<HTMLElement>('[data-task-row]')].map((row) => row.dataset.taskId!),
                ),
              ]
              return threadSelection.range(task.id, ordered, onScreen ? (ws?.ui.activeTaskId ?? null) : null)
            }
            // A plain click leaves selection mode and opens the thread, as in a file list.
            if (picked.size) threadSelection.clear()
            open()
          }}
          onDoubleClick={() => {
            if (!unavailable && canWrite()) setRenaming(true)
          }}
          onKeyDown={(e) => {
            if (unavailable) return
            contextMenu.onKeyDown(e)
            if (e.key === 'Enter' && !renaming) open()
          }}
        >
          {done && <Check size={14} className="flex-none text-muted-foreground" aria-label={t('Done')} />}
          {renaming ? (
            <InlineEdit
              readOnly={viewOnly}
              value={task.title}
              onDone={(v) => {
                if (v !== null && !canWrite()) return
                setRenaming(false)
                if (v && v !== task.title) void run(() => host.invoke('tasks.rename', task.id, v))
              }}
            />
          ) : (
            <>
              {projectName || hostName ? (
                <span className="grow flex-1 min-w-0 flex flex-col py-1 text-left">
                  <FadeText className="task-title overflow-hidden whitespace-nowrap" text={task.title} />
                  <span className="task-project truncate text-caption text-muted-foreground">
                    {[projectName, hostName].filter(Boolean).join(' · ')}
                  </span>
                </span>
              ) : (
                <FadeText
                  className="grow flex-1 min-w-0 text-left task-title overflow-hidden whitespace-nowrap"
                  text={task.title}
                />
              )}
              {!!earlierRuns && (
                <span
                  className="flex-none text-caption tabular-nums text-muted-foreground"
                  title={t('{0} earlier runs', { 0: earlierRuns })}
                >
                  +{earlierRuns}
                </span>
              )}
              {task.startedFrom && (
                <GitFork
                  size={12}
                  className="flex-none text-muted-foreground"
                  aria-label={threadOriginLabel(task.startedFrom, t)}
                />
              )}
              {task.kind === 'library-review' && (
                <span className="task-kind flex-none rounded-full bg-fill px-1.5 text-caption text-muted-foreground">
                  {t('Review')}
                </span>
              )}
            </>
          )}
          {task.pinnedAt && !archived && !hidePin && (
            <Pin
              size={12}
              className="task-pin muted text-muted-foreground mode-icon flex-none"
              aria-label={t('Pinned')}
            />
          )}
          {(naming || task.titleGenerationState === 'pending') && (
            <Sparkles
              size={12}
              className="muted text-muted-foreground mode-icon flex-none"
              aria-label={t('Naming thread')}
            />
          )}
          {task.mode === 'worktree' && (
            <span title={ws?.workspaces.find((w) => w.id === task.workspaceId)?.name ?? t('Isolated worktrees')}>
              <GitBranch
                size={12}
                className="muted text-muted-foreground mode-icon flex-none"
                aria-label={t('Isolated worktrees')}
              />
            </span>
          )}
          {/* The thread's agents, as the phone shows them: a handoff or teammate stays visible beside the leading one. */}
          <AgentStack task={task} />
          <span className={`${ROW_ACTIONS_CLASS} task-actions`} hidden={viewOnly}>
            {!archived && (
              <Button
                variant="ghost"
                size="icon-xs"
                className={ICON_BUTTON_CLASS}
                disabled={unavailable}
                aria-label={task.pinnedAt ? t('Unpin thread') : t('Pin thread')}
                title={task.pinnedAt ? t('Unpin') : t('Pin')}
                onClick={(e) => {
                  e.stopPropagation()
                  void run(() => host.invoke('tasks.pin', task.id, !task.pinnedAt))
                }}
              >
                {task.pinnedAt ? <PinOff size={14} /> : <Pin size={14} />}
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon-xs"
              className={ICON_BUTTON_CLASS}
              disabled={unavailable}
              aria-label={archived ? t('Unarchive thread') : done ? t('Reopen thread') : t('Mark thread done')}
              title={archived ? t('Unarchive') : done ? t('Reopen') : t('Mark done')}
              onClick={(e) => {
                e.stopPropagation()
                if (archived) void run(() => host.invoke('tasks.archive', task.id, false))
                else if (done) void run(() => host.invoke('tasks.done', task.id, false))
                else void markDone()
              }}
            >
              {archived ? <ArchiveRestore size={14} /> : done ? <RotateCcw size={14} /> : <Check size={14} />}
            </Button>
          </span>
          <TaskStateIcon task={task} unread={!!ws?.unread.has(task.id)} />
        </HoverCardTrigger>
        <ThreadHoverCard
          task={task}
          status={status}
          workspaceName={workspace?.name}
          sharedWorkspace={sharedWorktree}
          offline={!onScreen && host.status !== 'connected'}
        />
      </HoverCard>
      {contextMenu.menu}
      {renamingWorkspace?.host === host.id && renamingWorkspace.openedOn === activeHost && (
        <WorkspaceNameDialog
          key={`${host.id}:${renamingWorkspace.workspace.id}`}
          workspace={renamingWorkspace.workspace}
          online={!viewOnly && host.status === 'connected'}
          onSave={async (name, before) => {
            if (!canWrite()) throw new Error(t(VIEW_ONLY_WRITE_NOTICE))
            await host.invoke('workspaces.rename', renamingWorkspace.workspace.id, name, before)
            await refresh()
          }}
          onClose={() => setRenamingWorkspace((current) => (current === renamingWorkspace ? null : current))}
        />
      )}
      {error && !deleting && <div className={ROW_ERROR_CLASS}>{error}</div>}
      {deleting && (
        <DeleteThreadDialog
          task={task}
          hostName={computers?.computers.find((computer) => computer.id === host.id)?.name}
          sharedWorktree={sharedWorktree}
          onCancel={() => {
            setDeleting(false)
            setError(null)
          }}
          onDeleted={async () => {
            forget()
            await refresh()
            setDeleting(false)
          }}
        />
      )}
    </>
  )
}
