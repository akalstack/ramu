import { View } from 'react-native'
import {
  CircleCheck,
  CircleDot,
  CircleX,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
} from 'lucide-react-native'
import type { PullRequestStage, PullRequestSummary } from '@ramu/shared/types'
import {
  PULL_REQUEST_STAGE_LABEL,
  PULL_REQUEST_STAGE_TONE,
  pullRequestGlyph,
  type PullRequestTone,
} from '@ramu/shared/pullRequests'
import { font, useTheme } from '../theme'
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
      <Icon size={size} color={c[GLYPH_TONE[glyph]]} strokeWidth={2} />
      {dot ? (
        <View
          style={{
            position: 'absolute',
            right: -2,
            bottom: -2,
            width: 6,
            height: 6,
            borderRadius: 3,
            borderWidth: 1,
            borderColor: c.window,
            backgroundColor: c[tone],
          }}
        />
      ) : null}
    </View>
  )
}

/** The stage's words in its colour, for rows and headers. */
export function StageText({ stage, size = font.caption }: { stage: PullRequestStage; size?: number }) {
  const say = useSay()
  return (
    <T size={size} tone={PULL_REQUEST_STAGE_TONE[stage]} numberOfLines={1} style={{ flexShrink: 0 }}>
      {say(PULL_REQUEST_STAGE_LABEL[stage])}
    </T>
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
