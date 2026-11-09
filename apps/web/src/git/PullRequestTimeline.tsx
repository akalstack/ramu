import { useQuery } from '@tanstack/react-query'
import {
  CircleCheck,
  CircleDot,
  CircleX,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequestClosed,
  MessageSquare,
  RotateCcw,
  UserPlus,
  Upload,
} from 'lucide-react'
import { Button } from '@/components/desktop-button'
import type { PullRequestTimelineEvent } from '@ramu/shared/types'
import { cn } from 'cn'
import { t } from '../i18n'
import { timeAgo } from '../Menu'
import { ipcQueryKeyOn } from '../dataQueries'
import { useHost } from '../workspace/HostProvider'
import { invoke as openOnThisComputer } from '../ipc'
import { queryInvokerFor } from './hostQuery'

/** What each event says after its actor, as English copy keys. */
const SAID: Record<PullRequestTimelineEvent['kind'], string> = {
  commit: 'committed',
  review: 'reviewed',
  comment: 'commented',
  'review-requested': 'asked for a review from {0}',
  'force-pushed': 'force-pushed the branch',
  ready: 'marked it ready for review',
  merged: 'merged it',
  closed: 'closed it',
  reopened: 'reopened it',
}

const VERDICT: Record<NonNullable<PullRequestTimelineEvent['verdict']>, string> = {
  approved: 'approved',
  'changes-requested': 'requested changes',
  commented: 'reviewed',
  dismissed: 'had a review dismissed',
}

function EventIcon({ event }: { event: PullRequestTimelineEvent }) {
  const props = { size: 13, className: 'mt-0.5 flex-none', 'aria-hidden': true }
  if (event.kind === 'review')
    return event.verdict === 'approved' ? (
      <CircleCheck {...props} className={cn(props.className, 'text-ok')} />
    ) : event.verdict === 'changes-requested' ? (
      <CircleX {...props} className={cn(props.className, 'text-warn')} />
    ) : (
      <CircleDot {...props} className={cn(props.className, 'text-muted-foreground')} />
    )
  const Icon = {
    commit: GitCommitHorizontal,
    comment: MessageSquare,
    'review-requested': UserPlus,
    'force-pushed': Upload,
    ready: CircleDot,
    merged: GitMerge,
    closed: GitPullRequestClosed,
    reopened: RotateCcw,
  }[event.kind]
  return (
    <Icon
      {...props}
      className={cn(
        props.className,
        event.kind === 'merged' ? 'text-brand' : event.kind === 'closed' ? 'text-bad' : 'text-muted-foreground',
      )}
    />
  )
}

/**
 * The pull request's latest history in order (commits, reviews and their verdicts, comments, review requests, force
 * pushes, merges and closes), so what happened since the last look is one glance away.
 */
export function PullRequestTimeline({ taskId, repoId, url }: { taskId: string; repoId: string; url: string }) {
  const host = useHost()
  const call = queryInvokerFor(host.id)
  const timeline = useQuery({
    queryKey: ipcQueryKeyOn(host.id, 'forge.pullRequestTimeline', taskId, repoId, url),
    queryFn: () => call('forge.pullRequestTimeline', taskId, repoId, url),
    staleTime: 60_000,
  })
  const events = timeline.data
  if (!events?.length) return null
  return (
    <section className="flex flex-col gap-2">
      <h3 className="m-0 flex items-baseline gap-1.5 text-control font-semibold">
        {t('Timeline')}
        <span className="font-normal text-muted-foreground">{events.length}</span>
      </h3>
      <ol className="m-0 flex list-none flex-col p-0">
        {events.map((event, index) => (
          <li
            key={`${event.kind}:${event.at}:${index}`}
            className="flex min-w-0 items-start gap-2.5 border-l border-line py-1.5 pr-1 pl-3 text-caption"
          >
            <EventIcon event={event} />
            <div className="min-w-0 flex-1">
              <span className="text-foreground">{event.actor ?? t('Someone')}</span>{' '}
              <span className="text-muted-foreground">
                {event.kind === 'review' && event.verdict
                  ? t(VERDICT[event.verdict])
                  : t(SAID[event.kind], { '0': event.text ?? '' })}
              </span>
              {event.text && event.kind !== 'review-requested' && (
                <div className="truncate text-soft" title={event.text}>
                  {event.text}
                </div>
              )}
            </div>
            {event.url ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-auto flex-none bg-transparent p-0 text-caption font-normal text-muted-foreground hover:bg-transparent hover:text-foreground"
                title={t('Open on the hosting service')}
                onClick={() => void openOnThisComputer('app.openExternal', event.url!)}
              >
                {timeAgo(event.at)}
              </Button>
            ) : (
              <span className="flex-none text-muted-foreground">{timeAgo(event.at)}</span>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}
