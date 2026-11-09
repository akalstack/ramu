import type { ReactNode } from 'react'
import { CircleCheck, CircleDot, CircleX, GitMerge, MessageSquare, Users } from 'lucide-react'
import { Button } from '@/components/desktop-button'
import type { PullRequestSummary } from '@ramu/shared/types'
import type { PullRequestNextStep } from '@ramu/shared/pullRequests'
import { cn } from 'cn'
import { t } from '../i18n'

type Tone = 'ok' | 'warn' | 'bad' | 'muted'

const TONE: Record<Tone, string> = {
  ok: 'text-ok',
  warn: 'text-warn',
  bad: 'text-bad',
  muted: 'text-muted-foreground',
}

/** The action each next step offers, with its English copy key; waiting steps offer none and only say why. */
const ACTION: Partial<Record<PullRequestNextStep, string>> = {
  merge: 'Merge…',
  'fix-checks': 'Fix failing checks',
  'resolve-conflicts': 'Resolve conflicts',
  'update-branch': 'Update branch',
  'address-comments': 'Address review comments',
  'mark-ready': 'Ready for review',
  review: 'Review with agent',
}

const WAITING: Partial<Record<PullRequestNextStep, string>> = {
  'send-replies': 'Replies are drafted below, waiting for you to check and send them.',
  'wait-checks': 'Waiting for checks to finish.',
  'wait-review': 'Waiting for a review.',
  'wait-agent': 'An agent is working on the feedback.',
}

function Row({ tone, icon, children }: { tone: Tone; icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex min-w-0 items-center gap-2.5 py-1.5 text-control">
      <span className={cn('flex flex-none', TONE[tone])}>{icon}</span>
      <span className="min-w-0 flex-1 text-soft">{children}</span>
    </li>
  )
}

/**
 * Where a pull request stands before anything else, as GitHub's Overview page leads with it: checks, reviews, whether
 * it merges cleanly and what is still unresolved, then the one thing to do next.
 */
export function PullRequestReadiness({
  pr,
  openThreads,
  step,
  busy,
  onStep,
}: {
  pr: PullRequestSummary
  openThreads: number
  step: PullRequestNextStep
  busy: boolean
  onStep: (step: PullRequestNextStep) => void
}) {
  if (pr.state !== 'open') return null
  const checks =
    pr.checks === 'success'
      ? { tone: 'ok' as const, text: t('All checks passed'), icon: <CircleCheck size={15} /> }
      : pr.checks === 'failure'
        ? { tone: 'bad' as const, text: t('Checks failing'), icon: <CircleX size={15} /> }
        : pr.checks === 'pending'
          ? { tone: 'warn' as const, text: t('Checks running'), icon: <CircleDot size={15} /> }
          : { tone: 'muted' as const, text: t('No checks'), icon: <CircleDot size={15} /> }
  const review =
    pr.reviewDecision === 'approved'
      ? { tone: 'ok' as const, text: t('Approved') }
      : pr.reviewDecision === 'changes-requested'
        ? { tone: 'warn' as const, text: t('Changes requested') }
        : {
            tone: 'muted' as const,
            text: pr.requestedReviewers.length
              ? t('Review requested from {0}', { '0': pr.requestedReviewers.join(', ') })
              : t('Waiting on review'),
          }
  const merge =
    pr.mergeable === 'conflicts'
      ? { tone: 'bad' as const, text: t('Has conflicts with its base branch') }
      : pr.mergeable === 'behind'
        ? { tone: 'warn' as const, text: t('Behind its base branch') }
        : pr.mergeable === 'blocked'
          ? { tone: 'warn' as const, text: t('Blocked by the branch rules') }
          : pr.mergeable === 'clean'
            ? { tone: 'ok' as const, text: t('No conflicts with its base branch') }
            : { tone: 'muted' as const, text: t('Mergeability not known yet') }
  const action = ACTION[step]
  const waiting = WAITING[step]
  return (
    <section
      aria-label={t('Readiness')}
      className="flex flex-col gap-2 rounded-(--radius-m) border border-line bg-card px-4 py-3"
    >
      <ul className="m-0 flex list-none flex-col p-0">
        <Row tone={checks.tone} icon={checks.icon}>
          {checks.text}
        </Row>
        <Row tone={review.tone} icon={<Users size={15} />}>
          {review.text}
        </Row>
        <Row tone={merge.tone} icon={<GitMerge size={15} />}>
          {merge.text}
        </Row>
        <Row tone={openThreads ? 'warn' : 'ok'} icon={<MessageSquare size={15} />}>
          {openThreads ? t('{0} unresolved conversations', { '0': openThreads }) : t('All conversations resolved')}
        </Row>
      </ul>
      {(action || waiting) && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-2.5">
          {waiting && <span className="text-caption text-muted-foreground">{t(waiting)}</span>}
          {action && (
            <Button size="sm" className="ml-auto" disabled={busy} onClick={() => onStep(step)}>
              {t(action)}
            </Button>
          )}
        </div>
      )}
    </section>
  )
}
