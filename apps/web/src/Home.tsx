import { HomeGroups } from './HomeGroups'
import { t, useLanguage } from './i18n'
import { Button } from '@/components/desktop-button'
import { ChevronRight, Inbox } from 'lucide-react'
import { useWorkspace } from './workspace/workspace'
import { BackgroundControls } from './Automation'
import { AgentList, recentlyCompleted, rowsOf, useAgentOverview } from './HomeAgents'
import { FeedSection } from './HomeSection'
import { RecapCard, useRecaps } from './inbox/recaps'
import { openInbox } from './inbox/navigation'
import { useHost } from './workspace/HostProvider'
import { errorText } from './lib/errors'

const GLANCE = 3

/**
 * What sits under the start box on Home and New thread. Home stays a start screen: only what is blocked on you
 * (questions, approvals, recaps that need a decision) shows here, plus one line that leads to everything else in Inbox.
 */
export function HomeFeed() {
  useLanguage()
  const ws = useWorkspace()
  const host = useHost()
  const { groups, error } = useAgentOverview()
  const recaps = useRecaps()
  const waiting = rowsOf(groups, 'Waiting for your input')
  const running = rowsOf(groups, 'Running', 'Limit reached').length
  const completed = recentlyCompleted(groups, ws.tasks).length
  const needsYou = waiting.length + recaps.attention.length
  const summary = [
    running && t('{0} running', { 0: running }),
    recaps.sinceVisit.length && t('{0} new recaps', { 0: recaps.sinceVisit.length }),
    completed && t('{0} completed this week', { 0: completed }),
  ].filter(Boolean)
  return (
    <div className="home-feed home-agents m-[0_auto] flex w-full max-w-[760px] flex-col gap-6 pb-6">
      <nav className="-mt-3 flex min-h-8 items-center justify-center gap-3" aria-label={t('Inbox')}>
        <BackgroundControls compact />
        <Button
          variant="ghost"
          size="sm"
          className="home-inbox-link text-muted-foreground small text-caption"
          onClick={() => openInbox(ws, 'all')}
        >
          <Inbox size={13} />
          {summary.length ? summary.join(' · ') : t('Open inbox')}
          {needsYou > GLANCE && <span> · {t('{0} waiting', { 0: needsYou })}</span>}
          <ChevronRight size={12} />
        </Button>
      </nav>
      {/* A host that is offline or rejected says so in the status bar; its failed read adds nothing but noise. */}
      {error && (host.status === 'connected' || host.status === null) && (
        <p role="alert" className="text-bad small text-caption">
          {errorText(error)}
        </p>
      )}
      {waiting.length > 0 && (
        <FeedSection title={t('Waiting for your input')} count={waiting.length}>
          <AgentList items={waiting.slice(0, GLANCE)} />
        </FeedSection>
      )}
      <HomeGroups />
      {recaps.attention.length > 0 && (
        <FeedSection title={t('Needs your attention')} count={recaps.attention.length}>
          {recaps.attention.slice(0, GLANCE).map((item) => (
            <RecapCard key={item.id} item={item} attention act={recaps.act} />
          ))}
        </FeedSection>
      )}
    </div>
  )
}
