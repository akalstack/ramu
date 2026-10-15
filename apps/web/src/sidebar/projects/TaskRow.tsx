import { Button } from '@/components/desktop-button'
import { Checkbox } from '@/components/ui/checkbox'
import { Archive, ArchiveRestore, GitBranch, Pencil, Pin, PinOff, Sparkles, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import type { Task } from '@ramu/shared/types'
import { t, useLanguage } from '../../i18n'
import { copyText, invoke } from '../../ipc'
import { Dialog, useContextMenu, type MenuEntry } from '../../Menu'
import { errorText } from '../../workspace/TaskPane'
import { notifyError } from '../../chat/Notifications'
import { useWorkspace } from '../../workspace/workspace'
import { FadeText } from '../../FadeText'
import { useModelSets } from '../../models/ModelSets'
import { ICON_BUTTON_CLASS, ROW_ACTIONS_CLASS, ROW_ERROR_CLASS } from './constants'
import { InlineEdit } from './InlineEdit'
import { TaskStateIcon } from './TaskStateIcon'

export function TaskRow({
  task,
  projectName,
  hidePin,
  nested,
}: {
  task: Task
  projectName?: string
  hidePin?: boolean
  nested?: boolean
}) {
  useLanguage()
  const ws = useWorkspace()
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const sharedWorktree =
    !!task.workspaceId && ws.tasks.some((t) => t.id !== task.id && t.workspaceId === task.workspaceId)
  const [removeWorktrees, setRemoveWorktrees] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const active = ws.ui.activeTaskId === task.id && !ws.composing
  const archived = task.status === 'archived'
  const { initialSettings } = useModelSets()
  const [naming, setNaming] = useState(false)

  const run = async (fn: () => Promise<unknown>) => {
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
      key: 'copy-id',
      label: t('Copy chat ID'),
      onSelect: () => void copyText(task.id).catch((reason) => notifyError(errorText(reason), 'Copy chat ID')),
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
    {
      key: 'pin',
      label: (
        <>
          {task.pinnedAt ? <PinOff size={14} /> : <Pin size={14} />} {task.pinnedAt ? t('Unpin') : t('Pin')}
        </>
      ),
      onSelect: () => void run(() => invoke('tasks.pin', task.id, !task.pinnedAt)),
    },
    {
      key: 'rename-ai',
      label: (
        <>
          <Sparkles size={14} /> {t(' Rename with AI')}
        </>
      ),
      disabled: naming,
      onSelect: () => {
        setNaming(true)
        void run(() => invoke('tasks.generateTitle', task.id, initialSettings, true)).finally(() => setNaming(false))
      },
    },
    archived
      ? {
          key: 'unarchive',
          label: (
            <>
              <ArchiveRestore size={14} /> {t(' Unarchive')}
            </>
          ),
          onSelect: () => void run(() => invoke('tasks.archive', task.id, false)),
        }
      : {
          key: 'archive',
          label: (
            <>
              <Archive size={14} /> {t(' Archive')}
            </>
          ),
          onSelect: () =>
            void run(async () => {
              await invoke('tasks.archive', task.id, true)
              ws.forgetTask(task.id)
            }),
        },
    ...(ws.ui.openTaskIds.includes(task.id)
      ? [
          {
            key: 'close',
            label: (
              <>
                <X size={14} /> {t(' Close workspace')}
              </>
            ),
            title: t('Closes the tab. Chats keep running and nothing is deleted.'),
            onSelect: () => ws.closeTask(task.id),
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
      onSelect: () => setDeleting(true),
    },
  ]

  const contextMenu = useContextMenu(`${task.title} actions`, items)

  return (
    <>
      <div
        onContextMenu={contextMenu.onContextMenu}
        className={`task-row [&:hover_.row-actions]:opacity-100 [&:hover_.row-actions]:flex [&:focus-within_.row-actions]:opacity-100 [&:focus-within_.row-actions]:flex [&:hover]:bg-accent [&:hover]:text-foreground [&.active]:text-foreground [&.active]:bg-accent [&.active]:[box-shadow:none] [&.archived]:[opacity:0.6] [&:hover_.task-time]:hidden [&:hover_.task-pin]:hidden [&:focus-within_.task-pin]:hidden [&:focus-within_.task-time]:hidden [&_.row-actions]:hidden [&_.row-actions]:mr-0 [&_.row-actions:has([aria-expanded='true'])]:flex [&_>_:not(.task-title)]:mt-0 [&_.task-actions]:hidden [&_.task-actions]:opacity-100 [&_.task-actions]:gap-0.5 [&:hover_.task-actions]:flex [&:focus-within_.task-actions]:flex [&:hover_.task-state]:hidden [&:focus-within_.task-state]:hidden [transition:background-color_140ms_ease,_color_140ms_ease] [&:has(.task-project)]:gap-1 flex items-center gap-2 text-soft cursor-default [transition:background_0.1s_var(--ease),_color_0.1s_var(--ease)] text-body leading-5 min-h-[30px] rounded-(--radius-s) p-[0_8px] ${active ? ' active' : ''}${archived ? ' archived' : ''}${nested ? ' pl-[31px]' : ''}`}
        role="button"
        tabIndex={0}
        onClick={() => !renaming && ws.openTask(task.id)}
        onDoubleClick={() => setRenaming(true)}
        onKeyDown={(e) => {
          contextMenu.onKeyDown(e)
          if (e.key === 'Enter' && !renaming) ws.openTask(task.id)
        }}
      >
        {renaming ? (
          <InlineEdit
            value={task.title}
            onDone={(v) => {
              setRenaming(false)
              if (v && v !== task.title) void run(() => invoke('tasks.rename', task.id, v))
            }}
          />
        ) : (
          <>
            {projectName && (
              <span className="task-project [&::after]:[content:'·'] [&::after]:ml-1 flex-none max-w-[40%] overflow-hidden text-ellipsis whitespace-nowrap text-muted-foreground font-medium">
                {projectName}
              </span>
            )}
            <FadeText
              className="grow flex-1 min-w-0 text-left task-title overflow-hidden whitespace-nowrap"
              text={task.title}
            />
          </>
        )}
        {task.pinnedAt && !archived && !hidePin && (
          <Pin
            size={12}
            className="task-pin muted text-muted-foreground mode-icon flex-none"
            aria-label={t('Pinned')}
          />
        )}
        {naming && (
          <Sparkles
            size={12}
            className="muted text-muted-foreground mode-icon flex-none"
            aria-label={t('Naming chat')}
          />
        )}
        {task.mode === 'worktree' && (
          <span title={ws.workspaces.find((w) => w.id === task.workspaceId)?.name ?? t('Isolated worktrees')}>
            <GitBranch
              size={12}
              className="muted text-muted-foreground mode-icon flex-none"
              aria-label={t('Isolated worktrees')}
            />
          </span>
        )}
        <span className={`${ROW_ACTIONS_CLASS} task-actions`}>
          {!archived && (
            <Button
              variant="ghost"
              size="icon-xs"
              className={ICON_BUTTON_CLASS}
              aria-label={task.pinnedAt ? t('Unpin chat') : t('Pin chat')}
              title={task.pinnedAt ? t('Unpin') : t('Pin')}
              onClick={(e) => {
                e.stopPropagation()
                void run(() => invoke('tasks.pin', task.id, !task.pinnedAt))
              }}
            >
              {task.pinnedAt ? <PinOff size={14} /> : <Pin size={14} />}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-xs"
            className={ICON_BUTTON_CLASS}
            aria-label={archived ? t('Unarchive chat') : t('Archive chat')}
            title={archived ? t('Unarchive') : t('Archive')}
            onClick={(e) => {
              e.stopPropagation()
              void run(async () => {
                await invoke('tasks.archive', task.id, !archived)
                if (!archived) ws.forgetTask(task.id)
              })
            }}
          >
            {archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
          </Button>
        </span>
        <TaskStateIcon task={task} unread={ws.unread.has(task.id)} />
      </div>
      {contextMenu.menu}
      {error && !deleting && <div className={ROW_ERROR_CLASS}>{error}</div>}
      {deleting && (
        <Dialog
          title={t('Delete “{0}”?', { '0': task.title })}
          confirmLabel={t('Delete chat')}
          danger
          busy={busy}
          error={error}
          onCancel={() => {
            setDeleting(false)
            setError(null)
          }}
          onConfirm={async () => {
            setBusy(true)
            setError(null)
            try {
              await invoke('tasks.delete', task.id, task.mode === 'worktree' && !sharedWorktree && removeWorktrees)
              ws.forgetTask(task.id)
              await ws.refresh()
              setDeleting(false)
            } catch (e) {
              setError(errorText(e))
            } finally {
              setBusy(false)
            }
          }}
        >
          <p>{t('This removes the chat and its agent transcripts. Its running agents are stopped.')}</p>
          {task.mode === 'worktree' && !sharedWorktree ? (
            <label>
              <Checkbox checked={removeWorktrees} onCheckedChange={(checked) => setRemoveWorktrees(checked === true)} />
              <span>
                {t('Also remove its worktrees')}
                <span className="muted text-muted-foreground block block">
                  {t('Only if they have no uncommitted changes. Branches are kept.')}
                </span>
              </span>
            </label>
          ) : (
            <p className="muted text-muted-foreground">
              {t('Shared files, terminals, worktrees, and other chats stay open.')}
            </p>
          )}
        </Dialog>
      )}
    </>
  )
}
