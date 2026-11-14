import { animateThreadListChange } from '../workspace/threadListMotion'
import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronDown, FolderClosed } from 'lucide-react'
import type { RecapItem } from '@ramu/shared/types'
import { SNOOZE_CHOICES, snoozeUntil, type SnoozeChoice } from '@ramu/shared/snooze'
import { Button } from '@/components/desktop-button'
import { notify } from '@/components/app-toaster'
import { Menu } from '../Menu'
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

const GHOST =
  'ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover small text-caption'

const SNOOZE_LABEL: Record<SnoozeChoice, () => string> = {
  'in-3-hours': () => t('In 3 hours'),
  tomorrow: () => t('Tomorrow'),
  'next-week': () => t('Next week'),
}

/** A toast that says what just happened to a recap item and offers to put it back, so a mis-click costs nothing. */
export function notifyRecapAction(action: RecapAction, undo: () => void) {
  notify.add({
    timeout: TOAST_MS.info,
    title: action === 'done' ? t('Marked done') : action === 'dismissed' ? t('Dismissed') : t('Snoozed'),
    actionProps: { children: t('Undo'), onClick: undo },
  })
}

/** Snooze with a choice of how long: later today, tomorrow morning or next week. */
export function SnoozeMenu({ onSnooze, disabled }: { onSnooze: (until: number) => void; disabled?: boolean }) {
  return (
    <Menu
      label={t('Snooze')}
      disabled={disabled}
      className={GHOST}
      icon={
        <>
          {t('Snooze')}
          <ChevronDown size={11} />
        </>
      }
      items={SNOOZE_CHOICES.map((choice) => ({
        key: choice,
        label: SNOOZE_LABEL[choice](),
        onSelect: () => onSnooze(snoozeUntil(choice)),
      }))}
    />
  )
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
    sinceVisit: recent.filter((i) => i.updatedAt >= previousVisit),
    act,
    refresh,
  }
}

/** One recap item: the project, what happened, and what you can do about it. */
export function RecapCard({
  item,
  attention,
  act,
}: {
  item: RecapItem
  attention: boolean
  act: (id: string, action: RecapAction, until?: number) => void
}) {
  const ws = useWorkspace()
  const project = ws.projects.find((p) => p.id === ws.tasks.find((task) => task.id === item.taskId)?.projectId)
  return (
    <article data-thread-motion-row="" className="recap-card flex flex-col gap-1.5 rounded-(--radius-m) bg-card p-4">
      {project && (
        <span className="muted text-muted-foreground small text-caption flex items-center gap-1">
          <FolderClosed size={12} />
          {project.name}
        </span>
      )}
      <h3 className="m-0 text-body font-medium">{item.title}</h3>
      <p className="muted text-muted-foreground m-0 leading-[1.5]">{item.detail}</p>
      <div className="recap-actions mt-1.5 flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          className="bg-fill hover:bg-fill-hover small text-caption"
          title={t('Source event {0}', { '0': item.sourceSeq })}
          onClick={() => {
            ws.openTask(item.taskId)
            ws.openView(item.taskId, { kind: 'agent', sessionId: item.sessionId, sourceSeq: item.sourceSeq })
          }}
        >
          {t('Open thread')}
        </Button>
        {attention && (
          <>
            <Button variant="ghost" size="sm" className={GHOST} onClick={() => act(item.id, 'done')}>
              <Check size={12} />
              {t('Mark done')}
            </Button>
            <SnoozeMenu onSnooze={(until) => act(item.id, 'snoozed', until)} />
          </>
        )}
        <Button variant="ghost" size="sm" className={GHOST} onClick={() => act(item.id, 'dismissed')}>
          {t('Dismiss')}
        </Button>
      </div>
    </article>
  )
}
