import { Brief } from './Brief'
import { useInboxModel } from './useBrief'
import { useHost } from '../workspace/HostProvider'
import { useComputers } from '../workspace/computers'
import { HostsInbox } from './HostsInbox'
import { useEffect, useState } from 'react'
import { useWorkspace } from '../workspace/workspace'
import { Inbox, Loader, Sparkles } from 'lucide-react'
import type { LibrarySummary } from '@ramu/shared/types'
import { Tabs, TabsContent } from '@/components/ui/tabs'
import { InboxEmpty, InboxList, InboxMark, InboxRow, InboxTabsList, byDay } from './InboxParts'
import { t, useLanguage } from '../i18n'
import { AgentList, recentlyCompleted, rowsOf, useAgentOverview } from '../HomeAgents'
import { FeedSection } from '../HomeSection'
import { useSummaries } from '../summaries/useSummaries'
import { openSummary } from '../summaries/openSummary'
import { timeAgo } from '../Menu'
import { StateDot } from '../sidebar/projects/TaskStateIcon'
import type { InboxTab } from '@ramu/shared/hostInbox'
import { saveInboxTab, savedInboxTab } from './navigation'
import { LearningReviewList } from './LearningReviews'
import { useLearningReviews } from '../learning/learningQueries'
import { ShipActivityList } from './ShipActivity'

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
 * Everything agents and learning have for you: the Brief of what needs you, what is running, what Ramu learned and
 * finished work, one tab each.
 */
export function InboxPage() {
  const computers = useComputers()
  return computers && computers.computers.length > 1 ? <HostsInbox /> : <CurrentHostInbox />
}

function CurrentHostInbox() {
  useLanguage()
  const { groups, error } = useAgentOverview()
  const host = useHost()
  const reviews = useLearningReviews([host.id])
  const { model } = useInboxModel({ reviews })
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
  const tabs: { id: InboxTab; label: string; count: number }[] = [
    { id: 'brief', label: t('Brief'), count: model.needsYou },
    { id: 'running', label: t('Running'), count: running.length },
    { id: 'learned', label: t('Learned'), count: unread + model.learningReviews.length },
    { id: 'completed', label: t('Done'), count: 0 },
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

          <TabsContent value="learned" className="flex flex-col gap-6">
            {tab === 'learned' && (
              <>
                <LearningReviewList
                  reviews={model.learningReviews}
                  taskOf={(_, sessionId) =>
                    Object.values(groups)
                      .flat()
                      .find((agent) => agent.id === sessionId)?.taskId
                  }
                />
                {summaries.length > 0 ? (
                  <LearnedList summaries={summaries} />
                ) : model.learningReviews.length ? null : (
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
                <ShipActivityList />
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
