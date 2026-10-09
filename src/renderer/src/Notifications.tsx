import { providerName, type ProviderStatus } from '../../shared/providers'
import { ProviderIcon } from './ProviderIcon'
import { Button } from '@/components/ui/button'
import { CircleAlert, CircleCheck, MessageCircleQuestion, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useAppSettings } from './AppSettings'
import { ramu } from './ipc'
import { useWorkspace } from './workspace'

type Notification = { id: string; message: string; source: string }
type AgentToast = { id: string; sessionId: string; taskId: string; kind: 'done' | 'input' | 'failed'; title: string; body: string }

const pending: Omit<Notification, 'id'>[] = []
let listening = false
export function notifyError(message: string, source = 'Ramu') {
  if (!listening) { pending.push({ message, source }); return }
  window.dispatchEvent(new CustomEvent('ramu:notification', { detail: { message, source } }))
}

/** Errors stay available until dismissed, without interrupting the workspace. */
export function Notifications() {
  const ws = useWorkspace()
  const { preferences } = useAppSettings()
  const [providerUpdates, setProviderUpdates] = useState<ProviderStatus[]>([])
  const dismissedUpdates = useRef(new Set<string>())
  useEffect(() => {
    if (!preferences.providerUpdateChecks) { setProviderUpdates([]); return }
    let active = true, receivedPush = false
    const accept = (statuses: ProviderStatus[]) => { if (active) setProviderUpdates(statuses.filter((status) => !dismissedUpdates.current.has(`${status.provider}:${status.binary}:${status.latestVersion}`))) }
    const off = ramu.on('providers:updates', (statuses) => { receivedPush = true; accept(statuses) })
    void ramu.invoke('providers.updates').then((statuses) => { if (!receivedPush) accept(statuses) }).catch(() => {})
    return () => { active = false; off() }
  }, [preferences.providerUpdateChecks])
  const dismissProvider = (status: ProviderStatus) => {
    dismissedUpdates.current.add(`${status.provider}:${status.binary}:${status.latestVersion}`)
    setProviderUpdates((current) => current.filter((entry) => entry.provider !== status.provider))
    void ramu.invoke('providers.dismissUpdate', status.provider, status.binary, status.latestVersion!).catch(() => {})
  }
  const [items, setItems] = useState<Notification[]>([])
  const [toasts, setToasts] = useState<AgentToast[]>([])
  const watching = useRef<(taskId: string, sessionId: string) => boolean>(() => false)
  watching.current = (taskId, sessionId) => {
    if (ws.ui.activeTaskId !== taskId || ws.composing) return false
    const state = ws.taskUi[taskId]
    const active = state?.views.find((view) => view.id === state.activeViewId)
    if (active?.kind === 'agent') return active.sessionId === sessionId
    const dockHidden = state?.dockHidden ?? !preferences.defaultChatDockOpen
    return !dockHidden && !!state?.views.some((view) => view.kind === 'agent' && view.sessionId === sessionId)
  }
  const openChat = (taskId: string, sessionId: string) => { ws.openTask(taskId); ws.openView(taskId, { kind: 'agent', sessionId }) }
  useEffect(() => {
    const dismiss = (id: string) => setToasts((current) => current.filter((toast) => toast.id !== id))
    const offToast = ramu.on('notify:inapp', (notice) => {
      // No toast for the chat you are already looking at.
      if (watching.current(notice.taskId, notice.sessionId)) return
      const toast = { ...notice, id: crypto.randomUUID() }
      setToasts((current) => [...current.filter((entry) => entry.sessionId !== notice.sessionId), toast])
      setTimeout(() => dismiss(toast.id), 8000)
    })
    const offOpen = ramu.on('notify:open', ({ taskId, sessionId }) => openChat(taskId, sessionId))
    return () => { offToast(); offOpen() }
  }, [ws])
  useEffect(() => {
    const receive = (event: Event) => {
      const { message, source } = (event as CustomEvent<Omit<Notification, 'id'>>).detail
      setItems((current) => current.some((item) => item.message === message && item.source === source)
        ? current : [...current, { id: crypto.randomUUID(), message, source }])
    }
    window.addEventListener('ramu:notification', receive)
    listening = true
    for (const detail of pending.splice(0)) receive(new CustomEvent('ramu:notification', { detail }))
    return () => { listening = false; window.removeEventListener('ramu:notification', receive) }
  }, [])
  return <div className="notifications" aria-label="Notifications">{providerUpdates.map((status) => <div key={status.provider} className="notification-error notification-agent" role="status"><ProviderIcon provider={status.provider} size={18} /><div className="notification-content"><p>{providerName(status.provider)} update available</p><span className="muted small">{status.version} → {status.latestVersion}</span></div><Button className="small" onClick={() => { window.dispatchEvent(new CustomEvent('ramu:settings', { detail: { section: 'providers' } })); dismissProvider(status) }}>View update</Button><Button className="ghost icon small-icon" aria-label={`Dismiss ${providerName(status.provider)} update`} onClick={() => dismissProvider(status)}><X size={14} /></Button></div>)}{toasts.map((toast) => <div key={toast.id} className={`notification-error notification-agent ${toast.kind}`} role="status">
    {toast.kind === 'input' ? <MessageCircleQuestion size={18} className="notification-icon" /> : toast.kind === 'failed' ? <CircleAlert size={18} className="notification-icon" /> : <CircleCheck size={18} className="notification-icon ok" />}
    <div className="notification-content"><p>{toast.title}</p><span className="muted small">{toast.body}</span></div>
    <Button className="small" onClick={() => { openChat(toast.taskId, toast.sessionId); setToasts((current) => current.filter((entry) => entry.id !== toast.id)) }}>Open chat</Button>
    <Button className="ghost icon small-icon" aria-label="Dismiss notification" title="Dismiss" onClick={() => setToasts((current) => current.filter((entry) => entry.id !== toast.id))}><X size={14} /></Button>
  </div>)}{items.map((item) => <div key={item.id} className="notification-error" role="alert">
    <CircleAlert size={18} className="notification-icon" />
    <div className="notification-content"><p>{item.message}</p><span className="muted small">{item.source}</span></div>
    <Button className="ghost icon small-icon" aria-label="Dismiss notification" title="Dismiss" onClick={() => setItems((current) => current.filter((entry) => entry.id !== item.id))}><X size={14} /></Button>
  </div>)}</div>
}
