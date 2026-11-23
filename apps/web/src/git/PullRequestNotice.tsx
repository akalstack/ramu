import type { ReactNode } from 'react'
import { ChevronDown, X } from 'lucide-react'
import { Button } from '@/components/desktop-button'
import { RowButton } from '@/components/row-button'
import { cn } from 'cn'
import { readFailure, readFailureKey } from '@ramu/shared/pullRequestAccess'
import { FORGE_NAMES } from '@ramu/shared/pullRequests'
import type { ForgeService } from '@ramu/shared/types'
import { t } from '../i18n'

type NoticeTone = 'muted' | 'warn' | 'bad'

const TONE_ICON: Record<NoticeTone, string> = {
  muted: 'text-muted-foreground',
  warn: 'text-warn',
  bad: 'text-bad',
}

// A tinted edge says how urgent it is; the text stays in the normal colours so a long message is still easy to read.
const TONE_CARD: Record<NoticeTone, string> = {
  muted: 'border-(--line) bg-card',
  warn: 'border-warn/30 bg-card',
  bad: 'border-bad/35 bg-card',
}

/**
 * One notice on the Pull requests page or in a pull request: an icon, a one-line title with a muted detail under it, its
 * actions, and optionally details that open below and a control that hides it. Every notice there uses this card, so
 * an offline host, a failed read and a missing sign-in look like one family and stay compact above the list.
 */
export function PullRequestNotice({
  tone = 'muted',
  icon,
  title,
  detail,
  actions,
  expanded = false,
  onToggle,
  onDismiss,
  live = false,
  wrap = false,
  children,
  className,
}: {
  tone?: NoticeTone
  icon: ReactNode
  title: string
  detail?: ReactNode
  actions?: ReactNode
  expanded?: boolean
  /** Given when the notice has details to open. */
  onToggle?: () => void
  /** Given when the notice can be hidden. */
  onDismiss?: () => void
  /** Announces the notice when it appears, for results of the person's own action. */
  live?: boolean
  /** Lets the title and detail run onto more lines, for a message that must be read whole. */
  wrap?: boolean
  children?: ReactNode
  className?: string
}) {
  const text = (
    <>
      <span
        className={cn(
          'block w-full text-caption font-medium text-foreground',
          wrap ? 'whitespace-pre-wrap [overflow-wrap:anywhere]' : 'truncate',
        )}
      >
        {title}
      </span>
      {detail && (
        <span
          className={cn(
            'block w-full text-caption text-muted-foreground',
            wrap ? 'whitespace-pre-wrap [overflow-wrap:anywhere]' : 'truncate',
          )}
        >
          {detail}
        </span>
      )}
    </>
  )
  return (
    <section
      aria-label={title}
      role={live ? 'status' : undefined}
      className={cn('rounded-(--radius-m) border', TONE_CARD[tone], className)}
    >
      <div className="flex min-h-9 min-w-0 items-center gap-2 py-1 pr-1.5 pl-2.5">
        <span className={cn('flex size-4 flex-none items-center justify-center', TONE_ICON[tone])} aria-hidden="true">
          {icon}
        </span>
        {onToggle ? (
          <RowButton
            stacked
            className="min-h-0 flex-1 p-0 hover:bg-transparent"
            aria-expanded={expanded}
            onClick={onToggle}
          >
            {text}
          </RowButton>
        ) : (
          <div className="flex min-w-0 flex-1 flex-col items-start gap-0.5">{text}</div>
        )}
        {actions && <div className="flex flex-none items-center gap-1">{actions}</div>}
        {onToggle && (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={expanded ? t('Hide details') : t('Show details')}
            title={expanded ? t('Hide details') : t('Show details')}
            aria-expanded={expanded}
            onClick={onToggle}
          >
            <ChevronDown
              size={13}
              className={cn('transition-transform motion-reduce:transition-none', expanded && 'rotate-180')}
            />
          </Button>
        )}
        {onDismiss && (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t('Hide this notice')}
            title={t('Hide this notice')}
            onClick={onDismiss}
          >
            <X size={13} />
          </Button>
        )}
      </div>
      {expanded && children && (
        <div className="flex flex-col gap-2.5 border-t border-(--line) px-2.5 py-2">{children}</div>
      )}
    </section>
  )
}

/** A failure's own words, kept for whoever needs them but quieter than the explanation above it. */
export function RawError({ children }: { children: string }) {
  return (
    <code className="block max-h-24 overflow-auto rounded-(--radius-xs) bg-fill px-1.5 py-1 font-mono text-micro leading-4 whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">
      {children}
    </code>
  )
}

/** What a failed read from a hosting service means for the person, in place of the client's raw message. */
export const readFailureText = (error: string, service: ForgeService) =>
  t(readFailureKey(readFailure(error)), { '0': FORGE_NAMES[service] })
