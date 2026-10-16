import { t, useLanguage } from './i18n'
import { errorText } from './lib/errors'
import { Button } from '@/components/desktop-button'
import { Check, Clock, FolderClosed, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { DateTime } from 'luxon'
import type { RecapSnapshot } from '@ramu/shared/types'
import { useAppSettings } from './settings/AppSettings'
import { useWorkspace } from './workspace/workspace'
import { BackgroundControls, formatScheduleTime, useSchedules } from './Automation'
import { invoke, ramu } from './ipc'
import { notifyError } from './chat/Notifications'
import { LearnedCard } from './summaries/LearnedCard'
import { HomeAgents } from './HomeAgents'

/**
 * What sits under the start box on Home and New chat: chats still working in the background,
 * recaps, upcoming schedules and the background service. Sections show only when they have content.
 */
export function HomeFeed() {
  useLanguage()
  const ws = useWorkspace(),
    { preferences } = useAppSettings(),
    { schedules } = useSchedules()
  const [recap, setRecap] = useState<RecapSnapshot | null>(null)
  const [lastVisit] = useState(() => Number(localStorage.getItem('ramu.last-visit') ?? 0))
  const reload = useCallback(() => invoke('recaps.get').then(setRecap), [])
  useEffect(() => {
    void reload().catch(() => {})
    localStorage.setItem('ramu.last-visit', String(Date.now()))
    return ramu.on('automation:changed', () => {
      void reload().catch(() => {})
    })
  }, [reload])
  const act = async (id: string, action: 'done' | 'dismissed' | 'snoozed') => {
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
  const groups = (['attention', 'recent'] as const)
    .map((group) => ({
      group,
      items: visible.filter((i) => i.group === group && (group !== 'recent' || i.updatedAt >= lastVisit)),
    }))
    .filter((entry) => entry.items.length)
  const upcoming = schedules
    .filter((s) => s.state === 'active')
    .sort((a, b) => (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity))
    .slice(0, 3)
  return (
    <div className="home-feed [&_.recap-group]:m-[12px_0_0] [&_.review-inbox]:m-[0_0_8px] [&_.recap-group_h2]:text-control [&_.recap-group_h2]:font-medium [&_.recap-group_h2]:text-muted-foreground [&_.recap-group_h2]:mb-2 w-full max-w-[760px] m-[0_auto] flex flex-col gap-1">
      <HomeAgents />
      <LearnedCard />
      {preferences.recapsEnabled && recap?.error && (
        <p className="error text-bad small text-caption" role="alert">
          {recap.error}
        </p>
      )}
      {preferences.recapsEnabled &&
        groups.map(({ group, items }) => (
          <section
            key={group}
            className="recap-group [&_h2]:text-[length:15px] [&_h2]:font-semibold [&_h2]:m-[0_0_12px] m-[20px_0]"
          >
            <h2>{group === 'attention' ? t('Needs your attention') : t('Since your last visit')}</h2>
            {items.map((item) => (
              <article
                className="recap-card [&_h3]:text-body [&_h3]:m-[0_0_7px] [&_p]:m-[0_0_12px] [&_p]:leading-[1.5] [border:1px_solid_transparent] bg-card rounded-(--radius-m) p-4 mb-2.5"
                key={item.id}
              >
                {(() => {
                  const project = ws.projects.find(
                    (p) => p.id === ws.tasks.find((task) => task.id === item.taskId)?.projectId,
                  )
                  return (
                    project && (
                      <span className="muted text-muted-foreground small text-caption flex items-center gap-1 mb-1">
                        <FolderClosed size={12} />
                        {project.name}
                      </span>
                    )
                  )
                })()}
                <h3>{item.title}</h3>
                <p className="muted text-muted-foreground">{item.detail}</p>
                <div className="recap-actions flex items-center gap-2">
                  <Button
                    variant="default"
                    size="sm"
                    className="primary bg-primary text-primary-foreground border-transparent font-semibold justify-center hover:bg-primary-hover disabled:bg-raised disabled:text-muted-foreground disabled:opacity-100 small text-caption"
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
                  {group === 'attention' && (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover small text-caption"
                        onClick={() => void act(item.id, 'done')}
                      >
                        <Check size={12} />
                        {t('Mark done')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover small text-caption"
                        onClick={() => void act(item.id, 'snoozed')}
                      >
                        {t('Snooze 1 day')}
                      </Button>
                    </>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover small text-caption"
                    onClick={() => void act(item.id, 'dismissed')}
                  >
                    {t('Dismiss')}
                  </Button>
                </div>
              </article>
            ))}
          </section>
        ))}
      {upcoming.length > 0 && (
        <section className="recap-group [&_h2]:text-control [&_h2]:font-normal [&_h2]:text-muted-foreground [&_h2]:m-[0_0_4px] [&_h2]:px-2 m-[20px_0]">
          <h2>{t('Coming up')}</h2>
          {upcoming.map((s) => (
            <Button
              variant="tree"
              key={s.id}
              className="home-upcoming [&_>_span:last-child]:ml-auto h-7 min-h-7 gap-1.5 px-2 text-soft text-left"
              onClick={() => ws.setSidebar('schedules')}
            >
              <Clock size={14} className="flex-none text-muted-foreground" />
              <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{s.name}</span>
              {ws.projects.find((p) => p.id === s.projectId) && (
                <span className="muted text-muted-foreground small text-caption min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                  {ws.projects.find((p) => p.id === s.projectId)!.name}
                </span>
              )}
              <span className="muted text-muted-foreground small text-caption flex-none">
                {formatScheduleTime(s.nextRunAt, s.timezone)}
              </span>
            </Button>
          ))}
        </section>
      )}
      <footer className="mt-3 flex items-center gap-2 pt-2">
        <BackgroundControls compact />
        {preferences.recapsEnabled && (
          <>
            <span className="grow flex-1 min-w-0 text-left" />
            <span className="muted text-muted-foreground small text-caption">
              {recap?.generating
                ? t('Updating recap…')
                : recap?.generatedAt
                  ? t('Daily recap updated {0}', { '0': DateTime.fromMillis(recap.generatedAt).toRelative() })
                  : t('Preparing your first recap')}
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)"
              aria-label={t('Refresh recap')}
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
