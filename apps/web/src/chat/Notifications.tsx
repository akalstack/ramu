import { t, useLanguage } from '../i18n'
import { providerName } from '@ramu/shared/providers/providers'
import { UpdateNotices } from './UpdateNotices'
import { NewModelsDialog, showNewModels } from '../models/NewModelsDialog'
import { ProviderIcon } from '../models/ProviderIcon'
import { AppToaster, notify, type AppToastData } from '@/components/app-toaster'
import { MessageCircleQuestion } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useAppSettings } from '../settings/AppSettings'
import { errorText } from '../lib/errors'
import { ramu, invokerFor } from '../ipc'
import { useHostRuntime, useWorkspace } from '../workspace/workspace'
import { useHostSelection } from '../workspace/HostSelection'
import { useHost } from '../workspace/HostProvider'
import { TOAST_MS, notices, useStatusPanelReach } from './notificationCenter'
import type { InboxNotice } from '@ramu/shared/chat/notices'
import { isGlobalPage, type ModelNotice } from '@ramu/shared/types'

type Notification = { id: string; message: string; source: string }

const pending: Omit<Notification, 'id'>[] = []
let listening = false
export function notifyError(message: string, source = 'Ramu') {
  // A rejected call's value is untyped; an Error reaching the toast as its title would crash the whole view.
  message = errorText(message)
  source = typeof source === 'string' ? source : errorText(source)
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
  // Inbox notices are the host's on screen; updates are every connected host's (UpdateNotices).
  const { id: hostId, invoke } = useHost()
  const { on } = useHostRuntime()
  const { preferences } = useAppSettings()
  const clearBottom = useStatusPanelReach()
  // Models providers started offering: one grouped notice, told once on every device and gone everywhere once dismissed.
  useEffect(() => {
    if (!preferences.newModelNotices) return
    let active = true
    const id = 'model-news'
    let shownKey = ''
    let latest: ModelNotice[] = []
    const hide = () => {
      notify.close(id)
      notices.remove(id)
    }
    const dismiss = () => {
      hide()
      shownKey = ''
      for (const notice of latest) void invoke('models.dismissNews', notice.provider, notice.model).catch(() => {})
    }
    const open = () => {
      const list = latest
      dismiss()
      showNewModels(list)
    }
    const accept = (list: ModelNotice[]) => {
      if (!active) return
      latest = list
      const key = list.map((notice) => `${notice.provider}:${notice.model}`).join('|')
      if (key === shownKey) return
      const before = new Set(shownKey.split('|'))
      const grown = list.some((notice) => !before.has(`${notice.provider}:${notice.model}`))
      shownKey = key
      if (!list.length) return hide()
      const providers = [...new Set(list.map((notice) => notice.provider))]
      const title =
        list.length === 1 ? t('New model: {0}', { '0': list[0]!.name }) : t('{0} new models', { '0': list.length })
      const names = list.map((notice) => notice.name)
      const shown = names.length > 3 ? [...names.slice(0, 3), t('{0} more', { '0': names.length - 3 })] : names
      const description =
        list.length === 1
          ? t('{0} offers it now. It is tagged New in the model list.', { '0': providerName(list[0]!.provider) })
          : `${shown.join(', ')}. ${t('Tagged New in the model list.')}`
      const icon = providers.length === 1 ? <ProviderIcon provider={providers[0]!} size={18} /> : undefined
      const toast = {
        title,
        description,
        data: { icon, onDismiss: dismiss } satisfies AppToastData,
        actionProps: { children: t('See models'), onClick: open },
      }
      // A smaller list (one dismissed elsewhere) updates the notice quietly; more models pop it up again.
      if (grown) notify.add<AppToastData>({ id, timeout: TOAST_MS.update, ...toast })
      else notify.update(id, toast)
      notices.add({
        id,
        title,
        description,
        type: 'info',
        icon,
        actionLabel: t('See models'),
        onAction: open,
        onDismiss: dismiss,
      })
    }
    const off = on('models:news', accept)
    void invoke('models.news')
      .then(accept)
      .catch(() => {})
    return () => {
      active = false
      off()
      hide()
    }
  }, [preferences.newModelNotices, invoke, on])
  useEffect(() => {
    let active = true
    const id = 'computer-use-update'
    let shown = ''
    const hide = () => {
      notify.close(id)
      notices.remove(id)
    }
    const check = async () => {
      try {
        const status = await ramu.invoke('computer.status')
        if (!active) return
        const update = status.appUpdate
        if (!update?.updateAvailable) {
          hide()
          shown = ''
          return
        }
        if (shown === update.supportedVersion) return
        shown = update.supportedVersion
        const title = t('Open Computer Use update available')
        const description = t('Version {0} is tested with this Ramu. Stop computer use before updating.', {
          0: update.supportedVersion,
        })
        const install = () => {
          notify.update(id, {
            type: 'loading',
            title: t('Updating {0}…', { 0: 'Open Computer Use' }),
            timeout: 0,
            actionProps: undefined,
          })
          void ramu
            .invoke('computer.installApps')
            .then(() => {
              hide()
              notify.add({
                type: 'success',
                title: t('{0} updated', { 0: 'Open Computer Use' }),
                timeout: TOAST_MS.success,
              })
            })
            .catch((reason) => {
              notify.update(id, {
                type: 'error',
                title: t('Could not update {0}', { 0: 'Open Computer Use' }),
                description: errorText(reason),
                timeout: TOAST_MS.error,
                actionProps: { children: t('Update'), onClick: install },
              })
            })
        }
        notify.add({
          id,
          title,
          description,
          timeout: TOAST_MS.update,
          actionProps: { children: t('Update'), onClick: install },
        })
        notices.add({ id, title, description, type: 'info', actionLabel: t('Update'), onAction: install })
      } catch {
        /* A disconnected host has no update status to report. */
      }
    }
    void check()
    const timer = setInterval(() => void check(), 60 * 60_000)
    return () => {
      active = false
      clearInterval(timer)
      hide()
    }
  }, [])
  const watching = useRef<(taskId: string, sessionId: string) => boolean>(() => false)
  watching.current = (taskId, sessionId) => {
    if (ws.ui.activeTaskId !== taskId || ws.composing || isGlobalPage(ws.ui.sidebar)) return false
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
    // A notice read on the phone (or cleared anywhere) leaves the host's list, and its toast goes with it.
    const current = new Set(list.map((entry) => entry.id))
    for (const entry of inbox.current) if (!current.has(entry.id)) notify.close(entry.id)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [invoke, on] by design; the values it reads beyond these are current as of that run
  }, [invoke, on])
  // A notice about a chat that is on screen is stale; a usage notice is about the app, not the chat, so it stays.
  const noticeList = notices.list()
  useEffect(() => {
    for (const entry of inbox.current)
      if (entry.kind !== 'usage' && watching.current(entry.taskId, entry.sessionId)) {
        notify.close(entry.id)
        dismissHost(entry.id)
      }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [ws.ui.activeTaskId, ws.taskUi, ws.composing, ws.ui.sidebar, noticeList] by design; the values it reads beyond these are current as of that run
  }, [ws.ui.activeTaskId, ws.taskUi, ws.composing, ws.ui.sidebar, noticeList])
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [ws] by design; the values it reads beyond these are current as of that run
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
  return (
    <>
      <UpdateNotices providerChecks={preferences.providerUpdateChecks} />
      <NewModelsDialog />
      <AppToaster label={t('Notifications')} closeLabel={t('Dismiss notification')} clearBottom={clearBottom} />
    </>
  )
}
