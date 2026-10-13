import { t, useLanguage } from './i18n'
import { ButtonGroup } from '@/components/ui/button-group'
import { Kbd } from '@/components/ui/kbd'
import { Dialog as ShadcnDialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { ArrowDown, ArrowUp, ChevronDown, GripVertical, Pencil, Play, Plus, SquareTerminal } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { ProjectAction } from '../../shared/types'
import { formatKeys } from './commands'
import { invoke } from './ipc'
import { Menu, type MenuEntry } from './Menu'
import { errorText } from './TaskPane'
import { useWorkspace } from './workspace'

/** Window-bar actions for the open chat, like T3 Code: saved project commands that run in a terminal. */
export function WindowActions({ ctx, projectId }: { ctx: string; projectId?: string }) {
  useLanguage()
  return <div className="window-actions [&_+_.workspace-tool-buttons]:ml-2 [&_button]:h-7 [&_button]:min-h-7 [&_button]:gap-1.5 [&_button]:p-[0_10px] [&_button]:[border:0] [&_button]:rounded-(--radius-s) [&_button]:bg-fill [&_button]:text-soft [&_button]:text-control [&_button]:whitespace-nowrap [&_button:hover:not(:disabled)]:[background:var(--fill-hover)] [&_button:hover:not(:disabled)]:text-foreground [&_button.on]:[background:var(--fill-hover)] [&_button.on]:text-foreground [&_button_>_svg]:flex-none [&_button_>_span]:max-w-[140px] [&_button_>_span]:overflow-hidden [&_button_>_span]:text-ellipsis [&_.split-button_>_.split-menu]:w-6 [&_.split-button_>_.split-menu]:p-0 [&_.split-button_>_.split-menu]:justify-center [&_.split-button_>_.split-menu]:[border-top-left-radius:0] [&_.split-button_>_.split-menu]:[border-bottom-left-radius:0] [&_.split-button_>_.split-menu]:text-muted-foreground flex items-center gap-1.5 flex-none ml-auto [-webkit-app-region:no-drag]">
    {projectId && <ActionsControl ctx={ctx} projectId={projectId} />}
  </div>
}

/** One button with a separate menu trigger; both halves share a single filled shape. */
function SplitButton({ icon, label, title, onClick, disabled, menuLabel, items, primary }: { icon: ReactNode; label: string; title?: string; onClick: () => void; disabled?: boolean; menuLabel: string; items: MenuEntry[]; primary?: boolean }) {
  return <ButtonGroup className={`split-button [&_>_.split-main]:[border-top-right-radius:0] [&_>_.split-main]:[border-bottom-right-radius:0] [&_>_.split-main]:pr-[9px] [&.primary_>_button]:text-foreground flex items-center gap-px${primary ? ' primary bg-primary text-primary-foreground border-transparent font-semibold justify-center hover:bg-primary-hover disabled:bg-raised disabled:text-muted-foreground disabled:opacity-100' : ''}`} aria-label={label}>
    <Button variant="secondary" className="bg-fill hover:bg-fill-hover split-main" title={title} disabled={disabled} onClick={onClick}>{icon}<span>{label}</span></Button>
    <Menu label={menuLabel} icon={<ChevronDown size={13} />} className="split-menu" align="end" items={items} />
  </ButtonGroup>
}

// ---- Project actions ----------------------------------------------------------------------------

export const PROJECT_ACTIONS_EVENT = 'ramu:project-actions'

/** The project's saved actions, refreshed whenever any window-bar control changes them. */
export function useProjectActions(projectId?: string) {
  const [actions, setActions] = useState<ProjectAction[]>([])
  const load = useCallback(() => {
    if (!projectId) return setActions([])
    void invoke('projects.actions', projectId).then(setActions, () => setActions([]))
  }, [projectId])
  useEffect(() => {
    load()
    window.addEventListener(PROJECT_ACTIONS_EVENT, load)
    return () => window.removeEventListener(PROJECT_ACTIONS_EVENT, load)
  }, [load])
  return actions
}

/** Opens a terminal at the chat's workspace and types the action's command into it. */
export function runProjectAction(ws: ReturnType<typeof useWorkspace>, ctx: string, action: ProjectAction) {
  ws.openView(ctx, { kind: 'terminal', title: action.name, command: action.command, runAt: Date.now() })
}

function ActionsControl({ ctx, projectId }: { ctx: string; projectId: string }) {
  useLanguage()
  const ws = useWorkspace()
  const actions = useProjectActions(projectId)
  const [editing, setEditing] = useState<ProjectAction | 'new' | null>(null)
  const [arranging, setArranging] = useState(false)
  const [lastId, setLastId] = useState<string | null>(() => localStorage.getItem(`ramu.last-action:${projectId}`))
  const run = (action: ProjectAction) => {
    setLastId(action.id)
    try { localStorage.setItem(`ramu.last-action:${projectId}`, action.id) } catch { /* Remembered for this session only. */ }
    runProjectAction(ws, ctx, action)
  }
  const dialog = <>
    {editing && <ActionDialog projectId={projectId} actions={actions} action={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    {arranging && <ArrangeDialog projectId={projectId} actions={actions} onClose={() => setArranging(false)} />}
  </>
  if (!actions.length) return <>
    <Button variant="secondary" className="bg-fill hover:bg-fill-hover window-action" title={t("Save a command you run often, like a dev server or tests")} onClick={() => setEditing('new')}><Plus size={14} /><span>{t("Add action")}</span></Button>
    {dialog}
  </>
  const main = actions.find((action) => action.id === lastId) ?? actions[0]!
  return <>
    <SplitButton
      icon={<Play size={13} />} label={main.name} title={`${main.command}${main.keys ? ` (${formatKeys(main.keys)})` : ''}`} onClick={() => run(main)} menuLabel={t("Project actions")}
      items={[
        ...actions.map((action): MenuEntry => ({ key: action.id, label: <><SquareTerminal size={14} /><span className="menu-label [.chat-switch-menu_&]:flex-1 [.chat-switch-menu_&]:max-w-[none] [.chat-switch-menu_&]:leading-[18px] [.chat-switch-menu_&]:font-medium [.chat-switch-menu_&]:min-w-0 [.dropdown-menu_&]:min-w-0 [.dropdown-menu_&]:max-w-[none] [.dropdown-menu_&]:whitespace-nowrap [.project-switch-menu_&]:max-w-[none] [.project-switch-menu_&]:leading-[18px] [.project-switch-menu_&]:font-medium [.project-switch-menu_&]:min-w-0 [.project-switch-menu_&_.block]:max-w-[none] [.project-switch-menu_&_.block]:overflow-hidden [.project-switch-menu_&_.block]:text-ellipsis [.project-switch-menu_&_.block]:whitespace-nowrap [.project-switch-menu_&_.block]:m-[2px_0_0] [.project-switch-menu_&_.block]:text-caption [.project-switch-menu_&_.block]:leading-[16px] [.project-switch-menu_&_.block]:font-normal [.project-switch-menu_&_.block]:text-muted-foreground [.chat-switch-menu_&_.block]:overflow-hidden [.chat-switch-menu_&_.block]:text-ellipsis [.chat-switch-menu_&_.block]:whitespace-nowrap [.chat-switch-menu_&_.block]:m-[2px_0_0] [.chat-switch-menu_&_.block]:text-caption [.chat-switch-menu_&_.block]:leading-[16px] [.chat-switch-menu_&_.block]:font-normal [.chat-switch-menu_&_.block]:text-muted-foreground max-w-[220px] overflow-hidden text-ellipsis grow flex-1 min-w-0 text-left">{action.name}</span>{action.keys && <Kbd>{formatKeys(action.keys)}</Kbd>}</>, title: action.command, onSelect: () => run(action) })),
        { key: 'separator', separator: true },
        { key: 'add', label: <><Plus size={14} />{t("Add action…")}</>, onSelect: () => setEditing('new') },
        ...(actions.length > 1 ? [{ key: 'arrange', label: <><GripVertical size={14} />{t("Rearrange actions…")}</>, onSelect: () => setArranging(true) } as MenuEntry] : []),
        { key: 'edit', label: <><Pencil size={14} />{t("Edit action")}</>, submenu: actions.map((action) => ({ key: `edit:${action.id}`, label: action.name, onSelect: () => setEditing(action) })) },
      ]}
    />
    {dialog}
  </>
}

const ACTION_DIALOG_CLASS = "dialog [&_h3]:m-[0_0_8px] [&_h3]:text-heading [&_h3]:font-semibold [&_h3]:tracking-[-0.01em] [&:has(.model-settings)]:w-[min(640px,_calc(100vw_-_40px))] [&:has(.model-settings)]:max-h-[calc(100vh_-_40px)] [&:has(.model-settings)]:flex [&:has(.model-settings)]:flex-col [&:has(.model-settings)_>_.dialog-body]:overflow-auto [&:has(.model-settings)_>_.dialog-body]:min-h-0 [&:has(.model-settings)_>_h3]:flex-none [&:has(.model-settings)_>_.dialog-actions]:flex-none [&:has(.undo-preview)]:w-[min(1000px,_calc(100vw_-_48px))] [&:has(.undo-preview)]:max-w-[none] [&:has(.undo-preview)]:max-h-[calc(100vh_-_48px)] [&:has(.undo-preview)]:flex [&:has(.undo-preview)]:flex-col [&:has(.undo-preview)_.dialog-body]:min-h-0 [&:has(.undo-preview)_.dialog-body]:overflow-auto [[data-slot='dialog-content']&]:block [[data-slot='dialog-content']&]:max-w-[none] [[data-slot='dialog-content']&]:max-h-[calc(100vh_-_48px)] [[data-slot='dialog-content']&]:overflow-y-auto [background:var(--float-bg)] [-webkit-backdrop-filter:var(--float-blur)] [backdrop-filter:var(--float-blur)] [border:1px_solid_var(--edge)] [box-shadow:0_18px_48px_rgba(0,_0,_0,_0.45),_0_2px_8px_rgba(0,_0,_0,_0.25),_inset_0_1px_0_rgba(255,_255,_255,_0.07)] [&:has(.workspace-sync)]:w-[min(680px,_calc(100vw_-_48px))] w-[min(440px,_calc(100vw_-_48px))] bg-card [border:1px_solid_var(--edge)] rounded-(--radius-l) p-[18px_20px_16px] [box-shadow:0_24px_64px_rgba(0,_0,_0,_0.55)] [animation:pop_0.14s_var(--ease)] action-dialog"

/** Turns a key press into Ramu's binding format; plain keys need a modifier so typing never triggers an action. */
function keysFromEvent(event: React.KeyboardEvent): string | null {
  if (['Meta', 'Control', 'Shift', 'Alt'].includes(event.key)) return null
  const mod = /Mac/.test(navigator.userAgent) ? event.metaKey : event.ctrlKey
  if (!mod && !event.altKey) return null
  const key = event.code.startsWith('Key') ? event.code.slice(3).toLowerCase() : event.code.startsWith('Digit') ? event.code.slice(5) : null
  if (!key) return null
  return [mod && 'mod', event.altKey && 'alt', event.shiftKey && 'shift', key].filter(Boolean).join('+')
}

function ActionDialog({ projectId, actions, action, onClose }: { projectId: string; actions: ProjectAction[]; action: ProjectAction | null; onClose: () => void }) {
  useLanguage()
  const [name, setName] = useState(action?.name ?? '')
  const [command, setCommand] = useState(action?.command ?? '')
  const [keys, setKeys] = useState(action?.keys ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const save = async (next: ProjectAction[]) => {
    setBusy(true); setError(null)
    try {
      await invoke('projects.setActions', projectId, next)
      window.dispatchEvent(new Event(PROJECT_ACTIONS_EVENT))
      onClose()
    } catch (reason) { setError(errorText(reason)) } finally { setBusy(false) }
  }
  const submit = () => {
    if (!name.trim() || !command.trim()) return
    const entry: ProjectAction = { id: action?.id ?? crypto.randomUUID(), name: name.trim(), command: command.trim(), ...(keys ? { keys } : {}) }
    void save(action ? actions.map((current) => (current.id === action.id ? entry : current)) : [...actions, entry])
  }
  return <ShadcnDialog open disablePointerDismissal={busy} onOpenChange={(open) => { if (!open && !busy) onClose() }}>
    <DialogContent className={ACTION_DIALOG_CLASS} showCloseButton={false} aria-describedby={undefined}>
      <DialogTitle>{action ? t("Edit action") : t("Add action")}</DialogTitle>
      <form className="dialog-body [&_p]:m-[0_0_8px] text-soft text-[length:var(--ui-font-size)] action-form [&_label]:flex [&_label]:flex-col [&_label]:gap-1.5 [&_label]:text-caption [&_label]:text-soft [&_textarea.mono]:font-mono [&_textarea.mono]:text-caption [&_.action-keys]:flex [&_.action-keys]:items-center [&_.action-keys]:gap-1.5 [&_.action-keys_input]:flex-1 [&_.action-keys_input]:[caret-color:transparent] [&_>_p]:m-0 [&_.dialog-actions]:items-center flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); submit() }}>
        <Field><FieldLabel htmlFor="action-name">{t("Name")}</FieldLabel><Input id="action-name" autoFocus maxLength={60} value={name} placeholder={t("Dev server")} onChange={(event) => setName(event.target.value)} /></Field>
        <Field><FieldLabel htmlFor="action-command">{t("Command")}</FieldLabel><Textarea id="action-command" className="mono" rows={3} maxLength={4000} value={command} placeholder="pnpm dev" onChange={(event) => setCommand(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); submit() } }} /><FieldDescription>{t("Runs in a new terminal at the chat's workspace.")}</FieldDescription></Field>
        <Field><FieldLabel htmlFor="action-keys">{t("Shortcut")}</FieldLabel><span className="action-keys">
          <Input id="action-keys" readOnly value={keys ? formatKeys(keys) : ''} placeholder={t("Press a shortcut, e.g. {0}", { "0": formatKeys('mod+shift+r') })} onKeyDown={(event) => {
            if (event.key === 'Tab' || event.key === 'Escape') return
            event.preventDefault()
            if (event.key === 'Backspace' || event.key === 'Delete') return setKeys('')
            const next = keysFromEvent(event)
            if (next) setKeys(next)
          }} />
          {keys && <Button variant="ghost" size="sm" type="button" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover small text-caption" onClick={() => setKeys('')}>{t("Clear")}</Button>}
        </span></Field>
        {error && <div className="error text-bad small text-caption" role="alert">{error}</div>}
        <div className="dialog-actions [&_button]:p-[5px_14px] flex justify-end gap-2 mt-3.5">
          {action && <Button variant="ghost" type="button" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover danger-text" disabled={busy} onClick={() => void save(actions.filter((current) => current.id !== action.id))}>{t("Delete")}</Button>}
          <span className="grow flex-1 min-w-0 text-left" />
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>{t("Cancel")}</Button>
          <Button variant="default" type="submit" className="primary bg-primary text-primary-foreground border-transparent font-semibold justify-center hover:bg-primary-hover disabled:bg-raised disabled:text-muted-foreground disabled:opacity-100" disabled={busy || !name.trim() || !command.trim()}>{t("Save")}</Button>
        </div>
      </form>
    </DialogContent>
  </ShadcnDialog>
}

/** Drag rows, or use the arrows, to set the order actions appear in the menu; the first is the default button until one is run. */
function ArrangeDialog({ projectId, actions, onClose }: { projectId: string; actions: ProjectAction[]; onClose: () => void }) {
  useLanguage()
  const [order, setOrder] = useState(actions)
  const [dragging, setDragging] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= order.length) return
    const next = [...order]
    next.splice(to, 0, next.splice(from, 1)[0]!)
    setOrder(next)
  }
  const changed = order.some((action, index) => action.id !== actions[index]?.id)
  const save = async () => {
    setBusy(true); setError(null)
    try {
      await invoke('projects.setActions', projectId, order)
      window.dispatchEvent(new Event(PROJECT_ACTIONS_EVENT))
      onClose()
    } catch (reason) { setError(errorText(reason)) } finally { setBusy(false) }
  }
  return <ShadcnDialog open disablePointerDismissal={busy} onOpenChange={(open) => { if (!open && !busy) onClose() }}>
    <DialogContent className={ACTION_DIALOG_CLASS} showCloseButton={false} aria-describedby={undefined}>
      <DialogTitle>{t("Rearrange actions")}</DialogTitle>
      <div className="flex flex-col gap-1 mt-2" role="list">
        {order.map((action, index) => <div key={action.id} role="listitem" draggable={!busy}
          className={`flex items-center gap-2 min-h-9 p-[0_6px_0_4px] rounded-(--radius-s) bg-fill text-control${dragging === index ? ' opacity-45' : ''}${over === index && dragging !== index ? ' [box-shadow:0_0_0_1px_var(--accent)]' : ''}`}
          onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', action.id); setDragging(index) }}
          onDragOver={(event) => { if (dragging === null) return; event.preventDefault(); if (over !== index) setOver(index) }}
          onDrop={(event) => { event.preventDefault(); if (dragging !== null) move(dragging, index); setDragging(null); setOver(null) }}
          onDragEnd={() => { setDragging(null); setOver(null) }}>
          <GripVertical size={14} className="flex-none text-muted-foreground cursor-grab" aria-hidden="true" />
          <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-left" title={action.command}>{action.name}</span>
          {action.keys && <Kbd>{formatKeys(action.keys)}</Kbd>}
          <Button variant="ghost" size="icon-xs" type="button" className="flex-none" aria-label={t("Move {0} up", { "0": action.name })} disabled={busy || index === 0} onClick={() => move(index, index - 1)}><ArrowUp size={14} /></Button>
          <Button variant="ghost" size="icon-xs" type="button" className="flex-none" aria-label={t("Move {0} down", { "0": action.name })} disabled={busy || index === order.length - 1} onClick={() => move(index, index + 1)}><ArrowDown size={14} /></Button>
        </div>)}
      </div>
      {error && <div className="error text-bad small text-caption mt-2" role="alert">{error}</div>}
      <div className="dialog-actions flex justify-end gap-2 mt-3.5">
        <Button type="button" variant="outline" disabled={busy} onClick={onClose}>{t("Cancel")}</Button>
        <Button variant="default" type="button" className="primary bg-primary text-primary-foreground border-transparent font-semibold justify-center hover:bg-primary-hover disabled:bg-raised disabled:text-muted-foreground disabled:opacity-100" disabled={busy || !changed} onClick={() => void save()}>{t("Save")}</Button>
      </div>
    </DialogContent>
  </ShadcnDialog>
}
