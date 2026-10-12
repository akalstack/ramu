import { t, useLanguage } from './i18n'
import { providerName, type ProviderStatus } from '../../shared/providers'
import { ProviderIcon } from './ProviderIcon'
import { Toaster } from '@/components/ui/sonner'
import { toast } from 'sonner'
import { MessageCircleQuestion } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useAppSettings } from './AppSettings'
import { ramu } from './ipc'
import { useWorkspace } from './workspace'

type Notification = { id: string; message: string; source: string }

const pending: Omit<Notification, 'id'>[] = []
let listening = false
export function notifyError(message: string, source = 'Ramu') {
  if (!listening) { pending.push({ message, source }); return }
  window.dispatchEvent(new CustomEvent('ramu:notification', { detail: { message, source } }))
}

/** Errors stay available until dismissed, without interrupting the workspace. */
export function Notifications() {
  useLanguage()
  const ws = useWorkspace()
  const { preferences } = useAppSettings()
  const dismissedUpdates = useRef(new Set<string>())
  useEffect(() => {
    if (!preferences.providerUpdateChecks) return
    let active = true, receivedPush = false
    // sonner reports programmatic dismissals through onDismiss too; only a user dismissal is remembered.
    const updateIds = new Set<string>(), quiet = new Set<string>()
    const hide = (id: string) => { quiet.add(id); toast.dismiss(id) }
    const accept = (statuses: ProviderStatus[]) => {
      if (!active) return
      const currentIds = new Set(statuses.map((status) => `provider-update:${status.provider}`))
      for (const id of updateIds) if (!currentIds.has(id)) { hide(id); updateIds.delete(id) }
      for (const status of statuses) {
        const key = `${status.provider}:${status.binary}:${status.latestVersion}`
        if (dismissedUpdates.current.has(key)) continue
        const id = `provider-update:${status.provider}`
        updateIds.add(id); quiet.delete(id)
        toast(`${providerName(status.provider)}${t(" update available")}`, {
          id, duration: Infinity, icon: <ProviderIcon provider={status.provider} size={18} />,
          description: `${status.version} → ${status.latestVersion}`,
          action: { label: t("View update"), onClick: () => {
            window.dispatchEvent(new CustomEvent('ramu:settings', { detail: { section: 'providers' } }))
            dismissProvider(status)
          } },
          onDismiss: () => { if (!quiet.delete(id)) dismissProvider(status) },
        })
      }
    }
    const off = ramu.on('providers:updates', (statuses) => { receivedPush = true; accept(statuses) })
    void ramu.invoke('providers.updates').then((statuses) => { if (!receivedPush) accept(statuses) }).catch(() => {})
    return () => { active = false; off(); for (const id of updateIds) hide(id) }
  }, [preferences.providerUpdateChecks])
  const dismissProvider = (status: ProviderStatus) => {
    dismissedUpdates.current.add(`${status.provider}:${status.binary}:${status.latestVersion}`)
    void ramu.invoke('providers.dismissUpdate', status.provider, status.binary, status.latestVersion!).catch(() => {})
  }
  const watching = useRef<(taskId: string, sessionId: string) => boolean>(() => false)
  watching.current = (taskId, sessionId) => {
    if (ws.ui.activeTaskId !== taskId || ws.composing || ws.ui.sidebar === 'schedules') return false
    const state = ws.taskUi[taskId]
    const active = state?.views.find((view) => view.id === state.activeViewId)
    if (active?.kind === 'agent') return active.sessionId === sessionId
    const focused = state?.views.find((view) => view.id === state.activeAgentViewId) ?? state?.views.filter((view) => view.kind === 'agent').at(-1)
    return focused?.kind === 'agent' && focused.sessionId === sessionId
  }
  const openChat = (taskId: string, sessionId: string) => { ws.openTask(taskId); ws.openView(taskId, { kind: 'agent', sessionId }) }
  useEffect(() => {
    const offToast = ramu.on('notify:inapp', (notice) => {
      // No toast for the chat you are already looking at.
      if (watching.current(notice.taskId, notice.sessionId)) return
      const show = notice.kind === 'failed' ? toast.error : notice.kind === 'done' ? toast.success : toast.info
      show(notice.title, {
        id: `agent:${notice.sessionId}`, description: notice.body, duration: 8000,
        ...(notice.kind === 'input' ? { icon: <MessageCircleQuestion size={16} /> } : {}),
        action: { label: t("Open chat"), onClick: () => openChat(notice.taskId, notice.sessionId) },
      })
    })
    const offOpen = ramu.on('notify:open', ({ taskId, sessionId }) => openChat(taskId, sessionId))
    return () => { offToast(); offOpen() }
  }, [ws])
  useEffect(() => {
    const receive = (event: Event) => {
      const { message, source } = (event as CustomEvent<Omit<Notification, 'id'>>).detail
      toast.error(message, {
        id: `error:${source}:${message}`, description: source, duration: Infinity,
      })
    }
    window.addEventListener('ramu:notification', receive)
    listening = true
    for (const detail of pending.splice(0)) receive(new CustomEvent('ramu:notification', { detail }))
    return () => { listening = false; window.removeEventListener('ramu:notification', receive) }
  }, [])
  return <Toaster position="bottom-right" offset={{ bottom: 36, right: 12 }} closeButton
    containerAriaLabel={t("Notifications")} toastOptions={{ closeButtonAriaLabel: t("Dismiss notification") }} />
}
