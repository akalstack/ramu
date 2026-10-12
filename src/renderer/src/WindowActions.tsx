import { t, useLanguage } from './i18n'
import { Dialog as ShadcnDialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ChevronDown, Pencil, Play, Plus, SquareTerminal } from 'lucide-react'
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
  return <div className="window-actions">
    {projectId && <ActionsControl ctx={ctx} projectId={projectId} />}
  </div>
}

/** One button with a separate menu trigger; both halves share a single filled shape. */
function SplitButton({ icon, label, title, onClick, disabled, menuLabel, items, primary }: { icon: ReactNode; label: string; title?: string; onClick: () => void; disabled?: boolean; menuLabel: string; items: MenuEntry[]; primary?: boolean }) {
  return <div className={`split-button${primary ? ' primary' : ''}`}>
    <Button className="split-main" title={title} disabled={disabled} onClick={onClick}>{icon}<span>{label}</span></Button>
    <Menu label={menuLabel} icon={<ChevronDown size={13} />} className="split-menu" align="end" items={items} />
  </div>
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
  const [lastId, setLastId] = useState<string | null>(() => localStorage.getItem(`ramu.last-action:${projectId}`))
  const run = (action: ProjectAction) => {
    setLastId(action.id)
    try { localStorage.setItem(`ramu.last-action:${projectId}`, action.id) } catch { /* Remembered for this session only. */ }
    runProjectAction(ws, ctx, action)
  }
  const dialog = editing && <ActionDialog projectId={projectId} actions={actions} action={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
  if (!actions.length) return <>
    <Button className="window-action" title={t("Save a command you run often, like a dev server or tests")} onClick={() => setEditing('new')}><Plus size={14} /><span>{t("Add action")}</span></Button>
    {dialog}
  </>
  const main = actions.find((action) => action.id === lastId) ?? actions[0]!
  return <>
    <SplitButton
      icon={<Play size={13} />} label={main.name} title={`${main.command}${main.keys ? ` (${formatKeys(main.keys)})` : ''}`} onClick={() => run(main)} menuLabel={t("Project actions")}
      items={[
        ...actions.map((action): MenuEntry => ({ key: action.id, label: <><SquareTerminal size={14} /><span className="menu-label grow">{action.name}</span>{action.keys && <kbd>{formatKeys(action.keys)}</kbd>}</>, title: action.command, onSelect: () => run(action) })),
        { key: 'separator', separator: true },
        { key: 'add', label: <><Plus size={14} />{t("Add action…")}</>, onSelect: () => setEditing('new') },
        { key: 'edit', label: <><Pencil size={14} />{t("Edit action")}</>, submenu: actions.map((action) => ({ key: `edit:${action.id}`, label: action.name, onSelect: () => setEditing(action) })) },
      ]}
    />
    {dialog}
  </>
}

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
    <DialogContent className="dialog action-dialog" showCloseButton={false} aria-describedby={undefined}>
      <DialogTitle>{action ? t("Edit action") : t("Add action")}</DialogTitle>
      <form className="dialog-body action-form" onSubmit={(event) => { event.preventDefault(); submit() }}>
        <label>{t("Name")}<Input autoFocus value={name} placeholder={t("Dev server")} onChange={(event) => setName(event.target.value)} /></label>
        <label>{t("Command")}<Textarea className="mono" rows={3} value={command} placeholder="pnpm dev" onChange={(event) => setCommand(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); submit() } }} /></label>
        <label>{t("Shortcut")}<span className="action-keys">
          <Input readOnly value={keys ? formatKeys(keys) : ''} placeholder={t("Press a shortcut, e.g. {0}", { "0": formatKeys('mod+shift+r') })} onKeyDown={(event) => {
            if (event.key === 'Tab' || event.key === 'Escape') return
            event.preventDefault()
            if (event.key === 'Backspace' || event.key === 'Delete') return setKeys('')
            const next = keysFromEvent(event)
            if (next) setKeys(next)
          }} />
          {keys && <Button type="button" className="ghost small" onClick={() => setKeys('')}>{t("Clear")}</Button>}
        </span></label>
        <p className="muted small">{t("Runs in a new terminal at the chat's workspace.")}</p>
        {error && <div className="error small" role="alert">{error}</div>}
        <div className="dialog-actions">
          {action && <Button type="button" className="ghost danger-text" disabled={busy} onClick={() => void save(actions.filter((current) => current.id !== action.id))}>{t("Delete")}</Button>}
          <span className="grow" />
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>{t("Cancel")}</Button>
          <Button type="submit" className="primary" disabled={busy || !name.trim() || !command.trim()}>{t("Save")}</Button>
        </div>
      </form>
    </DialogContent>
  </ShadcnDialog>
}
