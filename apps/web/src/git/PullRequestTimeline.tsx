import { useMemo, useState } from 'react'
import { keptPullRequestRead } from './keptPullRequests'
import { useQuery } from '@tanstack/react-query'
import {
  ChevronRight,
  ChevronsUp,
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
import {
  TIMELINE_RECENT as RECENT,
  TIMELINE_SAID as SAID,
  TIMELINE_VERDICT as VERDICT,
  timelineEntries as entries,
  type TimelineEntry as Entry,
} from '@ramu/shared/pullRequestTimeline'
import { cn } from 'cn'
import { t } from '../i18n'
import { timeAgo } from '../Menu'
import { ipcQueryKeyOn } from '../dataQueries'
import { useHost } from '../workspace/HostProvider'
import { invoke as openOnThisComputer } from '../ipc'
import { queryInvokerFor } from './hostQuery'

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

function When({ event }: { event: PullRequestTimelineEvent }) {
  return event.url ? (
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
  )
}

function EventRow({ event }: { event: PullRequestTimelineEvent }) {
  return (
    <li className="flex min-w-0 items-start gap-2.5 border-l border-line py-1.5 pr-1 pl-3 text-caption">
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
      <When event={event} />
    </li>
  )
}

/** A run of commits as one row that opens to each commit's message. */
function CommitsRow({ entry }: { entry: Extract<Entry, { kind: 'commits' }> }) {
  const [open, setOpen] = useState(false)
  if (entry.events.length === 1) return <EventRow event={entry.events[0]!} />
  const latest = entry.events.at(-1)!
  return (
    <li className="flex min-w-0 flex-col border-l border-line py-1.5 pr-1 pl-3 text-caption">
      <div className="flex min-w-0 items-start gap-2.5">
        <GitCommitHorizontal size={13} className="mt-0.5 flex-none text-muted-foreground" aria-hidden />
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={open}
          className="h-auto min-w-0 flex-1 justify-start gap-1 bg-transparent p-0 text-left text-caption font-normal hover:bg-transparent"
          onClick={() => setOpen((value) => !value)}
        >
          <span className="text-foreground">{entry.actor ?? t('Someone')}</span>
          <span className="text-muted-foreground">{t('added {0} commits', { '0': entry.events.length })}</span>
          <ChevronRight
            size={12}
            className={cn('flex-none text-muted-foreground transition-transform', open && 'rotate-90')}
          />
        </Button>
        <When event={latest} />
      </div>
      {open && (
        <ol className="m-0 mt-1 flex list-none flex-col gap-0.5 p-0 pl-[23px]">
          {entry.events.map((event, index) => (
            <li key={`${event.at}:${index}`} className="flex min-w-0 items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate text-soft" title={event.text}>
                {event.text ?? t('Commit')}
              </span>
              <When event={event} />
            </li>
          ))}
        </ol>
      )}
    </li>
  )
}

/**
 * The pull request's history in order (commits, reviews and their verdicts, comments, review requests, force pushes,
 * merges and closes). A long history opens on its latest events with the earlier ones a click away, and a run of
 * commits reads as one push, so what happened since the last look is one glance away.
 */
export function PullRequestTimeline({ taskId, repoId, url }: { taskId: string; repoId: string; url: string }) {
  const host = useHost()
  const call = queryInvokerFor(host.id)
  const [all, setAll] = useState(false)
  const timeline = useQuery({
    queryKey: ipcQueryKeyOn(host.id, 'forge.pullRequestTimeline', taskId, repoId, url),
    queryFn: () => call('forge.pullRequestTimeline', taskId, repoId, url),
    ...keptPullRequestRead(host.id, 'forge.pullRequestTimeline', taskId, repoId, url),
    staleTime: 60_000,
  })
  const rows = useMemo(() => entries(timeline.data ?? []), [timeline.data])
  if (!timeline.data?.length) return null
  const hidden = all ? 0 : Math.max(0, rows.length - RECENT)
  return (
    <section className="flex flex-col gap-2">
      <h3 className="m-0 flex items-baseline gap-1.5 text-control font-semibold">
        {t('Timeline')}
        <span className="font-normal text-muted-foreground">{timeline.data.length}</span>
      </h3>
      <ol className="m-0 flex list-none flex-col p-0">
        {hidden > 0 && (
          <li className="border-l border-line py-1 pl-1.5">
            <Button variant="ghost" size="sm" className="h-7 px-2 text-caption" onClick={() => setAll(true)}>
              <ChevronsUp size={13} />
              {t('Show {0} earlier', { '0': hidden })}
            </Button>
          </li>
        )}
        {rows
          .slice(hidden)
          .map((entry, index) =>
            entry.kind === 'commits' ? (
              <CommitsRow key={`commits:${entry.events[0]!.at}:${index}`} entry={entry} />
            ) : (
              <EventRow key={`${entry.event.kind}:${entry.event.at}:${index}`} event={entry.event} />
            ),
          )}
      </ol>
      {all && rows.length > RECENT && (
        <Button variant="ghost" size="sm" className="h-7 self-start px-2 text-caption" onClick={() => setAll(false)}>
          {t('Show only the latest')}
        </Button>
      )}
    </section>
  )
}
