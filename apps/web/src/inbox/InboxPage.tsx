import { Brief } from './Brief'
import { useInboxModel } from './useBrief'
import { useHost } from '../workspace/HostProvider'
import { useComputers } from '../workspace/computers'
import { HostsInbox } from './HostsInbox'
import { useEffect, useState, type ReactNode } from 'react'
import { useWorkspace } from '../workspace/workspace'
import { DateTime } from 'luxon'
import { Inbox, Loader, Newspaper, RefreshCw, Sparkles } from 'lucide-react'
import type { LibrarySummary } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { t, useLanguage } from '../i18n'
import { AgentList, recentlyCompleted, rowsOf, useAgentOverview } from '../HomeAgents'
import { FeedSection } from '../HomeSection'
import { useSummaries } from '../summaries/useSummaries'
import { openSummary } from '../summaries/openSummary'
import { RecapCard, useRecaps } from './recaps'
import { FadeText } from '../FadeText'
import { timeAgo } from '../Menu'
import { StateDot } from '../sidebar/projects/TaskStateIcon'
import type { InboxTab } from '@ramu/shared/hostInbox'
import { saveInboxTab, savedInboxTab } from './navigation'

function Nothing({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return (
    <Empty className="py-16">
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{detail}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

/** Summaries as sidebar-style rows: headline, then age, or an unread dot. */
function LearnedList({ summaries }: { summaries: LibrarySummary[] }) {
  const host = useHost()
  return (
    <div className="-mx-2.5 flex flex-col gap-px">
      {summaries.map((summary) => (
        <div
          key={summary.id}
          role="button"
          tabIndex={0}
          onClick={() => openSummary(summary.id, host.invoke, host.id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') openSummary(summary.id, host.invoke, host.id)
          }}
          className="flex min-h-9 cursor-default items-center gap-2 rounded-(--radius-s) px-2.5 text-body leading-5 text-soft [transition:background_0.1s_var(--ease),_color_0.1s_var(--ease)] hover:bg-accent hover:text-foreground"
        >
          <Sparkles size={13} className="flex-none text-muted-foreground" />
          <FadeText
            className={`min-w-0 flex-1 overflow-hidden text-left whitespace-nowrap ${summary.status === 'dismissed' ? 'text-muted-foreground' : ''}`}
            text={summary.headline}
          />
          <span className="flex-none text-caption text-muted-foreground">
            {t('{0} changes', { 0: summary.items.length })}
          </span>
          {summary.status === 'unread' ? (
            <StateDot kind="dot unread" label={t('Unread')} />
          ) : (
            <span className="min-w-6 flex-none text-right text-caption text-muted-foreground tabular-nums">
              {timeAgo(summary.periodEnd)}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

const LEARNED_MAX = 20

const Count = ({ n }: { n: number }) =>
  n > 0 ? (
    <span className="min-w-4 rounded-full bg-fill px-1.5 text-[11px] leading-4 text-muted-foreground tabular-nums">
      {n}
    </span>
  ) : null

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
  const today = DateTime.now().startOf('day').toMillis()
  const yesterday = today - 86_400_000
  const days = [
    { label: t('Today'), items: completed.filter((item) => finishedAt(item.session.taskId) >= today) },
    {
      label: t('Yesterday'),
      items: completed.filter((item) => {
        const at = finishedAt(item.session.taskId)
        return at >= yesterday && at < today
      }),
    },
    { label: t('Earlier'), items: completed.filter((item) => finishedAt(item.session.taskId) < yesterday) },
  ].filter((day) => day.items.length)
  const summaries = (snapshot?.summaries ?? []).slice(0, LEARNED_MAX)
  const unread = summaries.filter((summary) => summary.status === 'unread').length
  const earlier = recaps.recent.filter((item) => !recaps.sinceVisit.includes(item))
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
          <TabsList variant="line" className="h-9! w-full justify-start gap-4 border-b border-(--line) p-0">
            {tabs.map((entry) => (
              <TabsTrigger key={entry.id} value={entry.id} className="flex-none gap-1.5 px-0.5 text-control">
                {entry.label}
                <Count n={entry.count} />
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="brief" className="flex flex-col gap-6">
            {tab === 'brief' && <Brief />}
          </TabsContent>

          <TabsContent value="running" className="flex flex-col gap-6">
            {tab === 'running' &&
              (running.length > 0 ? (
                <AgentList items={running} />
              ) : (
                <Nothing
                  icon={<Loader />}
                  title={t('No agents running')}
                  detail={t('Threads and sub-agents that are working, or waiting for a usage limit, show up here.')}
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
                    {recaps.sinceVisit.map((item) => (
                      <RecapCard key={item.id} item={item} attention={false} act={recaps.act} />
                    ))}
                  </FeedSection>
                )}
                {earlier.length > 0 && (
                  <FeedSection title={t('Earlier')} count={earlier.length}>
                    {earlier.map((item) => (
                      <RecapCard key={item.id} item={item} attention={false} act={recaps.act} />
                    ))}
                  </FeedSection>
                )}
                {!recaps.recent.length && !(recaps.recap?.generating && !recaps.recap.generatedAt) && (
                  <Nothing
                    icon={<Newspaper />}
                    title={t('No recaps yet')}
                    detail={
                      recaps.enabled
                        ? t('A daily recap summarizes what your threads did and what is left.')
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
                  <Nothing
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
                      'Showing threads finished in the last 7 days. Older threads stay in the sidebar, and Search finds all of them.',
                    )}
                  </p>
                ) : (
                  <Nothing
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
