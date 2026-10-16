import { Button } from '@/components/desktop-button'
import { Sparkles } from 'lucide-react'
import { DateTime } from 'luxon'
import { t, useLanguage } from '../i18n'
import { openSummary } from './openSummary'
import { homeSummary, unreadCount } from './summaryLogic'
import { useSummaries } from './useSummaries'
import { useAppSettings } from '../settings/AppSettings'
import { FeedSection } from '../HomeSection'

/** The latest "What Ramu learned" on Home: a short summary with an unread dot. Hidden when there is nothing to show. */
export function LearnedCard() {
  useLanguage()
  const { preferences } = useAppSettings()
  const { snapshot } = useSummaries()
  const summary = homeSummary(snapshot, preferences.intelligence)
  if (!summary || !snapshot) return null
  const unread = unreadCount([summary]) > 0
  return (
    <FeedSection title={t('What Ramu learned')} className="learned-card">
      <Button
        variant="secondary"
        className="bg-card hover:bg-card-hover h-auto w-full flex-col items-start gap-1 rounded-(--radius-m) p-4 text-left font-normal whitespace-normal"
        onClick={() => openSummary(summary.id)}
      >
        <span className="flex w-full items-center gap-2 text-caption text-muted-foreground">
          <Sparkles size={12} />
          <span>{DateTime.fromMillis(summary.periodEnd).toRelative()}</span>
          <span className="grow" />
          {unread && (
            <span
              role="img"
              aria-label={t('Unread')}
              className="unread-dot inline-block size-2 rounded-full bg-[var(--accent)]"
            />
          )}
        </span>
        <span className="text-body leading-[1.5] text-foreground">{summary.headline}</span>
        <span className="text-caption text-muted-foreground">
          {t('{0} changes', { 0: summary.items.length })}
          {summary.chatIds.length > 0 ? ` · ${t('Discussed in thread')}` : ''}
        </span>
      </Button>
    </FeedSection>
  )
}
