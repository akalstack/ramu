import { t, useLanguage } from '../i18n'
import { providerName, type ProviderStatus } from '@ramu/shared/providers/providers'
import { ProviderIcon } from '../models/ProviderIcon'
import { AppToaster, notify, type AppToastData } from '@/components/app-toaster'
import { MessageCircleQuestion } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useAppSettings } from '../settings/AppSettings'
import { ramu, invokerFor } from '../ipc'
import { useHostRuntime, useWorkspace } from '../workspace/workspace'
import { useHostSelection } from '../workspace/HostSelection'
import { useHost } from '../workspace/HostProvider'
import { TOAST_MS, notices } from './notificationCenter'
import type { InboxNotice } from '@ramu/shared/chat/notices'

type Notification = { id: string; message: string; source: string }

const pending: Omit<Notification, 'id'>[] = []
let listening = false
export function notifyError(message: string, source = 'Ramu') {
  if (!listening) {
    pending.push({ message, source })
    return
  }
  window.dispatchEvent(new CustomEvent('ramu:notification', { detail: { message, source } }))
}

/** Errors stay available until dismissed, without interrupting the workspace. */
export function Notifications() {
  useLanguage()
  const ws = useWorkspace()
  const { select } = useHostSelection()
  // Inbox notices are the host's on screen; provider updates are this window's own host's (settings live there).
  const { id: hostId, invoke } = useHost()
  const { on } = useHostRuntime()
  const { preferences } = useAppSettings()
  const dismissedUpdates = useRef(new Set<string>())
  useEffect(() => {
    if (!preferences.providerUpdateChecks) return
    let active = true,
      receivedPush = false
    // Only the close button reports a user dismissal; hiding an update that no longer applies is not remembered.
    const updateIds = new Set<string>()
    const hide = (id: string) => {
      notify.close(id)
      notices.remove(id)
    }
    const accept = (statuses: ProviderStatus[]) => {
      if (!active) return
      const currentIds = new Set(statuses.map((status) => `provider-update:${status.provider}`))
      for (const id of updateIds)
        if (!currentIds.has(id)) {
          hide(id)
          updateIds.delete(id)
        }
      for (const status of statuses) {
        const key = `${status.provider}:${status.binary}:${status.latestVersion}`
        if (dismissedUpdates.current.has(key)) continue
        const id = `provider-update:${status.provider}`
        updateIds.add(id)
        const title = `${providerName(status.provider)}${t(' update available')}`,
          description = `${status.version} → ${status.latestVersion}`
        const icon = <ProviderIcon provider={status.provider} size={18} />
        const view = () => {
          window.dispatchEvent(new CustomEvent('ramu:settings', { detail: { section: 'providers' } }))
          dismissProvider(status)
          hide(id)
        }
        // The toast leaves by itself; the update waits in the activity popover until it is viewed or dismissed.
        notify.add<AppToastData>({
          id,
          timeout: TOAST_MS.update,
          title,
          description,
          data: {
            icon,
            onDismiss: () => {
              dismissProvider(status)
              notices.remove(id)
            },
          },
          actionProps: { children: t('View update'), onClick: view },
        })
        notices.add({ id, title, description, type: 'info', icon, actionLabel: t('View update'), onAction: view })
      }
    }
    const off = ramu.on('providers:updates', (statuses) => {
      receivedPush = true
      accept(statuses)
    })
    void ramu
      .invoke('providers.updates')
      .then((statuses) => {
        if (!receivedPush) accept(statuses)
      })
      .catch(() => {})
    return () => {
      active = false
      off()
      for (const id of updateIds) hide(id)
    }
  }, [preferences.providerUpdateChecks])
  const dismissProvider = (status: ProviderStatus) => {
    dismissedUpdates.current.add(`${status.provider}:${status.binary}:${status.latestVersion}`)
    void ramu.invoke('providers.dismissUpdate', status.provider, status.binary, status.latestVersion!).catch(() => {})
  }
  const watching = useRef<(taskId: string, sessionId: string) => boolean>(() => false)
  watching.current = (taskId, sessionId) => {
    if (ws.ui.activeTaskId !== taskId || ws.composing || ws.ui.sidebar === 'schedules' || ws.ui.sidebar === 'inbox')
      return false
    const state = ws.taskUi[taskId]
    const active = state?.views.find((view) => view.id === state.activeViewId)
    if (active?.kind === 'agent') return active.sessionId === sessionId
    const focused =
      state?.views.find((view) => view.id === state.activeAgentViewId) ??
      state?.views.filter((view) => view.kind === 'agent').at(-1)
    return focused?.kind === 'agent' && focused.sessionId === sessionId
  }
  const openChat = (taskId: string, sessionId: string) => {
    ws.openTask(taskId)
    ws.openView(taskId, { kind: 'agent', sessionId })
  }
  // The computer keeps the notices, so a chat opened on the phone clears here too and the other way round.
  const dismissHost = (id: string) => {
    notices.remove(id)
    void invoke('notices.dismiss', id).catch(() => {})
  }
  const inbox = useRef<InboxNotice[]>([])
  const publishInbox = (list: InboxNotice[]) => {
    inbox.current = list
    notices.setHost(
      list.map((entry): import('./notificationCenter').CenterNotice => {
        const open = () => {
          openChat(entry.taskId, entry.sessionId)
          notify.close(entry.id)
          dismissHost(entry.id)
        }
        return {
          id: entry.id,
          title: entry.title,
          description: entry.body,
          type: entry.kind === 'failed' ? 'error' : entry.kind === 'done' ? 'success' : 'info',
          icon: entry.kind === 'input' ? <MessageCircleQuestion size={16} /> : undefined,
          at: entry.at,
          actionLabel: t('Open thread'),
          onAction: open,
          onDismiss: () => dismissHost(entry.id),
          taskId: entry.taskId,
          sessionId: entry.sessionId,
        }
      }),
    )
  }
  const openChatRef = useRef(openChat)
  openChatRef.current = openChat
  useEffect(() => {
    let live = true
    const take = (list: InboxNotice[]) => {
      if (live) publishInbox(list)
    }
    const off = on('notices:changed', take)
    const load = () => void invoke('notices.list').then(take, () => {})
    load()
    const reconnect = on('background:connection', ({ connected }) => {
      if (connected) load()
    })
    return () => {
      live = false
      off()
      reconnect()
      notices.setHost([])
    }
  }, [invoke, on])
  // A notice about a chat that is on screen is stale.
  useEffect(() => {
    for (const entry of inbox.current)
      if (watching.current(entry.taskId, entry.sessionId)) {
        notify.close(entry.id)
        dismissHost(entry.id)
      }
  }, [ws.ui.activeTaskId, ws.taskUi, ws.composing, ws.ui.sidebar, notices.list()])
  useEffect(() => {
    const offToast = ramu.on('notify:inapp', (notice) => {
      // No toast for the chat you are already looking at.
      const sameHost = !notice.hostId || notice.hostId === hostId
      const id = sameHost ? `agent:${notice.sessionId}` : `agent:${notice.hostId}:${notice.sessionId}`
      const dismiss = () => {
        if (sameHost) dismissHost(`agent:${notice.sessionId}`)
        else void invokerFor(notice.hostId!)('notices.dismiss', `agent:${notice.sessionId}`).catch(() => {})
      }
      if (sameHost && watching.current(notice.taskId, notice.sessionId)) {
        dismiss()
        return
      }
      const type = notice.kind === 'failed' ? 'error' : notice.kind === 'done' ? 'success' : 'info'
      const icon = notice.kind === 'input' ? <MessageCircleQuestion size={16} /> : undefined
      const open = () => {
        if (notice.hostId) select(notice.hostId, { kind: 'task', taskId: notice.taskId, sessionId: notice.sessionId })
        else openChat(notice.taskId, notice.sessionId)
        notify.close(id)
        dismiss()
      }
      notify.add<AppToastData>({
        id,
        title: notice.title,
        description: notice.body,
        timeout:
          notice.kind === 'input'
            ? TOAST_MS.input
            : notice.kind === 'failed'
              ? TOAST_MS.error
              : TOAST_MS[type === 'success' ? 'success' : 'info'],
        type,
        priority: notice.kind === 'done' ? 'low' : 'high',
        data: { icon, onDismiss: () => dismiss() },
        actionProps: { children: t('Open thread'), onClick: open },
      })
    })
    const offOpen = ramu.on('notify:open', ({ taskId, sessionId }) => openChat(taskId, sessionId))
    return () => {
      offToast()
      offOpen()
    }
  }, [ws])
  useEffect(() => {
    const receive = (event: Event) => {
      const { message, source } = (event as CustomEvent<Omit<Notification, 'id'>>).detail
      const id = `error:${source}:${message}`
      notify.add<AppToastData>({
        id,
        title: message,
        description: source,
        type: 'error',
        timeout: TOAST_MS.error,
        priority: 'high',
        data: { onDismiss: () => notices.remove(id) },
      })
      notices.add({ id, title: message, description: source, type: 'error' })
    }
    window.addEventListener('ramu:notification', receive)
    listening = true
    for (const detail of pending.splice(0)) receive(new CustomEvent('ramu:notification', { detail }))
    return () => {
      listening = false
      window.removeEventListener('ramu:notification', receive)
    }
  }, [])
  return <AppToaster label={t('Notifications')} closeLabel={t('Dismiss notification')} />
}
