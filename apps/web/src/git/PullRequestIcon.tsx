import { GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft } from 'lucide-react'
import type { PullRequestStage, PullRequestSummary } from '@ramu/shared/types'
import {
  PULL_REQUEST_STAGE_LABEL,
  PULL_REQUEST_STAGE_TONE,
  pullRequestGlyph,
  type PullRequestTone,
} from '@ramu/shared/pullRequests'
import { cn } from 'cn'
import { t } from '../i18n'

const TONE_TEXT: Record<PullRequestTone, string> = {
  ok: 'text-ok',
  warn: 'text-warn',
  bad: 'text-bad',
  muted: 'text-muted-foreground',
  accent: 'text-brand',
}

const TONE_FILL: Record<PullRequestTone, string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  bad: 'bg-bad',
  muted: 'bg-muted-foreground',
  accent: 'bg-brand',
}

const GLYPHS = {
  open: GitPullRequest,
  draft: GitPullRequestDraft,
  merged: GitMerge,
  closed: GitPullRequestClosed,
}

/** The colour of the pull request's shape: open, draft, merged and closed, as the hosting services draw them. */
const GLYPH_TONE: Record<keyof typeof GLYPHS, PullRequestTone> = {
  open: 'ok',
  draft: 'muted',
  merged: 'accent',
  closed: 'bad',
}

export const stageLabel = (stage: PullRequestStage) => t(PULL_REQUEST_STAGE_LABEL[stage])

/**
 * A pull request's shape in its state colour, with a dot when its stage needs attention (failing checks, conflicts,
 * replies ready), so a row says both what it is and what it is waiting on.
 */
export function PullRequestIcon({
  pr,
  stage,
  size = 13,
  className,
}: {
  pr: Pick<PullRequestSummary, 'state' | 'draft'>
  stage?: PullRequestStage
  size?: number
  className?: string
}) {
  const glyph = pullRequestGlyph(pr)
  const Icon = GLYPHS[glyph]
  const tone = stage ? PULL_REQUEST_STAGE_TONE[stage] : null
  const dot = pr.state === 'open' && tone && (tone === 'bad' || tone === 'warn' || stage === 'agent-working')
  return (
    <span className={cn('relative inline-flex flex-none', className)}>
      <Icon size={size} className={TONE_TEXT[GLYPH_TONE[glyph]]} aria-hidden="true" />
      {dot && (
        <span
          className={cn(
            'absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full ring-1 ring-(--surface,var(--background))',
            TONE_FILL[tone],
          )}
          aria-hidden="true"
        />
      )}
    </span>
  )
}

/** The stage as a small coloured label, for lists and headers. */
export function StageChip({ stage, className }: { stage: PullRequestStage; className?: string }) {
  return (
    <span className={cn('flex-none text-caption', TONE_TEXT[PULL_REQUEST_STAGE_TONE[stage]], className)}>
      {stageLabel(stage)}
    </span>
  )
}
