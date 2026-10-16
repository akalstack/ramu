import { useEffect, useState, type ReactNode } from 'react'
import { DateTime } from 'luxon'
import { CircleCheck, Inbox, Loader, Newspaper, RefreshCw, Sparkles } from 'lucide-react'
import { Button } from '@/components/desktop-button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { t, useLanguage } from '../i18n'
import { AgentList, rowsOf, useAgentOverview } from '../HomeAgents'
import { FeedSection } from '../HomeSection'
import { useSummaries } from '../summaries/useSummaries'
import { openSummary } from '../summaries/openSummary'
import { RecapCard, useRecaps } from './recaps'
import { saveInboxTab, savedInboxTab, type InboxTab } from './navigation'

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

const Count = ({ n }: { n: number }) =>
  n > 0 ? (
    <span className="min-w-4 rounded-full bg-fill px-1.5 text-[11px] leading-4 text-muted-foreground tabular-nums">
      {n}
    </span>
  ) : null

/**
 * Everything agents, recaps and learning have for you, beyond Home's glance: what needs you, what is running,
 * recaps, what Ramu learned and finished work, one tab each.
 */
export function InboxPage() {
  useLanguage()
  const { groups, error } = useAgentOverview()
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
  const waiting = rowsOf(groups, 'Waiting for your input')
  const running = rowsOf(groups, 'Running', 'Waiting for allowance')
  const completed = rowsOf(groups, 'Done')
  const summaries = snapshot?.summaries ?? []
  const unread = summaries.filter((summary) => summary.status === 'unread').length
  const earlier = recaps.recent.filter((item) => !recaps.sinceVisit.includes(item))
  const tabs: { id: InboxTab; label: string; count: number }[] = [
    { id: 'needs-you', label: t('Needs you'), count: waiting.length + recaps.attention.length },
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

          <TabsContent value="needs-you" className="flex flex-col gap-6">
            {waiting.length > 0 && (
              <FeedSection title={t('Waiting for your input')} count={waiting.length}>
                <AgentList items={waiting} />
              </FeedSection>
            )}
            {recaps.attention.length > 0 && (
              <FeedSection title={t('Needs your attention')} count={recaps.attention.length}>
                {recaps.attention.map((item) => (
                  <RecapCard key={item.id} item={item} attention act={recaps.act} />
                ))}
              </FeedSection>
            )}
            {!waiting.length && !recaps.attention.length && (
              <Nothing
                icon={<CircleCheck />}
                title={t('Nothing needs you')}
                detail={t('Questions, approvals and recaps that need a decision show up here.')}
              />
            )}
          </TabsContent>

          <TabsContent value="running" className="flex flex-col gap-6">
            {running.length > 0 ? (
              <AgentList items={running} />
            ) : (
              <Nothing
                icon={<Loader />}
                title={t('No agents running')}
                detail={t('Threads and helpers that are working, or waiting for a usage limit, show up here.')}
              />
            )}
          </TabsContent>

          <TabsContent value="recaps" className="flex flex-col gap-6">
            {recaps.enabled && (
              <div className="flex items-center gap-2 text-caption text-muted-foreground">
                <span>
                  {recaps.recap?.generating
                    ? t('Updating recap…')
                    : recaps.recap?.generatedAt
                      ? t('Daily recap updated {0}', {
                          '0': DateTime.fromMillis(recaps.recap.generatedAt).toRelative(),
                        })
                      : t('Preparing your first recap')}
                </span>
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
            {!recaps.recent.length && (
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
          </TabsContent>

          <TabsContent value="learned" className="flex flex-col gap-6">
            {summaries.length > 0 ? (
              <div className="flex flex-col overflow-hidden rounded-(--radius-m) bg-card">
                {summaries.map((summary) => (
                  <Button
                    key={summary.id}
                    variant="ghost"
                    className="h-auto min-h-14 justify-start! gap-3 rounded-none! px-4 py-3 text-left font-normal whitespace-normal [&+&]:border-t [&+&]:border-(--line)"
                    onClick={() => openSummary(summary.id)}
                  >
                    <Sparkles size={14} className="flex-none text-muted-foreground" />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className={summary.status === 'dismissed' ? 'text-soft' : 'text-foreground'}>
                        {summary.headline}
                      </span>
                      <span className="text-caption text-muted-foreground">
                        {DateTime.fromMillis(summary.periodEnd).toRelative()} ·{' '}
                        {t('{0} changes', { 0: summary.items.length })}
                      </span>
                    </span>
                    {summary.status === 'unread' && (
                      <span
                        role="img"
                        aria-label={t('Unread')}
                        className="size-2 flex-none rounded-full bg-[var(--accent)]"
                      />
                    )}
                  </Button>
                ))}
              </div>
            ) : (
              <Nothing
                icon={<Sparkles />}
                title={t('No summaries yet')}
                detail={t('Ramu summarizes the memories and skills it saves from your threads.')}
              />
            )}
          </TabsContent>

          <TabsContent value="completed" className="flex flex-col gap-6">
            {completed.length > 0 ? (
              <AgentList items={completed} />
            ) : (
              <Nothing
                icon={<Inbox />}
                title={t('Nothing completed yet')}
                detail={t('Finished threads and helpers are listed here.')}
              />
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
