import { memo, useState } from 'react'
import { StyleSheet, View, useWindowDimensions } from 'react-native'
import { useRouter } from 'expo-router'
import {
  Archive,
  ArchiveRestore,
  Check,
  Clock,
  GitBranch,
  GitFork,
  ListChecks,
  Pin,
  RotateCcw,
  Sparkles,
} from 'lucide-react-native'
import { threadOriginLabel } from '@ramu/shared/workspace/threadOrigin'
import { TEXT_SCALE, font, useTheme } from '../theme'
import type { Chat } from '../runtime/types'
import { ago, useT, type Strings, useSay } from '../i18n'
import { threadStatus } from '@ramu/shared/chat/threadStatus'
import { Pill, Row, StatusIcon, T, tap } from './ui'
import { ChatActionsSheet, useChatCommands } from './ChatActions'
import { SwipeRow } from './SwipeRow'
import { useComputerUse } from '../runtime/computerUse'
import { Monitor } from 'lucide-react-native'
import { useStore } from '../runtime/store'
import { threadSelection, useThreadSelection } from '../runtime/threadSelection'

const SHORT = {
  working: ['threadWorking', 'threadWorkingFull'],
  goal: ['threadGoal', 'threadGoalFull'],
  verifying: ['threadVerifying', 'threadVerifyingFull'],
  paused: ['threadPaused', 'threadPausedFull'],
  blocked: ['threadInput', 'threadBlockedFull'],
  'turn-limit': ['threadTurnLimit', 'threadTurnLimitFull'],
  approval: ['threadApproval', 'threadApprovalFull'],
  input: ['threadInput', 'threadInputFull'],
  limit: ['threadLimit', 'threadLimitFull'],
  failed: ['threadFailed', 'threadFailedFull'],
  stopped: ['threadStopped', 'threadStoppedFull'],
  finished: ['threadFinished', 'threadFinishedFull'],
} as const satisfies Record<string, readonly [keyof Strings, keyof Strings]>

/** A chat inside a rounded card; `divider` draws the hairline between stacked rows. */
export const ChatRow = memo(function ChatRow({
  chat,
  project,
  divider,
  selectable,
  earlierRuns,
}: {
  chat: Chat
  project?: string
  divider?: boolean
  /** A recurring schedule's older runs folded into this, its newest run. */
  earlierRuns?: number
  /** The list offers Select: while selecting, a tap picks the row instead of opening it. */
  selectable?: boolean
}) {
  const say = useSay()
  const { c, textSize } = useTheme()
  // At large text, a title squeezed beside the status and age is unreadable: metadata drops to its own wrapping line.
  const stacked = useWindowDimensions().fontScale * TEXT_SCALE[textSize] >= 1.3
  const router = useRouter()
  const [menu, setMenu] = useState(false)
  const commands = useChatCommands(chat)
  const strings = useT()
  const store = useStore()
  const { session: computerUse } = useComputerUse(chat.computerId, chat.taskId)
  // Unread, shared with the desktop: the computer keeps a "finished" notice until the chat is opened on any device.
  const unread =
    Boolean(chat.sessionId) &&
    (store.inbox[chat.computerId] ?? []).some((n) => n.sessionId === chat.sessionId && n.kind === 'done')
  const status = chat.pending
    ? null
    : threadStatus(
        chat,
        unread && (chat.status === 'idle' || chat.status === 'ready-for-review'),
        chat.goal && { ...chat.goal, verifying: !!chat.goal.claim },
      )
  const online = store.isOnline(chat.computerId)
  const selection = useThreadSelection()
  const selecting = !!selectable && selection.on && !chat.pending
  const picked = selecting && selection.ids.has(chat.id)
  const [shortKey, fullKey] = status ? SHORT[status.kind] : []
  // A thread with no project and nothing to preview is one line; its row is centered instead of leaving a blank line.
  const hasDetail = Boolean(project || chat.mode === 'worktree' || chat.preview)
  const actions =
    chat.pending || commands.viewOnly || selecting
      ? []
      : [
          {
            icon: commands.done ? RotateCcw : Check,
            label: say(commands.done ? 'Reopen' : 'Mark done'),
            color: c.primary,
            onPress: () => void commands.toggleDone(),
            removes: true,
          },
          {
            icon: commands.archived ? ArchiveRestore : Archive,
            label: commands.archived ? 'Unarchive' : 'Archive',
            color: c.warn,
            onPress: () => void commands.toggleArchive(),
            removes: true,
          },
        ]
  const meta = (
    <>
      {!online ? (
        <T size={font.caption} tone="muted">
          {strings.offline}
        </T>
      ) : null}
      {shortKey ? (
        <T
          size={font.caption}
          weight="500"
          tone={
            status?.kind === 'input' || status?.kind === 'approval'
              ? 'warn'
              : status?.kind === 'failed'
                ? 'bad'
                : 'soft'
          }
        >
          {strings[shortKey]}
        </T>
      ) : null}
      <T size={font.caption} tone="muted">
        {ago(chat.lastActiveAt)}
      </T>
    </>
  )
  return (
    <>
      <SwipeRow actions={actions} background={c.raised2} fullSwipe>
        <Row
          onLongPress={
            chat.pending
              ? undefined
              : () => {
                  tap()
                  if (selecting) threadSelection.toggle(chat.id)
                  else setMenu(true)
                }
          }
          onPress={() => {
            if (!selecting) return router.push({ pathname: '/chat/[id]', params: { id: chat.id } })
            tap()
            threadSelection.toggle(chat.id)
          }}
          accessibilityState={selecting ? { selected: picked } : undefined}
          style={{
            alignItems: hasDetail ? 'flex-start' : 'center',
            paddingVertical: 10,
            borderTopWidth: divider ? StyleSheet.hairlineWidth : 0,
            borderTopColor: c.lineStrong,
          }}
          accessibilityLabel={[chat.title, fullKey ? strings[fullKey] : null, !online ? strings.threadOffline : null]
            .filter(Boolean)
            .join(', ')}
        >
          <View style={{ paddingTop: hasDetail ? 2 : 0 }}>
            {selecting ? (
              <View
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 9,
                  borderWidth: picked ? 0 : 1.5,
                  borderColor: c.lineStrong,
                  backgroundColor: picked ? c.primary : 'transparent',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {picked ? <Check size={12} color={c.primaryInk} strokeWidth={3} /> : null}
              </View>
            ) : chat.pending ? (
              <Clock size={16} color={c.muted} />
            ) : status?.kind === 'finished' ? (
              <View
                accessibilityLabel={say('Unread')}
                style={{ width: 16, height: 16, alignItems: 'center', justifyContent: 'center' }}
              >
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.accent }} />
              </View>
            ) : (
              <StatusIcon
                status={
                  status?.kind === 'approval' ||
                  status?.kind === 'input' ||
                  status?.kind === 'blocked' ||
                  status?.kind === 'turn-limit'
                    ? 'needs-input'
                    : status?.kind === 'goal' || status?.kind === 'verifying' || status?.kind === 'working'
                      ? 'running'
                      : status?.kind === 'paused' || status?.kind === 'stopped' || status?.kind === 'limit'
                        ? 'idle'
                        : chat.status
                }
              />
            )}
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <T size={font.body} weight="500" numberOfLines={stacked ? 2 : 1} style={{ flex: 1 }}>
                {chat.title}
              </T>
              {/* The mark alone: the thread opens on its notice, with Stop and the screen, when it matters. */}
              {computerUse ? (
                <Monitor size={13} color={c.warn} accessibilityLabel={say('Computer access active')} />
              ) : null}
              {/* The same marks as the desktop sidebar: folded schedule runs, who started it, a review, a title on its way. */}
              {earlierRuns ? (
                <T size={font.caption} tone="muted" accessibilityLabel={say('{0} earlier runs', { 0: earlierRuns })}>
                  {`+${earlierRuns}`}
                </T>
              ) : null}
              {chat.startedFrom ? (
                <GitFork size={12} color={c.muted} accessibilityLabel={threadOriginLabel(chat.startedFrom, say)} />
              ) : null}
              {chat.kind === 'library-review' ? <Pill>{say('Review')}</Pill> : null}
              {chat.titleGenerationState === 'pending' ? (
                <Sparkles size={12} color={c.muted} accessibilityLabel={say('Naming thread')} />
              ) : null}
              {chat.pinnedAt !== null ? <Pin size={11} color={c.muted} /> : null}
              {stacked ? null : meta}
            </View>
            {stacked ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 8, rowGap: 2 }}>
                {meta}
              </View>
            ) : null}
            {hasDetail ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                {project ? (
                  <T size={font.control} tone="soft" numberOfLines={1}>
                    {project}
                  </T>
                ) : null}
                {chat.mode === 'worktree' ? <GitBranch size={12} color={c.muted} /> : null}
                <T
                  size={font.control}
                  tone={chat.status === 'needs-input' ? 'warn' : chat.status === 'failed' ? 'bad' : 'muted'}
                  numberOfLines={1}
                  style={{ flex: 1 }}
                >
                  {chat.preview}
                </T>
              </View>
            ) : null}
          </View>
        </Row>
      </SwipeRow>
      {chat.pending ? null : (
        <ChatActionsSheet
          chat={chat}
          open={menu}
          onClose={() => setMenu(false)}
          extras={
            selectable
              ? [{ icon: ListChecks, label: say('Select'), onPress: () => threadSelection.start(chat.id) }]
              : []
          }
        />
      )}
    </>
  )
})
