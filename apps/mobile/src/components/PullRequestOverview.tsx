import type { ReactNode } from 'react'
import { Pressable, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  ArrowLeft,
  ChevronRight,
  CircleCheck,
  CircleDot,
  CircleX,
  Ellipsis,
  GitMerge,
  MessageSquare,
  Users,
  WifiOff,
  type LucideIcon,
} from 'lucide-react-native'
import type { ForgeService, PullRequestStage, PullRequestSummary } from '@ramu/shared/types'
import { pullRequestGlyph, pullRequestRef } from '@ramu/shared/pullRequests'
import {
  READINESS_WAITING,
  readinessRows,
  type ReadinessRow,
  type ReadinessTone,
} from '@ramu/shared/pullRequestReadiness'
import type { PullRequestNextStep } from '@ramu/shared/pullRequests'
import { font, radius, space, useTheme } from '../theme'
import { ago, useSay } from '../i18n'
import { Button, Card, Divider, IconButton, T, tap } from './ui'
import { PullRequestGlyph, StageText } from './PullRequestParts'

const STATE_LABEL = { open: 'Open', draft: 'Draft', merged: 'Merged', closed: 'Closed' } as const
const STATE_TONE = { open: 'ok', draft: 'muted', merged: 'accent', closed: 'bad' } as const

/** A branch name that copies itself on tap, as the services let you grab it. */
function BranchName({ name }: { name: string }) {
  const say = useSay()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={say('Copy branch {0}', { 0: name })}
      hitSlop={8}
      onPress={() => {
        tap()
        void Clipboard.setStringAsync(name)
      }}
      style={({ pressed }) => ({ flexShrink: 1, opacity: pressed ? 0.6 : 1 })}
    >
      <T size={font.caption} mono tone="muted" numberOfLines={1}>
        {name}
      </T>
    </Pressable>
  )
}

/**
 * Who and what a pull request is, as GitHub's and T3 Code's phones lead with it: its state, number and size, the title,
 * its author and last change, the branches it merges (each copies on tap), and its labels.
 */
export function PullRequestIdentity({
  pr,
  service,
  stage,
}: {
  pr: PullRequestSummary
  service: ForgeService
  stage: PullRequestStage
}) {
  const say = useSay()
  const { c } = useTheme()
  const glyph = pullRequestGlyph(pr)
  const tone = STATE_TONE[glyph]
  const wash = { ok: c.okWash, muted: c.fill, accent: c.accentSoft, bad: c.badWash }[tone]
  return (
    <View style={{ gap: space.s }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.s }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 5,
            minHeight: 26,
            paddingHorizontal: space.s,
            borderRadius: radius.full,
            backgroundColor: wash,
          }}
        >
          <PullRequestGlyph pr={pr} size={13} />
          <T size={font.caption} weight="600" tone={tone}>
            {say(STATE_LABEL[glyph])}
          </T>
        </View>
        <T size={font.caption} tone="muted">
          {pullRequestRef(service, pr.number)}
        </T>
        {pr.additions !== undefined || pr.deletions !== undefined ? (
          <T size={font.caption}>
            <T size={font.caption} tone="ok">{`+${pr.additions ?? 0}`}</T>
            <T size={font.caption} tone="bad">{` −${pr.deletions ?? 0}`}</T>
          </T>
        ) : null}
        {pr.state === 'open' ? <StageText stage={stage} /> : null}
      </View>
      <T size={font.heading} weight="700" selectable style={{ lineHeight: 26 }}>
        {pr.title}
      </T>
      <T size={font.caption} tone="muted" numberOfLines={1}>
        {[pr.author, say('updated {0}', { 0: ago(pr.updatedAt) }), pr.fork ? say('From a fork') : null]
          .filter(Boolean)
          .join(' · ')}
      </T>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <BranchName name={pr.baseBranch} />
        <ArrowLeft size={11} color={c.muted} />
        <BranchName name={pr.headBranch} />
      </View>
      {pr.labels?.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {pr.labels.map((label) => (
            <View
              key={label}
              style={{
                paddingHorizontal: space.s,
                paddingVertical: 2,
                borderRadius: radius.full,
                backgroundColor: c.fill,
              }}
            >
              <T size={font.caption} tone="soft">
                {label}
              </T>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  )
}

const ROW_ICON: Record<ReadinessRow['key'], LucideIcon> = {
  checks: CircleDot,
  review: Users,
  merge: GitMerge,
  conversations: MessageSquare,
}

function readinessIcon(row: ReadinessRow): LucideIcon {
  if (row.key !== 'checks') return ROW_ICON[row.key]
  return row.tone === 'ok' ? CircleCheck : row.tone === 'bad' ? CircleX : CircleDot
}

/**
 * Where an open pull request stands, as the desktop's Overview leads with it: checks, reviews, merging and what is
 * unresolved, each a row that can open what it is about, then why it waits when there is nothing to do. The one action
 * sits in the bar at the bottom of the screen.
 */
export function PullRequestReadinessCard({
  pr,
  openThreads,
  step,
  onRow,
  rowAction,
}: {
  pr: PullRequestSummary
  openThreads: number
  step: PullRequestNextStep
  /** Opens what a row is about (the conversations, the files); rows without one are plain. */
  onRow?: (key: ReadinessRow['key']) => (() => void) | undefined
  /** A small action on a row, such as Re-run failed checks. */
  rowAction?: (key: ReadinessRow['key']) => ReactNode
}) {
  const say = useSay()
  const { c } = useTheme()
  if (pr.state !== 'open') return null
  const color = (tone: ReadinessTone) => (tone === 'muted' ? c.muted : c[tone])
  const waiting = READINESS_WAITING[step]
  return (
    <Card>
      {readinessRows(pr, openThreads).map((row, index) => {
        const Icon = readinessIcon(row)
        const press = onRow?.(row.key)
        const extra = rowAction?.(row.key)
        return (
          <View key={row.key}>
            {index ? <Divider inset={space.l + 26} /> : null}
            <Pressable
              accessibilityRole={press ? 'button' : undefined}
              disabled={!press}
              onPress={press}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.m,
                minHeight: 44,
                paddingHorizontal: space.l,
                paddingVertical: space.s,
                backgroundColor: pressed && press ? c.pressed : 'transparent',
              })}
            >
              <Icon size={16} color={color(row.tone)} />
              <T size={font.control} tone="soft" style={{ flex: 1 }}>
                {say(row.text, row.values)}
              </T>
              {extra}
              {press ? <ChevronRight size={15} color={c.muted} /> : null}
            </Pressable>
          </View>
        )
      })}
      {waiting ? (
        <>
          <Divider />
          <T size={font.caption} tone="muted" style={{ paddingHorizontal: space.l, paddingVertical: space.m }}>
            {say(waiting)}
          </T>
        </>
      ) : null}
    </Card>
  )
}

/** One way to work on the pull request (open its thread, have an agent review it, clone it), as a list row. */
export function PullRequestWorkRow({
  icon: Icon,
  title,
  help,
  disabled,
  onPress,
}: {
  icon: LucideIcon
  title: string
  help?: string
  disabled?: boolean
  onPress: () => void
}) {
  const { c } = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={() => {
        tap()
        onPress()
      }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.m,
        minHeight: 48,
        paddingHorizontal: space.l,
        paddingVertical: space.s,
        opacity: disabled ? 0.5 : 1,
        backgroundColor: pressed ? c.pressed : 'transparent',
      })}
    >
      <Icon size={17} color={c.soft} />
      <View style={{ flex: 1, gap: 2 }}>
        <T weight="500">{title}</T>
        {help ? (
          <T size={font.caption} tone="muted" numberOfLines={2}>
            {help}
          </T>
        ) : null}
      </View>
      <ChevronRight size={15} color={c.muted} />
    </Pressable>
  )
}

/** A quiet note in a tinted box: offline, outside every project, a fork. */
export function PullRequestNote({ icon: Icon = WifiOff, children }: { icon?: LucideIcon; children: ReactNode }) {
  const { c } = useTheme()
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: space.s,
        padding: space.m,
        borderRadius: radius.m,
        backgroundColor: c.raised2,
      }}
    >
      <Icon size={15} color={c.muted} style={{ marginTop: 2 }} />
      <T size={font.caption} tone="soft" style={{ flex: 1, lineHeight: 18 }}>
        {children}
      </T>
    </View>
  )
}

/**
 * The bar at the bottom of the screen, as GitHub's phone keeps its merge button in reach: the one thing to do next, and
 * every other action behind ⋯. Either can be absent; with neither the bar is not drawn.
 */
export function PullRequestActionBar({
  primary,
  onMore,
  busy,
}: {
  primary: { title: string; onPress: () => void; disabled?: boolean } | null
  onMore?: () => void
  busy?: boolean
}) {
  const say = useSay()
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  if (!primary && !onMore) return null
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.s,
        paddingHorizontal: space.l,
        paddingTop: space.s,
        paddingBottom: Math.max(insets.bottom, space.s),
        backgroundColor: c.canvas,
        borderTopWidth: 0.5,
        borderTopColor: c.lineStrong,
      }}
    >
      {primary ? (
        <Button
          title={busy ? say('Working…') : primary.title}
          disabled={busy || primary.disabled}
          onPress={primary.onPress}
          style={{ flex: 1 }}
        />
      ) : (
        <View style={{ flex: 1 }} />
      )}
      {onMore ? (
        <View style={{ borderRadius: radius.m, backgroundColor: c.fill }}>
          <IconButton icon={Ellipsis} label={say('More actions')} size={44} onPress={onMore} />
        </View>
      ) : null}
    </View>
  )
}
