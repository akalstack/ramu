import { memo, useState } from 'react'
import { StyleSheet, View, useWindowDimensions } from 'react-native'
import { useRouter } from 'expo-router'
import { Archive, ArchiveRestore, Clock, GitBranch, Pin, PinOff } from 'lucide-react-native'
import { TEXT_SCALE, font, useTheme } from '../theme'
import type { Chat } from '../runtime/types'
import { ago, useT, type Strings } from '../i18n'
import { threadStatus } from '@ramu/shared/chat/threadStatus'
import { Row, StatusIcon, T, tap } from './ui'
import { ChatActionsSheet, useChatCommands } from './ChatActions'
import { SwipeRow } from './SwipeRow'
import { useStore } from '../runtime/store'

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
}: {
  chat: Chat
  project?: string
  divider?: boolean
}) {
  const { c, textSize } = useTheme()
  // At large text, a title squeezed beside the status and age is unreadable: metadata drops to its own wrapping line.
  const stacked = useWindowDimensions().fontScale * TEXT_SCALE[textSize] >= 1.3
  const router = useRouter()
  const [menu, setMenu] = useState(false)
  const commands = useChatCommands(chat)
  const strings = useT()
  const store = useStore()
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
  const [shortKey, fullKey] = status ? SHORT[status.kind] : []
  // A thread with no project and nothing to preview is one line; its row is centered instead of leaving a blank line.
  const hasDetail = Boolean(project || chat.mode === 'worktree' || chat.preview)
  const actions = chat.pending
    ? []
    : [
        {
          icon: commands.pinned ? PinOff : Pin,
          label: commands.pinned ? 'Unpin' : 'Pin',
          color: c.primary,
          onPress: () => void commands.togglePin(),
        },
        {
          icon: commands.archived ? ArchiveRestore : Archive,
          label: commands.archived ? 'Unarchive' : 'Archive',
          color: c.warn,
          onPress: () => void commands.toggleArchive(),
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
      <SwipeRow actions={actions} background={c.raised2}>
        <Row
          onLongPress={
            chat.pending
              ? undefined
              : () => {
                  tap()
                  setMenu(true)
                }
          }
          onPress={() => router.push({ pathname: '/chat/[id]', params: { id: chat.id } })}
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
            {chat.pending ? (
              <Clock size={16} color={c.muted} />
            ) : status?.kind === 'finished' ? (
              <View
                accessibilityLabel="Unread"
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
      {chat.pending ? null : <ChatActionsSheet chat={chat} open={menu} onClose={() => setMenu(false)} />}
    </>
  )
})
