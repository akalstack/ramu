import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, FolderClosed } from 'lucide-react'
import type { RecapItem } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { t } from '../i18n'
import { invoke, ramu } from '../ipc'
import { ipcQueryKey } from '../dataQueries'
import { useWorkspace } from '../workspace/workspace'
import { useAppSettings } from '../settings/AppSettings'
import { notifyError } from '../chat/Notifications'
import { errorText } from '../lib/errors'

const VISIT_KEY = 'ramu.last-visit'
const QUERY_KEY = ipcQueryKey('recaps.get')
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

/** Open recap items for live threads, split into those that need you and recent ones (all, and since your last visit). */
export function useRecaps() {
  const ws = useWorkspace()
  const { preferences } = useAppSettings()
  const client = useQueryClient()
  const key = QUERY_KEY
  const query = useQuery({ queryKey: key, queryFn: () => invoke('recaps.get'), enabled: preferences.recapsEnabled })
  useEffect(
    () =>
      ramu.on('automation:changed', () => {
        void client.invalidateQueries({ queryKey: QUERY_KEY })
      }),
    [client],
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
  const act = async (id: string, action: RecapAction) => {
    try {
      await invoke('recaps.act', id, action)
      await client.invalidateQueries({ queryKey: key })
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

const GHOST =
  'ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover small text-caption'

/** One recap item: the project, what happened, and what you can do about it. */
export function RecapCard({
  item,
  attention,
  act,
}: {
  item: RecapItem
  attention: boolean
  act: (id: string, action: RecapAction) => void
}) {
  const ws = useWorkspace()
  const project = ws.projects.find((p) => p.id === ws.tasks.find((task) => task.id === item.taskId)?.projectId)
  return (
    <article className="recap-card flex flex-col gap-1.5 rounded-(--radius-m) bg-card p-4">
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
            window.dispatchEvent(
              new CustomEvent('ramu:source-event', { detail: { sessionId: item.sessionId, seq: item.sourceSeq } }),
            )
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
            <Button variant="ghost" size="sm" className={GHOST} onClick={() => act(item.id, 'snoozed')}>
              {t('Snooze 1 day')}
            </Button>
          </>
        )}
        <Button variant="ghost" size="sm" className={GHOST} onClick={() => act(item.id, 'dismissed')}>
          {t('Dismiss')}
        </Button>
      </div>
    </article>
  )
}
