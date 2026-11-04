import { memo, useState, type ReactNode } from 'react'
import { View, useWindowDimensions } from 'react-native'
import { useRouter } from 'expo-router'
import {
  Archive,
  ArchiveRestore,
  Bot,
  Check,
  Clock,
  Folder,
  GitBranch,
  GitFork,
  ListChecks,
  Pin,
  RotateCcw,
  Sparkles,
} from 'lucide-react-native'
import { threadOriginLabel } from '@ramu/shared/workspace/threadOrigin'
import { TEXT_SCALE, font, space, useTheme } from '../theme'
import { providerNames, type Chat } from '../runtime/types'
import { ago, useT, type Strings, useSay } from '../i18n'
import { threadStatus } from '@ramu/shared/chat/threadStatus'
import { ConnectionDot, Divider, Pill, ROW_INSET, Row, StatusIcon, T, tap } from './ui'
import { ChatActionsSheet, useChatCommands } from './ChatActions'
import { SwipeRow } from './SwipeRow'
import { ProviderIcon } from './Logos'
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

/** A chat in a full-width list; `divider` draws the inset hairline above it. */
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
  // A phone has room for where the work happens: the project in mixed lists, a worktree's branch, which agent, helpers.
  // The current checkout is the default, so it is left unsaid; the exact model is in the thread's composer.
  const helpers = chat.helperSummary?.active ?? 0
  const facts = Boolean(project || chat.mode === 'worktree' || helpers)
  // A thread with nothing to preview or describe is one line; its row is centered instead of leaving a blank line.
  const hasDetail = Boolean(chat.preview || facts)
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
      {/* The app's status dot, as on the host list, rather than a word competing with the thread's own status. */}
      {!online ? (
        <View accessible accessibilityLabel={strings.offline}>
          <ConnectionDot status="offline" size={7} />
        </View>
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
      {divider ? <Divider inset={ROW_INSET} /> : null}
      <SwipeRow actions={actions} background={c.window} fullSwipe>
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
            {chat.preview ? (
              // The preview is the agent's last word, so its mark leads it: Claude or Codex at a glance.
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View accessible accessibilityLabel={providerNames[chat.provider]}>
                  <ProviderIcon provider={chat.provider} size={11} />
                </View>
                <T
                  size={font.control}
                  tone={chat.status === 'needs-input' ? 'warn' : chat.status === 'failed' ? 'bad' : 'muted'}
                  numberOfLines={stacked ? 3 : 1}
                  style={{ flex: 1 }}
                >
                  {chat.preview}
                </T>
              </View>
            ) : null}
            {facts ? (
              <View
                style={{
                  flexDirection: 'row',
                  flexWrap: stacked ? 'wrap' : 'nowrap',
                  alignItems: 'center',
                  columnGap: space.s,
                  rowGap: 2,
                  overflow: 'hidden',
                }}
              >
                {project ? (
                  <Fact icon={<Folder size={11} color={c.muted} />} grow={!stacked}>
                    {project}
                  </Fact>
                ) : null}
                {chat.mode === 'worktree' ? (
                  <Fact icon={<GitBranch size={11} color={c.muted} />} label={say('Isolated worktree')} grow={!stacked}>
                    {chat.branch || say('Worktree')}
                  </Fact>
                ) : null}
                {helpers ? (
                  <Fact
                    icon={<Bot size={11} color={chat.helperSummary?.waiting ? c.warn : c.muted} />}
                    label={say('{0} helpers', { 0: helpers })}
                  >
                    {String(helpers)}
                  </Fact>
                ) : null}
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

/** One fact on a thread's detail line: a small mark and a word or two. `grow` lets a long name take the spare width. */
function Fact({ icon, label, grow, children }: { icon: ReactNode; label?: string; grow?: boolean; children: string }) {
  return (
    <View
      accessible
      accessibilityLabel={label ? `${label}: ${children}` : children}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: grow ? 1 : 0, minWidth: 0 }}
    >
      {icon}
      <T size={font.caption} tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
        {children}
      </T>
    </View>
  )
}
