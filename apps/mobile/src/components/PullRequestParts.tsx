import { View } from 'react-native'
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
} from 'lucide-react-native'
import type { PullRequestStage, PullRequestSummary } from '@ramu/shared/types'
import {
  PULL_REQUEST_STAGE_LABEL,
  PULL_REQUEST_STAGE_TONE,
  pullRequestGlyph,
  type PullRequestTone,
} from '@ramu/shared/pullRequests'
import { font, radius, useTheme } from '../theme'
import { useSay } from '../i18n'
import { T } from './ui'

const GLYPHS = {
  open: GitPullRequest,
  draft: GitPullRequestDraft,
  merged: GitMerge,
  closed: GitPullRequestClosed,
}

/** The shape's colour as the hosting services draw it: open green, draft grey, merged violet, closed red. */
const GLYPH_TONE: Record<keyof typeof GLYPHS, PullRequestTone> = {
  open: 'ok',
  draft: 'muted',
  merged: 'accent',
  closed: 'bad',
}

/**
 * A pull request's shape in its state colour, with a small dot when its stage needs attention (failing checks,
 * conflicts, replies ready) or an agent works on it, as the desktop draws it.
 */
export function PullRequestGlyph({
  pr,
  stage,
  size = 13,
}: {
  pr: Pick<PullRequestSummary, 'state' | 'draft'>
  stage?: PullRequestStage
  size?: number
}) {
  const { c } = useTheme()
  const glyph = pullRequestGlyph(pr)
  const Icon = GLYPHS[glyph]
  const tone = stage ? PULL_REQUEST_STAGE_TONE[stage] : null
  const dot = pr.state === 'open' && tone && (tone === 'bad' || tone === 'warn' || stage === 'agent-working')
  return (
    <View style={{ width: size, height: size }}>
      <Icon size={size} color={c[GLYPH_TONE[glyph]]} strokeWidth={size <= 14 ? 1.85 : 2} />
      {dot ? (
        // The dot scales with the glyph and hangs just past its corner, ringed in the page colour to part it from the shape.
        <View
          style={{
            position: 'absolute',
            right: -1.5,
            bottom: -1.5,
            width: Math.max(6, Math.round(size * 0.46)),
            height: Math.max(6, Math.round(size * 0.46)),
            borderRadius: 99,
            borderWidth: 1.5,
            borderColor: c.window,
            backgroundColor: c[tone],
          }}
        />
      ) : null}
    </View>
  )
}

/** One mark per stage, the same as the desktop's, so the pill reads at a glance. */
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

/** The stage as a small tinted pill with its mark, for rows and headers, as the desktop draws it. */
export function StageText({ stage, size = font.caption }: { stage: PullRequestStage; size?: number }) {
  const say = useSay()
  const { c } = useTheme()
  const tone = PULL_REQUEST_STAGE_TONE[stage]
  const Icon = STAGE_ICON[stage]
  const color = tone === 'muted' ? c.muted : c[tone]
  const wash =
    tone === 'ok'
      ? c.okWash
      : tone === 'warn'
        ? c.warnWash
        : tone === 'bad'
          ? c.badWash
          : tone === 'accent'
            ? c.accentWash
            : c.fill
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 7,
        paddingVertical: 2,
        borderRadius: radius.full,
        backgroundColor: wash,
        flexShrink: 0,
      }}
    >
      <Icon size={size - 1} color={color} strokeWidth={2.2} />
      <T size={size - 1} weight="600" tone={tone} numberOfLines={1}>
        {say(PULL_REQUEST_STAGE_LABEL[stage])}
      </T>
    </View>
  )
}

/** The rolled-up checks as one mark and a word, or nothing when the pull request has no checks. */
export function ChecksLine({ checks, compact }: { checks: PullRequestSummary['checks']; compact?: boolean }) {
  const say = useSay()
  const { c } = useTheme()
  if (!checks) return null
  const [Icon, color, tone, label] =
    checks === 'failure'
      ? ([CircleX, c.bad, 'bad', 'Checks failing'] as const)
      : checks === 'pending'
        ? ([CircleDot, c.warn, 'warn', 'Checks running'] as const)
        : ([CircleCheck, c.ok, 'ok', 'Checks passed'] as const)
  return (
    <View
      accessible
      accessibilityLabel={say(label)}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 }}
    >
      <Icon size={12} color={color} />
      {compact ? null : (
        <T size={font.caption} tone={tone}>
          {say(label)}
        </T>
      )}
    </View>
  )
}
