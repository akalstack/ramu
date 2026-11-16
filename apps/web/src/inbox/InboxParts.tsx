import type { ReactNode } from 'react'
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
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { TabsList, TabsTrigger } from '@/components/ui/tabs'
import { t } from '../i18n'
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

/** What kind of thing a Brief row asks for, at a glance. */
export function BriefMarkIcon({ mark, tone }: { mark: BriefMark; tone: BriefTone }) {
  const Icon = MARK[mark]
  return (
    <span aria-hidden className={`grid size-8 flex-none place-items-center rounded-full ${TONE[tone]}`}>
      <Icon size={15} />
    </span>
  )
}
