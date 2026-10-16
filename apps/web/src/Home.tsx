import { t, useLanguage } from './i18n'
import { Button } from '@/components/desktop-button'
import { ChevronRight, Clock, Inbox, RefreshCw } from 'lucide-react'
import { DateTime } from 'luxon'
import { useWorkspace } from './workspace/workspace'
import { BackgroundControls, formatScheduleTime, useSchedules } from './Automation'
import { LearnedCard } from './summaries/LearnedCard'
import { AgentList, rowsOf, useAgentOverview } from './HomeAgents'
import { FeedSection } from './HomeSection'
import { RecapCard, useRecaps } from './inbox/recaps'
import { openInbox, type InboxTab } from './inbox/navigation'

const GLANCE = 3

/** "View all" under a capped Home block, into the matching Inbox tab. */
function ViewAll({ count, tab }: { count: number; tab: InboxTab }) {
  const ws = useWorkspace()
  if (count <= GLANCE) return null
  return (
    <Button
      variant="ghost"
      size="sm"
      className="self-start text-muted-foreground small text-caption"
      onClick={() => openInbox(ws, tab)}
    >
      {t('View all')} · {count}
      <ChevronRight size={12} />
    </Button>
  )
}

function Upcoming() {
  const ws = useWorkspace(),
    { schedules } = useSchedules()
  const upcoming = schedules
    .filter((s) => s.state === 'active')
    .sort((a, b) => (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity))
  if (!upcoming.length) return null
  return (
    <FeedSection title={t('Coming up')}>
      <div className="flex flex-col overflow-hidden rounded-(--radius-m) bg-card">
        {upcoming.slice(0, GLANCE).map((s) => {
          const project = ws.projects.find((p) => p.id === s.projectId)
          return (
            <Button
              variant="tree"
              key={s.id}
              className="home-upcoming h-10 min-h-10 gap-2.5 rounded-none! px-3 text-left text-soft [&+&]:border-t [&+&]:border-(--line)"
              onClick={() => ws.setSidebar('schedules')}
            >
              <Clock size={14} className="flex-none text-muted-foreground" />
              <span className="min-w-0 truncate">{s.name}</span>
              {project && <span className="min-w-0 truncate text-caption text-muted-foreground">{project.name}</span>}
              <span className="ml-auto flex-none text-caption text-muted-foreground">
                {formatScheduleTime(s.nextRunAt, s.timezone)}
              </span>
            </Button>
          )
        })}
      </div>
      {upcoming.length > GLANCE && (
        <Button
          variant="ghost"
          size="sm"
          className="self-start text-muted-foreground small text-caption"
          onClick={() => ws.setSidebar('schedules')}
        >
          {t('View all')} · {upcoming.length}
          <ChevronRight size={12} />
        </Button>
      )}
    </FeedSection>
  )
}

/**
 * What sits under the start box on Home and New thread: a glance, most actionable first. Agents and recaps that need
 * you, agents still working, the latest learned summary and upcoming schedules, each capped, with the rest in Inbox.
 */
export function HomeFeed() {
  useLanguage()
  const ws = useWorkspace()
  const { groups, error } = useAgentOverview()
  const recaps = useRecaps()
  const waiting = rowsOf(groups, 'Waiting for your input')
  const running = rowsOf(groups, 'Running', 'Waiting for allowance')
  const inboxCount = waiting.length + recaps.attention.length + recaps.sinceVisit.length
  return (
    <div className="home-feed home-agents m-[0_auto] flex w-full max-w-[760px] flex-col gap-6 pt-2">
      {error && (
        <p role="alert" className="text-bad small text-caption">
          {String(error)}
        </p>
      )}
      {waiting.length > 0 && (
        <FeedSection title={t('Waiting for your input')} count={waiting.length}>
          <AgentList items={waiting.slice(0, GLANCE)} />
          <ViewAll count={waiting.length} tab="needs-you" />
        </FeedSection>
      )}
      {recaps.attention.length > 0 && (
        <FeedSection title={t('Needs your attention')} count={recaps.attention.length}>
          {recaps.attention.slice(0, GLANCE).map((item) => (
            <RecapCard key={item.id} item={item} attention act={recaps.act} />
          ))}
          <ViewAll count={recaps.attention.length} tab="needs-you" />
        </FeedSection>
      )}
      {running.length > 0 && (
        <FeedSection title={t('Running in the background')} count={running.length} label={t('Running')}>
          <AgentList items={running.slice(0, GLANCE)} />
          <ViewAll count={running.length} tab="running" />
        </FeedSection>
      )}
      <LearnedCard />
      <Upcoming />
      <footer className="flex items-center gap-2 pb-2">
        <BackgroundControls compact />
        <span className="min-w-0 flex-1" />
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground small text-caption"
          onClick={() => openInbox(ws, recaps.sinceVisit.length && !waiting.length ? 'recaps' : undefined)}
        >
          <Inbox size={13} />
          {t('Open inbox')}
          {inboxCount > 0 && <span className="tabular-nums"> · {inboxCount}</span>}
        </Button>
        {recaps.enabled && (
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground"
            aria-label={t('Refresh recap')}
            title={
              recaps.recap?.generating
                ? t('Updating recap…')
                : recaps.recap?.generatedAt
                  ? t('Daily recap updated {0}', { '0': DateTime.fromMillis(recaps.recap.generatedAt).toRelative() })
                  : t('Preparing your first recap')
            }
            disabled={recaps.recap?.generating}
            onClick={() => void recaps.refresh()}
          >
            <RefreshCw size={13} />
          </Button>
        )}
      </footer>
    </div>
  )
}
