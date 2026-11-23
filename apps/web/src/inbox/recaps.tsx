import { animateThreadListChange } from '../workspace/threadListMotion'
import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { notify } from '@/components/app-toaster'
import { TOAST_MS } from '../chat/notificationCenter'
import { t } from '../i18n'
import { ipcQueryKeyOn } from '../dataQueries'
import { useHostRuntime, useWorkspace } from '../workspace/workspace'
import { useHost } from '../workspace/HostProvider'
import { useAppSettings } from '../settings/AppSettings'
import { notifyError } from '../chat/Notifications'
import { errorText } from '../lib/errors'

const VISIT_KEY = 'ramu.last-visit'
const AWAY_MS = 5 * 60_000

/**
 * "Since your last visit" means since you last left Ramu, not since Home last mounted. The time is read once when the app
 * starts and moves forward only after the window has been hidden for a while, so recaps don't vanish on the next click of Home.
 */
let previousVisit = Number(localStorage.getItem(VISIT_KEY) ?? 0)
let hiddenAt = 0
const markVisit = () => localStorage.setItem(VISIT_KEY, String(Date.now()))
window.addEventListener('pagehide', markVisit)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    hiddenAt = Date.now()
    markVisit()
  } else if (hiddenAt && Date.now() - hiddenAt > AWAY_MS) {
    previousVisit = hiddenAt
    hiddenAt = 0
  }
})

export type RecapAction = 'done' | 'dismissed' | 'snoozed'

/** A toast that says what just happened to a recap item and offers to put it back, so a mis-click costs nothing. */
export function notifyRecapAction(action: RecapAction, undo: () => void) {
  notify.add({
    timeout: TOAST_MS.info,
    title: action === 'done' ? t('Marked done') : action === 'dismissed' ? t('Dismissed') : t('Snoozed'),
    actionProps: { children: t('Undo'), onClick: undo },
  })
}

/** Open recap items for live threads, split into those that need you and recent ones (all, and since your last visit). */
export function useRecaps() {
  const ws = useWorkspace()
  const { preferences } = useAppSettings()
  const client = useQueryClient()
  const { id: host, invoke } = useHost()
  const { on } = useHostRuntime()
  const key = ipcQueryKeyOn(host, 'recaps.get')
  const query = useQuery({ queryKey: key, queryFn: () => invoke('recaps.get'), enabled: preferences.recapsEnabled })
  useEffect(
    () =>
      on('automation:changed', () => {
        void client.invalidateQueries({ queryKey: ipcQueryKeyOn(host, 'recaps.get') })
      }),
    [client, on, host],
  )
  const recap = preferences.recapsEnabled ? (query.data ?? null) : null
  const open =
    recap?.items
      .filter(
        (i) =>
          (i.status === 'open' || (i.status === 'snoozed' && (i.snoozedUntil ?? 0) <= Date.now())) &&
          ws.tasks.some((task) => task.id === i.taskId),
      )
      .sort((a, b) => b.updatedAt - a.updatedAt) ?? []
  const recent = open.filter((i) => i.group === 'recent')
  const act = async (id: string, action: RecapAction, until?: number) => {
    try {
      await animateThreadListChange(async () => {
        await (until === undefined ? invoke('recaps.act', id, action) : invoke('recaps.act', id, action, until))
        await client.invalidateQueries({ queryKey: key })
      })
      notifyRecapAction(action, () => {
        void animateThreadListChange(async () => {
          await invoke('recaps.act', id, 'open')
          await client.invalidateQueries({ queryKey: key })
        }).catch((e) => notifyError(errorText(e), 'Recaps'))
      })
    } catch (e) {
      notifyError(errorText(e), 'Recaps')
    }
  }
  const refresh = () =>
    invoke('recaps.refresh').then(
      (next) => client.setQueryData(key, next),
      (e) => notifyError(errorText(e), 'Recaps'),
    )
  return {
    enabled: preferences.recapsEnabled,
    recap,
    attention: open.filter((i) => i.group === 'attention'),
    recent,
    /** A thread's newest recap, the line its row shows in Completed: what it did and what is left. */
    recapOf: (taskId: string) => recent.find((item) => item.taskId === taskId),
    sinceVisit: recent.filter((i) => i.updatedAt >= previousVisit),
    act,
    refresh,
  }
}
