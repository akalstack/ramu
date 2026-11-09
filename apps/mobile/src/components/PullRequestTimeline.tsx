import { useMemo, useState } from 'react'
import { Linking, Pressable, View } from 'react-native'
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
  Upload,
  UserPlus,
} from 'lucide-react-native'
import type { PullRequestTimelineEvent } from '@ramu/shared/types'
import {
  TIMELINE_RECENT,
  TIMELINE_SAID,
  TIMELINE_VERDICT,
  timelineEntries,
  type TimelineEntry,
} from '@ramu/shared/pullRequestTimeline'
import { font, space, useTheme } from '../theme'
import { ago, useSay } from '../i18n'
import { Button, T } from './ui'

function EventIcon({ event }: { event: PullRequestTimelineEvent }) {
  const { c } = useTheme()
  if (event.kind === 'review')
    return event.verdict === 'approved' ? (
      <CircleCheck size={14} color={c.ok} />
    ) : event.verdict === 'changes-requested' ? (
      <CircleX size={14} color={c.warn} />
    ) : (
      <CircleDot size={14} color={c.muted} />
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
  return <Icon size={14} color={event.kind === 'merged' ? c.accent : event.kind === 'closed' ? c.bad : c.muted} />
}

/** When it happened; with a link, it opens the event on the service, as the desktop's does. */
function When({ event }: { event: PullRequestTimelineEvent }) {
  const say = useSay()
  const label = ago(event.at)
  if (!event.url)
    return (
      <T size={font.caption} tone="placeholder">
        {label}
      </T>
    )
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${label} · ${say('Open on the hosting service')}`}
      hitSlop={8}
      onPress={() => void Linking.openURL(event.url!).catch(() => {})}
    >
      <T size={font.caption} tone="placeholder" style={{ textDecorationLine: 'underline' }}>
        {label}
      </T>
    </Pressable>
  )
}

/** One rail row: the event's icon on the line, then what happened and when. */
function Rail({ icon, children, when }: { icon: React.ReactNode; children: React.ReactNode; when?: React.ReactNode }) {
  const { c } = useTheme()
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: space.s,
        borderLeftWidth: 1,
        borderLeftColor: c.line,
        paddingLeft: space.m,
        paddingVertical: 6,
      }}
    >
      <View style={{ paddingTop: 2 }}>{icon}</View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>{children}</View>
      {when}
    </View>
  )
}

function EventRow({ event }: { event: PullRequestTimelineEvent }) {
  const say = useSay()
  return (
    <Rail icon={<EventIcon event={event} />} when={<When event={event} />}>
      <T size={font.caption}>
        {`${event.actor ?? say('Someone')} `}
        <T size={font.caption} tone="muted">
          {event.kind === 'review' && event.verdict
            ? say(TIMELINE_VERDICT[event.verdict])
            : say(TIMELINE_SAID[event.kind], { 0: event.text ?? '' })}
        </T>
      </T>
      {event.text && event.kind !== 'review-requested' ? (
        <T size={font.caption} tone="soft" numberOfLines={2}>
          {event.text}
        </T>
      ) : null}
    </Rail>
  )
}

/** A run of commits as one row that opens to each commit's message. */
function CommitsRow({ entry }: { entry: Extract<TimelineEntry, { kind: 'commits' }> }) {
  const say = useSay()
  const { c } = useTheme()
  const [open, setOpen] = useState(false)
  if (entry.events.length === 1) return <EventRow event={entry.events[0]!} />
  return (
    <Rail icon={<GitCommitHorizontal size={14} color={c.muted} />} when={<When event={entry.events.at(-1)!} />}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
      >
        <T size={font.caption}>
          {`${entry.actor ?? say('Someone')} `}
          <T size={font.caption} tone="muted">
            {say('added {0} commits', { 0: entry.events.length })}
          </T>
        </T>
        <ChevronRight size={12} color={c.muted} style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }} />
      </Pressable>
      {open
        ? entry.events.map((event, index) => (
            <T key={`${event.at}:${index}`} size={font.caption} tone="soft" numberOfLines={1}>
              {event.text ?? say('committed')}
            </T>
          ))
        : null}
    </Rail>
  )
}

/**
 * What happened on the pull request, as the desktop's timeline: the latest few rows with the rest a tap away, and
 * runs of commits read as one push.
 */
export function PullRequestTimeline({ timeline }: { timeline: PullRequestTimelineEvent[] }) {
  const say = useSay()
  const { c } = useTheme()
  const [all, setAll] = useState(false)
  const rows = useMemo(() => timelineEntries(timeline), [timeline])
  if (!timeline.length) return null
  const hidden = all ? 0 : Math.max(0, rows.length - TIMELINE_RECENT)
  return (
    <View style={{ gap: space.xs }}>
      <T size={font.control} weight="600" tone="muted">
        {say('Timeline')}{' '}
        <T size={font.control} tone="placeholder">
          {String(timeline.length)}
        </T>
      </T>
      <View>
        {hidden > 0 ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setAll(true)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.xs,
              minHeight: 32,
              borderLeftWidth: 1,
              borderLeftColor: c.line,
              paddingLeft: space.m,
            }}
          >
            <ChevronsUp size={14} color={c.muted} />
            <T size={font.caption} tone="accent">
              {say('Show {0} earlier', { 0: hidden })}
            </T>
          </Pressable>
        ) : null}
        {rows
          .slice(hidden)
          .map((entry, index) =>
            entry.kind === 'commits' ? (
              <CommitsRow key={`commits:${entry.events[0]!.at}:${index}`} entry={entry} />
            ) : (
              <EventRow key={`${entry.event.kind}:${entry.event.at}:${index}`} event={entry.event} />
            ),
          )}
      </View>
      {all && rows.length > TIMELINE_RECENT ? (
        <Button
          kind="ghost"
          title={say('Show only the latest')}
          onPress={() => setAll(false)}
          style={{ alignSelf: 'flex-start' }}
        />
      ) : null}
    </View>
  )
}
