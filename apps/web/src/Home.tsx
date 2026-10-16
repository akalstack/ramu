import { t, useLanguage } from './i18n'
import { errorText } from './lib/errors'
import { Button } from '@/components/desktop-button'
import { Check, Clock, FolderClosed, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { DateTime } from 'luxon'
import type { RecapItem, RecapSnapshot } from '@ramu/shared/types'
import { useAppSettings } from './settings/AppSettings'
import { useWorkspace } from './workspace/workspace'
import { BackgroundControls, formatScheduleTime, useSchedules } from './Automation'
import { invoke, ramu } from './ipc'
import { notifyError } from './chat/Notifications'
import { LearnedCard } from './summaries/LearnedCard'
import { HomeAgents } from './HomeAgents'
import { FeedSection, useCapped } from './HomeSection'

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

type RecapAct = (id: string, action: 'done' | 'dismissed' | 'snoozed') => void

function RecapSection({
  title,
  items,
  attention,
  act,
}: {
  title: string
  items: RecapItem[]
  attention: boolean
  act: RecapAct
}) {
  const ws = useWorkspace()
  const { shown, toggle } = useCapped(items)
  const ghost =
    'ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover small text-caption'
  return (
    <FeedSection title={title} count={items.length}>
      {shown.map((item) => {
        const project = ws.projects.find((p) => p.id === ws.tasks.find((task) => task.id === item.taskId)?.projectId)
        return (
          <article
            className="recap-card [&_h3]:text-body [&_h3]:m-[0_0_6px] [&_p]:m-[0_0_12px] [&_p]:leading-[1.5] rounded-(--radius-m) bg-card p-4"
            key={item.id}
          >
            {project && (
              <span className="muted text-muted-foreground small text-caption flex items-center gap-1 mb-1">
                <FolderClosed size={12} />
                {project.name}
              </span>
            )}
            <h3>{item.title}</h3>
            <p className="muted text-muted-foreground">{item.detail}</p>
            <div className="recap-actions flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                className="bg-fill hover:bg-fill-hover small text-caption"
                title={t('Source event {0}', { '0': item.sourceSeq })}
                onClick={() => {
                  ws.openTask(item.taskId)
                  ws.openView(item.taskId, { kind: 'agent', sessionId: item.sessionId, sourceSeq: item.sourceSeq })
                  window.dispatchEvent(
                    new CustomEvent('ramu:source-event', {
                      detail: { sessionId: item.sessionId, seq: item.sourceSeq },
                    }),
                  )
                }}
              >
                {t('Open thread')}
              </Button>
              {attention && (
                <>
                  <Button variant="ghost" size="sm" className={ghost} onClick={() => act(item.id, 'done')}>
                    <Check size={12} />
                    {t('Mark done')}
                  </Button>
                  <Button variant="ghost" size="sm" className={ghost} onClick={() => act(item.id, 'snoozed')}>
                    {t('Snooze 1 day')}
                  </Button>
                </>
              )}
              <Button variant="ghost" size="sm" className={ghost} onClick={() => act(item.id, 'dismissed')}>
                {t('Dismiss')}
              </Button>
            </div>
          </article>
        )
      })}
      {toggle}
    </FeedSection>
  )
}

function Upcoming() {
  const ws = useWorkspace(),
    { schedules } = useSchedules()
  const upcoming = schedules
    .filter((s) => s.state === 'active')
    .sort((a, b) => (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity))
  const { shown, toggle } = useCapped(upcoming)
  if (!upcoming.length) return null
  return (
    <FeedSection title={t('Coming up')}>
      <div className="flex flex-col">
        {shown.map((s) => {
          const project = ws.projects.find((p) => p.id === s.projectId)
          return (
            <Button
              variant="tree"
              key={s.id}
              className="home-upcoming [&_>_span:last-child]:ml-auto h-8 min-h-8 gap-1.5 px-2 text-soft text-left"
              onClick={() => ws.setSidebar('schedules')}
            >
              <Clock size={14} className="flex-none text-muted-foreground" />
              <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{s.name}</span>
              {project && (
                <span className="muted text-muted-foreground small text-caption min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                  {project.name}
                </span>
              )}
              <span className="muted text-muted-foreground small text-caption flex-none">
                {formatScheduleTime(s.nextRunAt, s.timezone)}
              </span>
            </Button>
          )
        })}
      </div>
      {toggle}
    </FeedSection>
  )
}

/**
 * What sits under the start box on Home and New thread, most actionable first: agents and recaps that need you,
 * then agents still working, recaps since you last looked, what Ramu learned and upcoming schedules.
 * Sections show only when they have content.
 */
export function HomeFeed() {
  useLanguage()
  const ws = useWorkspace(),
    { preferences } = useAppSettings()
  const [recap, setRecap] = useState<RecapSnapshot | null>(null)
  const [lastVisit] = useState(previousVisit)
  const reload = useCallback(() => invoke('recaps.get').then(setRecap), [])
  useEffect(() => {
    void reload().catch(() => {})
    return ramu.on('automation:changed', () => {
      void reload().catch(() => {})
    })
  }, [reload])
  const act: RecapAct = async (id, action) => {
    try {
      await invoke('recaps.act', id, action)
      await reload()
    } catch (e) {
      notifyError(errorText(e), 'Recaps')
    }
  }
  const visible =
    recap?.items.filter(
      (i) =>
        (i.status === 'open' || (i.status === 'snoozed' && (i.snoozedUntil ?? 0) <= Date.now())) &&
        ws.tasks.some((t) => t.id === i.taskId),
    ) ?? []
  const attention = visible.filter((i) => i.group === 'attention')
  const recent = visible.filter((i) => i.group === 'recent' && i.updatedAt >= lastVisit)
  const recapsOn = preferences.recapsEnabled
  return (
    <div className="home-feed w-full max-w-[760px] m-[0_auto] flex flex-col gap-4 pt-2">
      <HomeAgents
        attention={
          recapsOn && attention.length > 0 ? (
            <RecapSection title={t('Needs your attention')} items={attention} attention act={act} />
          ) : undefined
        }
      />
      {recapsOn && recap?.error && (
        <p className="error text-bad small text-caption" role="alert">
          {recap.error}
        </p>
      )}
      {recapsOn && recent.length > 0 && (
        <RecapSection title={t('Since your last visit')} items={recent} attention={false} act={act} />
      )}
      <LearnedCard />
      <Upcoming />
      <footer className="flex items-center gap-2 pb-2">
        <BackgroundControls compact />
        {recapsOn && (
          <>
            <span className="grow flex-1 min-w-0 text-left" />
            <Button
              variant="ghost"
              size="icon-xs"
              className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)"
              aria-label={t('Refresh recap')}
              title={
                recap?.generating
                  ? t('Updating recap…')
                  : recap?.generatedAt
                    ? t('Daily recap updated {0}', { '0': DateTime.fromMillis(recap.generatedAt).toRelative() })
                    : t('Preparing your first recap')
              }
              disabled={recap?.generating}
              onClick={() => void invoke('recaps.refresh').then(setRecap, (e) => notifyError(errorText(e), 'Recaps'))}
            >
              <RefreshCw size={13} />
            </Button>
          </>
        )}
      </footer>
    </div>
  )
}
