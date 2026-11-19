import type { ReactElement, ReactNode } from 'react'
import {
  CircleAlert,
  GitMerge,
  GitPullRequest,
  KeyRound,
  MemoryStick,
  MessageCircleQuestion,
  Newspaper,
  ShieldCheck,
  Target,
} from 'lucide-react'
import type { BriefMark, BriefTone, InboxTab } from '@ramu/shared/hostInbox'
import type { ComputerStatus } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { RowButton } from '@/components/row-button'
import { HoverCard, HoverCardTrigger } from '@/components/ui/hover-card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DateTime } from 'luxon'
import { t } from '../i18n'
import { timeAgo } from '../Menu'
import { StatusDot, statusText } from '../workspace/computers'

/** The Inbox tabs, one look for one host and for many: a line under the active tab and a quiet count pill. */
export function InboxTabsList({ tabs }: { tabs: { id: InboxTab; label: string; count: number }[] }) {
  return (
    <TabsList variant="line" className="h-9! w-full justify-start gap-5 border-b border-(--line) p-0">
      {tabs.map((entry) => (
        <TabsTrigger key={entry.id} value={entry.id} className="flex-none gap-1.5 px-0.5 text-control">
          {entry.label}
          {entry.count > 0 && (
            <span className="min-w-4 rounded-full bg-fill px-1.5 text-[11px] leading-4 text-muted-foreground tabular-nums">
              {entry.count}
            </span>
          )}
        </TabsTrigger>
      ))}
    </TabsList>
  )
}

/** An empty tab: what will show up here and where it comes from. */
export function InboxEmpty({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
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

/** One line for a host whose activity is stale or incomplete, with the way back when there is one. */
export function HostNotice({
  name,
  status,
  stale,
  failed,
  onRetry,
}: {
  name: string
  status: ComputerStatus
  /** What is shown is the last activity seen before the host went away. */
  stale: boolean
  /** The host answered, but some of its activity could not be loaded. */
  failed: boolean
  onRetry?: () => void
}) {
  return (
    <div role="status" className="flex min-h-6 items-center gap-2 text-caption text-muted-foreground">
      <StatusDot status={status} />
      <span className="text-soft">{name}</span>
      <span className="min-w-0 flex-1 truncate">
        {failed
          ? t('Some host activity could not be loaded.')
          : [statusText(status), stale ? t('Showing last known activity') : ''].filter(Boolean).join(' · ')}
      </span>
      {onRetry && (
        <Button variant="ghost" size="xs" onClick={onRetry}>
          {t('Retry')}
        </Button>
      )}
    </div>
  )
}

const MARK: Record<BriefMark, typeof CircleAlert> = {
  failed: CircleAlert,
  conflicts: GitMerge,
  'pull-request': GitPullRequest,
  approval: ShieldCheck,
  question: MessageCircleQuestion,
  connector: KeyRound,
  goal: Target,
  memory: MemoryStick,
  recap: Newspaper,
}
const TONE: Record<BriefTone, string> = {
  bad: 'bg-(--bad-wash) text-bad',
  warn: 'bg-(--warn-wash) text-warn',
  neutral: 'bg-fill text-muted-foreground',
}
export const TONE_TEXT: Record<BriefTone, string> = {
  bad: 'text-bad',
  warn: 'text-warn',
  neutral: 'text-muted-foreground',
}

/** The round mark that starts every Inbox row: what it is, tinted by how much it asks of you. */
export function InboxMark({ tone = 'neutral', children }: { tone?: BriefTone | 'ok'; children: ReactNode }) {
  return (
    <span
      aria-hidden
      className={`grid size-8 flex-none place-items-center rounded-full [&_svg]:size-[15px] ${tone === 'ok' ? 'bg-(--ok-wash) text-(--ok)' : TONE[tone]}`}
    >
      {children}
    </span>
  )
}

/** What kind of thing a Brief row asks for, at a glance. */
export function BriefMarkIcon({ mark, tone }: { mark: BriefMark; tone: BriefTone }) {
  const Icon = MARK[mark]
  return (
    <InboxMark tone={tone}>
      <Icon />
    </InboxMark>
  )
}

/** Rows of one tab or section, in a single flat card. */
export function InboxList({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div
      aria-label={label}
      className="@container flex flex-col divide-y divide-(--line) overflow-hidden rounded-(--radius-m) bg-card"
    >
      {children}
    </div>
  )
}

/**
 * Every Inbox row, on every tab: a mark, the title over one line of details, and the age (or a state) at the far
 * right. The row opens what it is about; `actions` sit beside it and `children` (an answer form) under it.
 */
export function InboxRow({
  mark,
  title,
  meta,
  wrapMeta = false,
  at,
  trailing,
  onOpen,
  disabled = false,
  actions,
  actionsOnHover = false,
  hoverCard,
  label,
  children,
}: {
  mark: ReactNode
  title: ReactNode
  meta?: ReactNode
  /** Let the details run to two lines, for rows whose details are a sentence (recaps). */
  wrapMeta?: boolean
  /** When it last changed; shown as its age unless `trailing` replaces it. */
  at?: number
  trailing?: ReactNode
  onOpen: () => void
  disabled?: boolean
  /** Actions shown beside the row. */
  actions?: ReactNode
  /** Show the actions only while the row is hovered or focused, so quiet lists stay quiet. */
  actionsOnHover?: boolean
  /** A preview card shown while hovering the row. */
  hoverCard?: ReactElement | false | null
  label?: string
  children?: ReactNode
}) {
  const content = (
    <>
      {mark}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-foreground">{title}</span>
        {meta && (
          <span
            className={`block text-caption text-muted-foreground ${wrapMeta ? 'line-clamp-2 leading-[1.45]' : 'truncate'}`}
          >
            {meta}
          </span>
        )}
      </span>
      {trailing ?? (
        <span className="min-w-6 flex-none text-right text-caption text-muted-foreground tabular-nums">
          {at ? timeAgo(at) : ''}
        </span>
      )}
    </>
  )
  const buttonProps = {
    size: 'lg' as const,
    className: 'min-w-60 flex-1 basis-60 rounded-none px-3 py-2.5 hover:bg-transparent! focus-visible:bg-hover',
    disabled,
    focusableWhenDisabled: true,
    'aria-disabled': disabled,
    'aria-label': label,
    onClick: () => !disabled && onOpen(),
  }
  return (
    <article className="group/row flex flex-col transition-colors hover:bg-hover" data-thread-motion-row="">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        {hoverCard ? (
          <HoverCard>
            <HoverCardTrigger render={<RowButton {...buttonProps} />} delay={400} closeDelay={120}>
              {content}
            </HoverCardTrigger>
            {hoverCard}
          </HoverCard>
        ) : (
          <RowButton {...buttonProps}>{content}</RowButton>
        )}
        {actions && (
          <div
            className={`flex-none flex-wrap items-center gap-1.5 pr-3 ${actionsOnHover ? 'hidden group-focus-within/row:flex group-hover/row:flex' : 'flex'}`}
          >
            {actions}
          </div>
        )}
      </div>
      {children && <div className="px-3 pb-3 pl-14">{children}</div>}
    </article>
  )
}

/** Items split into Today, Yesterday and Earlier by when they last changed, dropping empty days. */
export function byDay<T>(items: T[], at: (item: T) => number): { label: string; items: T[] }[] {
  const today = DateTime.now().startOf('day').toMillis()
  const yesterday = today - 86_400_000
  return [
    { label: t('Today'), items: items.filter((item) => at(item) >= today) },
    { label: t('Yesterday'), items: items.filter((item) => at(item) >= yesterday && at(item) < today) },
    { label: t('Earlier'), items: items.filter((item) => at(item) < yesterday) },
  ].filter((day) => day.items.length)
}
