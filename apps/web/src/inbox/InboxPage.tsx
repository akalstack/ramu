import { Brief } from './Brief'
import { useInboxModel } from './useBrief'
import { useHost } from '../workspace/HostProvider'
import { useComputers } from '../workspace/computers'
import { HostsInbox } from './HostsInbox'
import { useEffect, useState } from 'react'
import { useWorkspace } from '../workspace/workspace'
import { DateTime } from 'luxon'
import { Inbox, Loader, Newspaper, RefreshCw, Sparkles } from 'lucide-react'
import type { LibrarySummary, RecapItem } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { Tabs, TabsContent } from '@/components/ui/tabs'
import { InboxEmpty, InboxList, InboxMark, InboxRow, InboxTabsList, byDay } from './InboxParts'
import { t, useLanguage } from '../i18n'
import { AgentList, recentlyCompleted, rowsOf, useAgentOverview } from '../HomeAgents'
import { FeedSection } from '../HomeSection'
import { useSummaries } from '../summaries/useSummaries'
import { openSummary } from '../summaries/openSummary'
import { RecapRow, useRecaps } from './recaps'
import { timeAgo } from '../Menu'
import { StateDot } from '../sidebar/projects/TaskStateIcon'
import type { InboxTab } from '@ramu/shared/hostInbox'
import { saveInboxTab, savedInboxTab } from './navigation'

/** What Ramu learned, one row per summary: the headline, how many changes, and its age or an unread dot. */
function LearnedList({ summaries }: { summaries: LibrarySummary[] }) {
  const host = useHost()
  return (
    <InboxList>
      {summaries.map((summary) => (
        <InboxRow
          key={summary.id}
          mark={
            <InboxMark>
              <Sparkles />
            </InboxMark>
          }
          title={summary.headline}
          meta={t('{0} changes', { 0: summary.items.length })}
          at={summary.periodEnd}
          {...(summary.status === 'unread'
            ? {
                trailing: (
                  <span className="flex flex-none items-center gap-2">
                    <StateDot kind="dot unread" label={t('Unread')} />
                    <span className="min-w-6 text-right text-caption text-muted-foreground tabular-nums">
                      {timeAgo(summary.periodEnd)}
                    </span>
                  </span>
                ),
              }
            : {})}
          onOpen={() => openSummary(summary.id, host.invoke, host.id)}
        />
      ))}
    </InboxList>
  )
}

const LEARNED_MAX = 20

/**
 * Everything agents, recaps and learning have for you: the Brief of what needs you, what is running, recaps, what
 * Ramu learned and finished work, one tab each.
 */
export function InboxPage() {
  const computers = useComputers()
  return computers && computers.computers.length > 1 ? <HostsInbox /> : <CurrentHostInbox />
}

function CurrentHostInbox() {
  useLanguage()
  const { groups, error } = useAgentOverview()
  const { model } = useInboxModel()
  const recaps = useRecaps()
  const { snapshot } = useSummaries()
  const [tab, setTab] = useState<InboxTab>(savedInboxTab)
  useEffect(() => {
    const onTab = (event: Event) => setTab((event as CustomEvent<InboxTab>).detail)
    window.addEventListener('ramu:inbox-tab', onTab)
    return () => window.removeEventListener('ramu:inbox-tab', onTab)
  }, [])
  const choose = (next: InboxTab) => {
    setTab(next)
    saveInboxTab(next)
  }
  const running = rowsOf(groups, 'Running', 'Limit reached')
  const ws = useWorkspace()
  const finishedAt = (taskId: string) => ws.tasks.find((task) => task.id === taskId)?.lastActiveAt ?? 0
  const completed = recentlyCompleted(groups, ws.tasks)
  const days = byDay(completed, (item) => finishedAt(item.session.taskId))
  const summaries = (snapshot?.summaries ?? []).slice(0, LEARNED_MAX)
  const unread = summaries.filter((summary) => summary.status === 'unread').length
  const earlier = recaps.recent.filter((item) => !recaps.sinceVisit.includes(item))
  const recapRow = (item: RecapItem) => (
    <RecapRow
      key={item.id}
      item={item}
      where={ws.projects.find((p) => p.id === ws.tasks.find((task) => task.id === item.taskId)?.projectId)?.name}
      attention={false}
      onOpen={() => {
        ws.openTask(item.taskId)
        ws.openView(item.taskId, { kind: 'agent', sessionId: item.sessionId, sourceSeq: item.sourceSeq })
      }}
      act={(action, until) => void recaps.act(item.id, action, until)}
    />
  )
  const tabs: { id: InboxTab; label: string; count: number }[] = [
    { id: 'brief', label: t('Brief'), count: model.needsYou },
    { id: 'running', label: t('Running'), count: running.length },
    { id: 'recaps', label: t('Recaps'), count: recaps.sinceVisit.length },
    { id: 'learned', label: t('Learned'), count: unread },
    { id: 'completed', label: t('Completed'), count: 0 },
  ]
  return (
    <div className="inbox-page flex min-h-0 flex-1 flex-col overflow-auto">
      <div className="mx-auto flex w-full max-w-[760px] flex-col gap-5 px-6 pt-6 pb-10">
        {error && (
          <p role="alert" className="text-bad small text-caption">
            {String(error)}
          </p>
        )}
        <Tabs value={tab} onValueChange={(value) => choose(value as InboxTab)} className="flex-col gap-5">
          <InboxTabsList tabs={tabs} />

          <TabsContent value="brief" className="flex flex-col gap-6">
            {tab === 'brief' && <Brief />}
          </TabsContent>

          <TabsContent value="running" className="flex flex-col gap-6">
            {tab === 'running' &&
              (running.length > 0 ? (
                <AgentList items={running} />
              ) : (
                <InboxEmpty
                  icon={<Loader />}
                  title={t('No agents running')}
                  detail={t('Threads and sub-agents that are working or waiting on a usage limit appear here.')}
                />
              ))}
          </TabsContent>

          <TabsContent value="recaps" className="flex flex-col gap-6">
            {tab === 'recaps' && (
              <>
                {recaps.enabled && (
                  <div className="flex items-center gap-2 text-caption text-muted-foreground">
                    <span>
                      {recaps.recap?.generating
                        ? recaps.recap.generatedAt
                          ? t('Updating recap…')
                          : t('Preparing your first recap')
                        : recaps.recap?.generatedAt
                          ? t('Daily recap updated {0}', {
                              '0': DateTime.fromMillis(recaps.recap.generatedAt).toRelative(),
                            })
                          : ''}
                    </span>
                    {recaps.recap?.generatedAt || recaps.recap?.generating ? (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="text-muted-foreground"
                        aria-label={t('Refresh recap')}
                        disabled={recaps.recap?.generating}
                        onClick={() => void recaps.refresh()}
                      >
                        <RefreshCw size={13} />
                      </Button>
                    ) : (
                      <Button variant="secondary" size="xs" onClick={() => void recaps.refresh()}>
                        <RefreshCw size={12} />
                        {t('Make the first recap')}
                      </Button>
                    )}
                  </div>
                )}
                {recaps.recap?.error && (
                  <p className="text-bad small text-caption" role="alert">
                    {recaps.recap.error}
                  </p>
                )}
                {recaps.sinceVisit.length > 0 && (
                  <FeedSection title={t('Since your last visit')} count={recaps.sinceVisit.length}>
                    <InboxList>{recaps.sinceVisit.map(recapRow)}</InboxList>
                  </FeedSection>
                )}
                {earlier.length > 0 && (
                  <FeedSection title={t('Earlier')} count={earlier.length}>
                    <InboxList>{earlier.map(recapRow)}</InboxList>
                  </FeedSection>
                )}
                {!recaps.recent.length && !(recaps.recap?.generating && !recaps.recap.generatedAt) && (
                  <InboxEmpty
                    icon={<Newspaper />}
                    title={t('No recaps yet')}
                    detail={
                      recaps.enabled
                        ? t('A daily recap shows what your threads did and what is left.')
                        : t('Daily recaps are off. Turn them on in Settings → Background & Recaps.')
                    }
                  />
                )}
              </>
            )}
          </TabsContent>

          <TabsContent value="learned" className="flex flex-col gap-6">
            {tab === 'learned' && (
              <>
                {summaries.length > 0 ? (
                  <LearnedList summaries={summaries} />
                ) : (
                  <InboxEmpty
                    icon={<Sparkles />}
                    title={t('No summaries yet')}
                    detail={t('Ramu summarizes the memories and skills it saves from your threads.')}
                  />
                )}
              </>
            )}
          </TabsContent>

          <TabsContent value="completed" className="flex flex-col gap-6">
            {tab === 'completed' && (
              <>
                {days.map((day) => (
                  <FeedSection key={day.label} title={day.label} count={day.items.length}>
                    <AgentList items={day.items} />
                  </FeedSection>
                ))}
                {completed.length > 0 ? (
                  <p className="m-0 text-caption text-muted-foreground">
                    {t(
                      'Threads finished in the last 7 days. Older ones stay in the sidebar, and Search finds them all.',
                    )}
                  </p>
                ) : (
                  <InboxEmpty
                    icon={<Inbox />}
                    title={t('Nothing finished this week')}
                    detail={t('Threads finished in the last 7 days are listed here. Older ones stay in the sidebar.')}
                  />
                )}
              </>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
