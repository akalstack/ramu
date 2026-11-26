import { View } from 'react-native'
import { MessageSquare, Monitor } from 'lucide-react-native'
import { forgeBrand } from '@ramu/shared/brands'
import {
  FORGE_NAMES,
  PULL_REQUEST_STAGE_LABEL,
  pullRequestRef,
  type MergedPullRequestRow,
  pullRequestWaitingDetail,
} from '@ramu/shared/pullRequests'
import { font, radius, space, useTheme } from '../theme'
import { ago, useSay } from '../i18n'
import { BrandIcon } from './Logos'
import { Row, T } from './ui'
import { ChecksLine, PullRequestGlyph, StageText } from './PullRequestParts'
import { checksAside as hasChecksAside, pullRequestRepoLabel } from '../runtime/pullRequestList'

/** The glyph column and the gap after it, so dividers start at the text as the other lists do. */
export const PULL_REQUEST_ROW_TEXT_INSET = space.l + 16 + space.m

/**
 * One pull request in the list, as the desktop draws it: its shape and title with when it last changed, where it is
 * (service, repository, number, author, and its host when there are several), then where it stands (the stage, checks
 * only when the stage is about something else, open threads, size, labels and the thread working on it). A tap opens
 * it; a long press offers the rest.
 */
export function PullRequestListRow({
  row,
  hostName,
  elsewhere,
  selected,
  onOpen,
  onMenu,
}: {
  row: MergedPullRequestRow
  /** The host it opens on, named when the list spans several hosts. */
  hostName?: string
  /** How many other hosts have the same repository. */
  elsewhere: number
  /** The pull request open beside the list on a wide window. */
  selected?: boolean
  onOpen: () => void
  onMenu: () => void
}) {
  const say = useSay()
  const { c } = useTheme()
  const { pr } = row
  const thread = row.threads.at(-1)
  const checksAside = hasChecksAside(row)
  return (
    <Row
      accessibilityLabel={[
        say('Pull request #{0}: {1}', { 0: pr.number, 1: pr.title }),
        pullRequestRepoLabel(row),
        FORGE_NAMES[row.service],
        pullRequestWaitingDetail(row.stage, pr.waiting, say) ?? say(PULL_REQUEST_STAGE_LABEL[row.stage]),
        hostName ? say('On {0}', { 0: hostName }) : null,
        thread ? say('In {0}', { 0: thread.title }) : null,
      ]
        .filter(Boolean)
        .join(', ')}
      accessibilityHint={say('Long press for more actions')}
      onPress={onOpen}
      onLongPress={onMenu}
      delayLongPress={350}
      accessibilityState={selected ? { selected: true } : undefined}
      style={[
        { alignItems: 'flex-start', paddingVertical: space.m },
        selected ? { backgroundColor: c.accentSoft } : null,
      ]}
    >
      {/* A fixed column, so every title starts at the same edge whatever the glyph. */}
      <View style={{ width: 16, paddingTop: 3, alignItems: 'center' }}>
        <PullRequestGlyph pr={pr} stage={row.stage} size={14} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        {/* The time sits on the title's first line, by baseline. */}
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.s }}>
          <T size={font.body - 1} weight="500" numberOfLines={2} style={{ flex: 1 }}>
            {pr.title}
          </T>
          <T size={font.caption} tone="muted" style={{ fontVariant: ['tabular-nums'] }}>
            {ago(pr.updatedAt)}
          </T>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <BrandIcon brand={forgeBrand(row.service)} size={11} />
          <T size={font.caption} tone="muted" numberOfLines={1} style={{ flex: 1 }}>
            {[`${pullRequestRepoLabel(row)} ${pullRequestRef(row.service, pr.number)}`, pr.author]
              .filter(Boolean)
              .join(' · ')}
          </T>
          {hostName ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, maxWidth: 120, flexShrink: 0 }}>
              <Monitor size={11} color={c.muted} />
              <T size={font.caption} tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
                {hostName}
              </T>
              {elsewhere ? (
                <T size={font.caption} tone="muted" style={{ fontVariant: ['tabular-nums'] }}>
                  {`+${elsewhere}`}
                </T>
              ) : null}
            </View>
          ) : null}
        </View>
        {/* On whom it waits and for what, under the facts and above the short stage. */}
        {pullRequestWaitingDetail(row.stage, pr.waiting, say) ? (
          <T size={font.caption} tone="muted" numberOfLines={1}>
            {pullRequestWaitingDetail(row.stage, pr.waiting, say)}
          </T>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, overflow: 'hidden' }}>
          <StageText stage={row.stage} />
          {checksAside ? <ChecksLine checks={pr.checks} compact /> : null}
          {pr.openThreads ? (
            <View
              accessibilityLabel={say('Open review threads')}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 2, flexShrink: 0 }}
            >
              <MessageSquare size={11} color={c.muted} />
              <T size={font.caption} tone="muted">
                {String(pr.openThreads)}
              </T>
            </View>
          ) : null}
          {pr.additions !== undefined && pr.deletions !== undefined ? (
            <T
              size={font.caption}
              style={{ flexShrink: 0, fontVariant: ['tabular-nums'] }}
              accessibilityLabel={say('{0} lines added, {1} removed', { 0: pr.additions, 1: pr.deletions })}
            >
              <T size={font.caption} tone="ok">{`+${pr.additions}`}</T>{' '}
              <T size={font.caption} tone="bad">{`−${pr.deletions}`}</T>
            </T>
          ) : null}
          {pr.labels?.slice(0, 2).map((label) => (
            <View
              key={label}
              style={{
                paddingHorizontal: 6,
                paddingVertical: 1,
                borderRadius: radius.full,
                backgroundColor: c.fill,
                maxWidth: 110,
                flexShrink: 1,
              }}
            >
              <T size={11} weight="500" tone="soft" numberOfLines={1}>
                {label}
              </T>
            </View>
          ))}
          {thread ? (
            <T size={font.caption} tone="muted" numberOfLines={1} style={{ flexShrink: 2 }}>
              {say('In {0}', { 0: thread.title })}
            </T>
          ) : null}
        </View>
      </View>
    </Row>
  )
}
