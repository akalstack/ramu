import { t, useLanguage } from './i18n'
import { ButtonGroup } from '@/components/ui/button-group'
import { Kbd } from '@/components/ui/kbd'
import { Dialog as ShadcnDialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  GripVertical,
  Eye,
  EyeOff,
  Pencil,
  Play,
  Plus,
  Settings2,
  SquareTerminal,
  Trash2,
} from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { ProjectAction } from '@ramu/shared/types'
import { formatKeys } from './commands'
import { useHost } from './workspace/HostProvider'
import { Menu, type MenuEntry } from './Menu'
import { errorText } from './workspace/TaskPane'
import { useWorkspace } from './workspace/workspace'
import { PROJECT_ACTIONS_EVENT, useProjectActions } from './workspace/useProjectActions'
import { useProjectActionSettings } from './workspace/useProjectActionSettings'
export { useProjectActions } from './workspace/useProjectActions'
import { hostStorageFor } from './hostStorage'

/** Window-bar actions for the open chat, like T3 Code: saved project commands that run in a terminal. */
export function WindowActions({ ctx, projectId }: { ctx: string; projectId?: string }) {
  useLanguage()
  const host = useHost()
  return (
    <div className="window-actions [&_+_.workspace-tool-buttons]:ml-2 [&_button]:h-7 [&_button]:min-h-7 [&_button]:gap-1.5 [&_button]:p-[0_10px] [&_button]:[border:0] [&_button]:rounded-(--radius-s) [&_button]:bg-fill [&_button]:text-soft [&_button]:text-control [&_button]:whitespace-nowrap [&_button:hover:not(:disabled)]:[background:var(--fill-hover)] [&_button:hover:not(:disabled)]:text-foreground [&_button.on]:[background:var(--fill-hover)] [&_button.on]:text-foreground [&_button_>_svg]:flex-none [&_button_>_span]:max-w-[140px] [&_button_>_span]:overflow-hidden [&_button_>_span]:text-ellipsis [&_.split-button_>_.split-menu]:w-6 [&_.split-button_>_.split-menu]:p-0 [&_.split-button_>_.split-menu]:justify-center [&_.split-button_>_.split-menu]:[border-top-left-radius:0] [&_.split-button_>_.split-menu]:[border-bottom-left-radius:0] [&_.split-button_>_.split-menu]:text-muted-foreground flex items-center gap-1.5 flex-none ml-auto [-webkit-app-region:no-drag]">
      {projectId && <ActionsControl key={JSON.stringify([host.id, projectId, ctx])} ctx={ctx} projectId={projectId} />}
    </div>
  )
}

/** One button with a separate menu trigger; both halves share a single filled shape. */
function SplitButton({
  icon,
  label,
  title,
  onClick,
  disabled,
  menuLabel,
  items,
  primary,
}: {
  icon: ReactNode
  label: string
  title?: string
  onClick: () => void
  disabled?: boolean
  menuLabel: string
  items: MenuEntry[]
  primary?: boolean
}) {
  return (
    <ButtonGroup
      className={`split-button [&_>_.split-main]:[border-top-right-radius:0] [&_>_.split-main]:[border-bottom-right-radius:0] [&_>_.split-main]:pr-[9px] [&.primary_>_button]:text-foreground flex items-center gap-px${primary ? ' primary bg-primary text-primary-foreground border-transparent font-semibold justify-center hover:bg-primary-hover disabled:bg-raised disabled:text-muted-foreground disabled:opacity-100' : ''}`}
      aria-label={label}
    >
      <Button
        variant="secondary"
        className="bg-fill hover:bg-fill-hover split-main"
        title={title}
        disabled={disabled}
        onClick={onClick}
      >
        {icon}
        <span>{label}</span>
      </Button>
      <Menu label={menuLabel} icon={<ChevronDown size={13} />} className="split-menu" align="end" items={items} />
    </ButtonGroup>
  )
}

// ---- Project actions ----------------------------------------------------------------------------

/** Opens a terminal at the chat's workspace and types the action's command into it. */
export function runProjectAction(ws: ReturnType<typeof useWorkspace>, ctx: string, action: ProjectAction) {
  ws.openView(ctx, { kind: 'terminal', title: action.name, command: action.command, runAt: Date.now() })
}

function ActionsControl({ ctx, projectId }: { ctx: string; projectId: string }) {
  useLanguage()
  const ws = useWorkspace()
  const actions = useProjectActions(projectId)
  const [editing, setEditing] = useState<ProjectAction | 'new' | null>(null)
  const [managing, setManaging] = useState(false)
  const hostStorage = hostStorageFor(useHost().id)
  const [lastId, setLastId] = useState<string | null>(() => hostStorage.getItem(`ramu.last-action:${projectId}`))
  const run = (action: ProjectAction) => {
    setLastId(action.id)
    try {
      hostStorage.setItem(`ramu.last-action:${projectId}`, action.id)
    } catch {
      /* Remembered for this session only. */
    }
    runProjectAction(ws, ctx, action)
  }
  const dialog = (
    <>
      {editing && (
        <ActionDialog
          projectId={projectId}
          actions={actions}
          action={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {managing && !editing && (
        <ManageDialog projectId={projectId} actions={actions} onEdit={setEditing} onClose={() => setManaging(false)} />
      )}
    </>
  )
  if (!actions.length)
    return (
      <>
        <Button
          variant="secondary"
          className="bg-fill hover:bg-fill-hover window-action"
          title={t('Save a command you run often, like a dev server or tests')}
          onClick={() => setEditing('new')}
        >
          <Plus size={14} />
          <span>{t('Add action')}</span>
        </Button>
        <Button variant="ghost" size="icon-xs" aria-label={t('Manage actions')} onClick={() => setManaging(true)}>
          <Settings2 />
        </Button>
        {dialog}
      </>
    )
  const main = actions.find((action) => action.id === lastId) ?? actions[0]!
  return (
    <>
      <SplitButton
        icon={<Play size={13} />}
        label={main.name}
        title={`${main.command}${main.keys ? ` (${formatKeys(main.keys)})` : ''}`}
        onClick={() => run(main)}
        menuLabel={t('Project actions')}
        items={[
          ...actions.map((action): MenuEntry => ({
            key: action.id,
            label: (
              <>
                <SquareTerminal size={14} />
                <span className="menu-label [.chat-switch-menu_&]:flex-1 [.chat-switch-menu_&]:max-w-[none] [.chat-switch-menu_&]:leading-[18px] [.chat-switch-menu_&]:font-medium [.chat-switch-menu_&]:min-w-0 [.dropdown-menu_&]:min-w-0 [.dropdown-menu_&]:max-w-[none] [.dropdown-menu_&]:whitespace-nowrap [.project-switch-menu_&]:max-w-[none] [.project-switch-menu_&]:leading-[18px] [.project-switch-menu_&]:font-medium [.project-switch-menu_&]:min-w-0 [.project-switch-menu_&_.block]:max-w-[none] [.project-switch-menu_&_.block]:overflow-hidden [.project-switch-menu_&_.block]:text-ellipsis [.project-switch-menu_&_.block]:whitespace-nowrap [.project-switch-menu_&_.block]:m-[2px_0_0] [.project-switch-menu_&_.block]:text-caption [.project-switch-menu_&_.block]:leading-[16px] [.project-switch-menu_&_.block]:font-normal [.project-switch-menu_&_.block]:text-muted-foreground [.chat-switch-menu_&_.block]:overflow-hidden [.chat-switch-menu_&_.block]:text-ellipsis [.chat-switch-menu_&_.block]:whitespace-nowrap [.chat-switch-menu_&_.block]:m-[2px_0_0] [.chat-switch-menu_&_.block]:text-caption [.chat-switch-menu_&_.block]:leading-[16px] [.chat-switch-menu_&_.block]:font-normal [.chat-switch-menu_&_.block]:text-muted-foreground max-w-[220px] overflow-hidden text-ellipsis grow flex-1 min-w-0 text-left">
                  {action.name}
                </span>
                {action.source && <span className="text-caption text-muted-foreground">{action.source}</span>}
                {action.keys && <Kbd>{formatKeys(action.keys)}</Kbd>}
              </>
            ),
            title: action.command,
            onSelect: () => run(action),
          })),
          { key: 'separator', separator: true },
          {
            key: 'add',
            label: (
              <>
                <Plus size={14} />
                {t('Add action…')}
              </>
            ),
            onSelect: () => setEditing('new'),
          },
          {
            key: 'manage',
            label: (
              <>
                <Settings2 size={14} />
                {t('Manage actions…')}
              </>
            ),
            onSelect: () => setManaging(true),
          },
        ]}
      />
      {dialog}
    </>
  )
}

const ACTION_DIALOG_CLASS =
  "dialog [&_h3]:m-[0_0_8px] [&_h3]:text-heading [&_h3]:font-semibold [&_h3]:tracking-[-0.01em] [&:has(.model-settings)]:w-[min(640px,_calc(100vw_-_40px))] [&:has(.model-settings)]:max-h-[calc(100vh_-_40px)] [&:has(.model-settings)]:flex [&:has(.model-settings)]:flex-col [&:has(.model-settings)_>_.dialog-body]:overflow-auto [&:has(.model-settings)_>_.dialog-body]:min-h-0 [&:has(.model-settings)_>_h3]:flex-none [&:has(.model-settings)_>_.dialog-actions]:flex-none [&:has(.undo-preview)]:w-[min(1000px,_calc(100vw_-_48px))] [&:has(.undo-preview)]:max-w-[none] [&:has(.undo-preview)]:max-h-[calc(100vh_-_48px)] [&:has(.undo-preview)]:flex [&:has(.undo-preview)]:flex-col [&:has(.undo-preview)_.dialog-body]:min-h-0 [&:has(.undo-preview)_.dialog-body]:overflow-auto [[data-slot='dialog-content']&]:block [[data-slot='dialog-content']&]:max-w-[none] [[data-slot='dialog-content']&]:max-h-[calc(100vh_-_48px)] [[data-slot='dialog-content']&]:overflow-y-auto [background:var(--float-bg)] [-webkit-backdrop-filter:var(--float-blur)] [backdrop-filter:var(--float-blur)] [border:1px_solid_var(--edge)] [box-shadow:0_18px_48px_rgba(0,_0,_0,_0.45),_0_2px_8px_rgba(0,_0,_0,_0.25),_inset_0_1px_0_rgb(var(--ink)_/_0.07)] [&:has(.workspace-sync)]:w-[min(680px,_calc(100vw_-_48px))] w-[min(440px,_calc(100vw_-_48px))] bg-card [border:1px_solid_var(--edge)] rounded-(--radius-l) p-[18px_20px_16px] [box-shadow:0_24px_64px_rgba(0,_0,_0,_0.55)] [animation:pop_0.14s_var(--ease)] action-dialog"

/** Turns a key press into Ramu's binding format; plain keys need a modifier so typing never triggers an action. */
function keysFromEvent(event: React.KeyboardEvent): string | null {
  if (['Meta', 'Control', 'Shift', 'Alt'].includes(event.key)) return null
  const mod = /Mac/.test(navigator.userAgent) ? event.metaKey : event.ctrlKey
  if (!mod && !event.altKey) return null
  const key = event.code.startsWith('Key')
    ? event.code.slice(3).toLowerCase()
    : event.code.startsWith('Digit')
      ? event.code.slice(5)
      : null
  if (!key) return null
  return [mod && 'mod', event.altKey && 'alt', event.shiftKey && 'shift', key].filter(Boolean).join('+')
}

function ActionDialog({
  projectId,
  actions,
  action,
  onClose,
}: {
  projectId: string
  actions: ProjectAction[]
  action: ProjectAction | null
  onClose: () => void
}) {
  useLanguage()
  const { invoke } = useHost()
  const [name, setName] = useState(action?.name ?? '')
  const [command, setCommand] = useState(action?.command ?? '')
  const [keys, setKeys] = useState(action?.keys ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pending = useRef(false)
  const save = async (next: ProjectAction[]) => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError(null)
    try {
      await invoke('projects.setActions', projectId, next)
      window.dispatchEvent(new Event(PROJECT_ACTIONS_EVENT))
      onClose()
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  const submit = () => {
    if (!name.trim() || !command.trim()) return
    const entry: ProjectAction = {
      id: action?.id ?? crypto.randomUUID(),
      name: name.trim(),
      command: command.trim(),
      ...(keys ? { keys } : {}),
    }
    void save(action ? actions.map((current) => (current.id === action.id ? entry : current)) : [...actions, entry])
  }
  return (
    <ShadcnDialog
      open
      disablePointerDismissal={busy}
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent className={ACTION_DIALOG_CLASS} showCloseButton={false} aria-describedby={undefined}>
        <DialogTitle>{action ? t('Edit action') : t('Add action')}</DialogTitle>
        <form
          className="dialog-body text-soft text-[length:var(--ui-font-size)] action-form [&_label]:w-full [&_label]:text-caption [&_label]:font-medium [&_label]:text-soft [&_textarea.mono]:font-mono [&_textarea.mono]:text-caption [&_.action-keys]:flex [&_.action-keys]:items-center [&_.action-keys]:gap-1.5 [&_.action-keys_input]:flex-1 [&_.action-keys_input]:[caret-color:transparent] [&_.dialog-actions]:items-center flex flex-col gap-3.5 mt-3"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <Field>
            <FieldLabel htmlFor="action-name">{t('Name')}</FieldLabel>
            <Input
              id="action-name"
              autoFocus
              maxLength={60}
              value={name}
              placeholder={t('Dev server')}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="action-command">{t('Command')}</FieldLabel>
            <Textarea
              id="action-command"
              className="mono"
              rows={3}
              maxLength={4000}
              value={command}
              placeholder="pnpm dev"
              onChange={(event) => setCommand(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault()
                  submit()
                }
              }}
            />
            <FieldDescription className="text-caption">
              {t("Runs in a new terminal at the thread's workspace.")}
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="action-keys">{t('Shortcut')}</FieldLabel>
            <span className="action-keys">
              <Input
                id="action-keys"
                readOnly
                value={keys ? formatKeys(keys) : ''}
                placeholder={t('Press a shortcut, e.g. {0}', { '0': formatKeys('mod+shift+r') })}
                onKeyDown={(event) => {
                  if (event.key === 'Tab' || event.key === 'Escape') return
                  event.preventDefault()
                  if (event.key === 'Backspace' || event.key === 'Delete') return setKeys('')
                  const next = keysFromEvent(event)
                  if (next) setKeys(next)
                }}
              />
              {keys && (
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover small text-caption"
                  onClick={() => setKeys('')}
                >
                  {t('Clear')}
                </Button>
              )}
            </span>
            <FieldDescription className="text-caption">
              {t('Focus the field and press the keys. Backspace removes it.')}
            </FieldDescription>
          </Field>
          {error && (
            <div className="error text-bad small text-caption" role="alert">
              {error}
            </div>
          )}
          <div className="dialog-actions [&_button]:p-[5px_14px] flex justify-end gap-2 mt-3.5">
            {action && (
              <Button
                variant="ghost"
                type="button"
                className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover danger-text"
                disabled={busy || Boolean(action.source)}
                onClick={() => void save(actions.filter((current) => current.id !== action.id))}
              >
                {t('Delete')}
              </Button>
            )}
            <span className="grow flex-1 min-w-0 text-left" />
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              {t('Cancel')}
            </Button>
            <Button
              variant="default"
              type="submit"
              className="primary bg-primary text-primary-foreground border-transparent font-semibold justify-center hover:bg-primary-hover disabled:bg-raised disabled:text-muted-foreground disabled:opacity-100"
              disabled={busy || !name.trim() || !command.trim()}
            >
              {t('Save')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </ShadcnDialog>
  )
}

/** Every action in one place: drag rows or use the arrows to set their order (the first is the default button until one is run), edit, delete or add. Order changes are saved as they are made. */
/** One row of the Manage actions list; the grip is the drag handle. */
function SortableActionRow({ id, busy, children }: { id: string; busy: boolean; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: busy,
  })
  return (
    <div
      ref={setNodeRef}
      role="listitem"
      className="flex items-center gap-1.5 min-h-10 p-[0_4px_0_4px] rounded-(--radius-s) bg-fill text-control relative"
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : undefined,
        zIndex: isDragging ? 1 : undefined,
      }}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        className="flex-none cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing disabled:cursor-default"
        aria-label={t('Drag to reorder')}
        title={t('Drag to reorder')}
        disabled={busy}
        {...attributes}
        {...listeners}
      >
        <GripVertical size={14} />
      </button>
      {children}
    </div>
  )
}

function ManageDialog({
  projectId,
  actions: fallbackActions,
  onEdit,
  onClose,
}: {
  projectId: string
  actions: ProjectAction[]
  onEdit: (action: ProjectAction | 'new') => void
  onClose: () => void
}) {
  useLanguage()
  const { invoke, status } = useHost()
  const settings = useProjectActionSettings(projectId)
  const hidden = new Set(settings.hiddenIds)
  const actions = settings.supported ? settings.actions.filter((action) => !hidden.has(action.id)) : fallbackActions
  const hiddenActions = settings.actions.filter((action) => hidden.has(action.id))
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pending = useRef(false)
  const disabled = busy || settings.loading || status !== 'connected'
  const mutate = async (operation: () => Promise<unknown>) => {
    if (pending.current || disabled) return
    pending.current = true
    setBusy(true)
    setError(null)
    try {
      await operation()
      window.dispatchEvent(new Event(PROJECT_ACTIONS_EVENT))
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  const save = (next: ProjectAction[]) => mutate(() => invoke('projects.setActions', projectId, next))
  const move = (from: number, to: number) => {
    if (disabled || !settings.supported || from === to || to < 0 || to >= actions.length) return
    const next = [...actions]
    next.splice(to, 0, next.splice(from, 1)[0]!)
    void mutate(() =>
      invoke(
        'projects.reorderActions',
        projectId,
        next.map((action) => action.id),
      ),
    )
  }
  const drop = (event: DragEndEvent) => {
    const from = actions.findIndex((action) => action.id === event.active.id),
      to = actions.findIndex((action) => action.id === event.over?.id)
    if (from >= 0 && to >= 0) move(from, to)
  }
  return (
    <ShadcnDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className={ACTION_DIALOG_CLASS} showCloseButton={false} aria-describedby={undefined}>
        <DialogTitle>{t('Manage actions')}</DialogTitle>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={drop}>
          <SortableContext items={actions.map((action) => action.id)} strategy={verticalListSortingStrategy}>
            <div className="flex flex-col gap-1 mt-3" role="list">
              {actions.length === 0 && hiddenActions.length === 0 && (
                <div className="p-[10px_4px] text-caption text-muted-foreground">{t('No actions yet.')}</div>
              )}
              {actions.map((action, index) => (
                <SortableActionRow key={action.id} id={action.id} busy={disabled || !settings.supported}>
                  <span className="flex-1 min-w-0 flex flex-col text-left">
                    <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                      {action.name}
                      {action.source ? ` · ${action.source}` : ''}
                    </span>
                    <span
                      className="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-caption text-muted-foreground"
                      title={action.command}
                    >
                      {action.command}
                    </span>
                  </span>
                  {action.keys && <Kbd>{formatKeys(action.keys)}</Kbd>}
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    type="button"
                    className="flex-none"
                    aria-label={t('Move {0} up', { '0': action.name })}
                    disabled={disabled || !settings.supported || index === 0}
                    onClick={() => move(index, index - 1)}
                  >
                    <ArrowUp size={14} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    type="button"
                    className="flex-none"
                    aria-label={t('Move {0} down', { '0': action.name })}
                    disabled={disabled || !settings.supported || index === actions.length - 1}
                    onClick={() => move(index, index + 1)}
                  >
                    <ArrowDown size={14} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    type="button"
                    className="flex-none"
                    aria-label={t('Edit {0}', { '0': action.name })}
                    disabled={disabled}
                    onClick={() => onEdit(action)}
                  >
                    <Pencil size={14} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    type="button"
                    aria-label={t('Hide {0}', { '0': action.name })}
                    disabled={disabled || !settings.supported}
                    onClick={() =>
                      void mutate(() => invoke('projects.setActionVisibility', projectId, action.id, true))
                    }
                  >
                    <EyeOff />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    type="button"
                    className="flex-none"
                    aria-label={t('Delete {0}', { '0': action.name })}
                    disabled={disabled || Boolean(action.source)}
                    onClick={() => void save(actions.filter((current) => current.id !== action.id))}
                  >
                    <Trash2 size={14} />
                  </Button>
                </SortableActionRow>
              ))}
            </div>
          </SortableContext>
        </DndContext>
        {hiddenActions.length > 0 && (
          <div className="flex flex-col gap-2 mt-3" role="list" aria-label={t('Hidden actions')}>
            <p className="text-caption text-muted-foreground">
              {t('Hidden actions do not appear in menus or shortcuts.')}
            </p>
            {hiddenActions.map((action) => (
              <div key={action.id} role="listitem" className="flex items-center gap-2">
                <span className="flex-1 min-w-0 flex flex-col">
                  <span className="truncate">{action.name}</span>
                  <span className="truncate text-caption text-muted-foreground">
                    {action.command}
                    {action.source ? ` · ${action.source}` : ''}
                  </span>
                </span>
                <Button
                  variant="ghost"
                  disabled={disabled}
                  onClick={() => void mutate(() => invoke('projects.setActionVisibility', projectId, action.id, false))}
                >
                  <Eye data-icon="inline-start" />
                  {t('Show action')}
                </Button>
              </div>
            ))}
          </div>
        )}
        {settings.error && (
          <p role="status" className="text-caption text-muted-foreground">
            {/^Unknown method\b/.test(settings.error)
              ? t('Update this host to manage action order and visibility.')
              : settings.error}
          </p>
        )}
        {error && (
          <div className="error text-bad small text-caption mt-2" role="alert">
            {error}
          </div>
        )}
        <div className="dialog-actions flex items-center justify-end gap-2 mt-3.5">
          <Button
            type="button"
            variant="ghost"
            className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground"
            disabled={disabled}
            onClick={() => onEdit('new')}
          >
            <Plus size={14} />
            {t('Add action')}
          </Button>
          {settings.customOrder && (
            <Button
              variant="ghost"
              disabled={disabled}
              onClick={() => void mutate(() => invoke('projects.resetActionOrder', projectId))}
            >
              {t('Use repository order')}
            </Button>
          )}
          <span className="grow flex-1 min-w-0" />
          <Button
            variant="default"
            type="button"
            className="primary bg-primary text-primary-foreground border-transparent font-semibold justify-center hover:bg-primary-hover"
            onClick={onClose}
          >
            {t('Done')}
          </Button>
        </div>
      </DialogContent>
    </ShadcnDialog>
  )
}
