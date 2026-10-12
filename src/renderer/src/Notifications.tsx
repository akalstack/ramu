import { t, useLanguage } from './i18n'
import { providerName, type ProviderStatus } from '../../shared/providers'
import { ProviderIcon } from './ProviderIcon'
import { AppToaster, notify, type AppToastData } from '@/components/app-toaster'
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
    // Only the close button reports a user dismissal; hiding an update that no longer applies is not remembered.
    const updateIds = new Set<string>()
    const hide = (id: string) => notify.close(id)
    const accept = (statuses: ProviderStatus[]) => {
      if (!active) return
      const currentIds = new Set(statuses.map((status) => `provider-update:${status.provider}`))
      for (const id of updateIds) if (!currentIds.has(id)) { hide(id); updateIds.delete(id) }
      for (const status of statuses) {
        const key = `${status.provider}:${status.binary}:${status.latestVersion}`
        if (dismissedUpdates.current.has(key)) continue
        const id = `provider-update:${status.provider}`
        updateIds.add(id)
        notify.add<AppToastData>({
          id, timeout: 0, title: `${providerName(status.provider)}${t(" update available")}`,
          description: `${status.version} → ${status.latestVersion}`,
          data: { icon: <ProviderIcon provider={status.provider} size={18} />, onDismiss: () => dismissProvider(status) },
          actionProps: { children: t("View update"), onClick: () => {
            window.dispatchEvent(new CustomEvent('ramu:settings', { detail: { section: 'providers' } }))
            dismissProvider(status)
            notify.close(id)
          } },
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
      const id = `agent:${notice.sessionId}`
      notify.add<AppToastData>({
        id, title: notice.title, description: notice.body, timeout: 8000,
        type: notice.kind === 'failed' ? 'error' : notice.kind === 'done' ? 'success' : 'info',
        priority: notice.kind === 'done' ? 'low' : 'high',
        data: notice.kind === 'input' ? { icon: <MessageCircleQuestion size={16} /> } : undefined,
        actionProps: { children: t("Open chat"), onClick: () => { openChat(notice.taskId, notice.sessionId); notify.close(id) } },
      })
    })
    const offOpen = ramu.on('notify:open', ({ taskId, sessionId }) => openChat(taskId, sessionId))
    return () => { offToast(); offOpen() }
  }, [ws])
  useEffect(() => {
    const receive = (event: Event) => {
      const { message, source } = (event as CustomEvent<Omit<Notification, 'id'>>).detail
      notify.add({ id: `error:${source}:${message}`, title: message, description: source, type: 'error', timeout: 0, priority: 'high' })
    }
    window.addEventListener('ramu:notification', receive)
    listening = true
    for (const detail of pending.splice(0)) receive(new CustomEvent('ramu:notification', { detail }))
    return () => { listening = false; window.removeEventListener('ramu:notification', receive) }
  }, [])
  return <AppToaster label={t("Notifications")} closeLabel={t("Dismiss notification")} />
}
