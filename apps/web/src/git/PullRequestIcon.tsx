import {
  Bot,
  CircleCheck,
  CircleDot,
  CircleX,
  Eye,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  MessageSquare,
  MessageSquareReply,
  TriangleAlert,
} from 'lucide-react'
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

const TONE_PILL: Record<PullRequestTone, string> = {
  ok: 'bg-(--ok-wash) text-ok',
  warn: 'bg-(--warn-wash) text-warn',
  bad: 'bg-(--bad-wash) text-bad',
  muted: 'bg-fill text-muted-foreground',
  accent: 'bg-(--accent-wash) text-brand',
}

/** One mark per stage, so the pill reads at a glance even before its words. */
const STAGE_ICON: Record<PullRequestStage, typeof CircleX> = {
  'replies-ready': MessageSquareReply,
  'agent-working': Bot,
  conflicts: TriangleAlert,
  'checks-failing': CircleX,
  'changes-requested': MessageSquare,
  draft: GitPullRequestDraft,
  'checks-pending': CircleDot,
  'review-required': Eye,
  ready: CircleCheck,
  merged: GitMerge,
  closed: GitPullRequestClosed,
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
 * replies ready) or an agent is working on it, so a row says both what it is and what it is waiting on. The dot sits in
 * a gap cut out of the shape rather than on a ring of a guessed background colour, so it reads cleanly on any row,
 * hover or selection.
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
  const working = stage === 'agent-working'
  const dot = pr.state === 'open' && tone && (tone === 'bad' || tone === 'warn' || working) ? tone : null
  // The dot scales with the icon and hangs one pixel past its corner; the gap around it is a fixed 1.5px.
  const diameter = Math.max(5, Math.round(size * 0.42))
  const center = size - diameter / 2 + 1
  const gap = diameter / 2 + 1.5
  const cut = `radial-gradient(circle at ${center}px ${center}px, transparent ${gap}px, black ${gap + 0.5}px)`
  return (
    <span className={cn('relative inline-flex flex-none', className)} style={{ width: size, height: size }}>
      <Icon
        size={size}
        strokeWidth={size <= 14 ? 1.85 : 2}
        className={TONE_TEXT[GLYPH_TONE[glyph]]}
        style={dot ? { maskImage: cut, WebkitMaskImage: cut } : undefined}
        aria-hidden="true"
      />
      {dot && (
        <span
          className={cn('absolute rounded-full', TONE_FILL[dot], working && 'animate-pulse motion-reduce:animate-none')}
          style={{ width: diameter, height: diameter, right: -1, bottom: -1 }}
          aria-hidden="true"
        />
      )}
    </span>
  )
}

/** The stage as a small tinted pill with its mark, the one place a list row or header says where a pull request stands. */
export function StageChip({ stage, className }: { stage: PullRequestStage; className?: string }) {
  const Icon = STAGE_ICON[stage]
  return (
    <span
      className={cn(
        'inline-flex flex-none items-center gap-1 rounded-full px-1.5 text-micro leading-[18px] font-medium whitespace-nowrap',
        TONE_PILL[PULL_REQUEST_STAGE_TONE[stage]],
        className,
      )}
    >
      <Icon size={11} strokeWidth={2.2} aria-hidden="true" />
      {stageLabel(stage)}
    </span>
  )
}
