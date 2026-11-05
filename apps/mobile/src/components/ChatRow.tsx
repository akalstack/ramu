import { memo, useState, type ReactNode } from 'react'
import { View, useWindowDimensions } from 'react-native'
import { useRouter } from 'expo-router'
import {
  Archive,
  ArchiveRestore,
  Bot,
  Check,
  Clock,
  CloudOff,
  Folder,
  GitBranch,
  GitFork,
  ListChecks,
  Loader,
  Pin,
  RotateCcw,
  Sparkles,
} from 'lucide-react-native'
import { threadOriginLabel } from '@ramu/shared/workspace/threadOrigin'
import { TEXT_SCALE, font, space, useTheme } from '../theme'
import { providerNames, type Chat } from '../runtime/types'
import type { AgentProvider } from '@ramu/shared/types'
import { providerStack } from '@ramu/shared/chat/threadProviders'
import { ProviderIcon } from './Logos'
import { ago, useT, type Strings, useSay } from '../i18n'
import { threadStatus } from '@ramu/shared/chat/threadStatus'
import { inboxBlocker } from '@ramu/shared/hostInbox'
import { inboxBlockerText } from '../runtime/inboxBlockerText'
import { Divider, Pill, ROW_INSET, Row, T, tap } from './ui'
import { ChatActionsSheet, useChatCommands } from './ChatActions'
import { SwipeRow } from './SwipeRow'
import { useComputerUse } from '../runtime/computerUse'
import { Monitor } from 'lucide-react-native'
import { useStore } from '../runtime/store'
import { threadSelection, useThreadSelection } from '../runtime/threadSelection'

/** Statuses where the thread waits on the person. */
const WAITING = new Set(['approval', 'input', 'blocked', 'turn-limit'])

/** Each status's word on the detail line, and the full phrase VoiceOver reads. */
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

/**
 * A chat in a full-width list, at most three lines: the title with its age or state mark; what it is doing when that
 * matters, otherwise the opening of its latest reply; then where its work lands (branch, project, helpers, offline)
 * with its agents' marks. `divider` draws the inset hairline above it.
 */
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
  // At large text a long title takes two lines and the detail line wraps instead of cutting its facts off.
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
  const helpers = chat.helperSummary?.active ?? 0
  const blocker = status && WAITING.has(status.kind) ? inboxBlocker(chat) : null
  // What the thread is doing, first on its detail line: the agent's step while it works, what it needs from you, or how
  // its last run ended. A thread that finished and was seen has nothing to report; unread shows in its trailing mark.
  const state: { text: string; tone: 'accent' | 'warn' | 'bad' | 'muted' } | null = chat.pending
    ? { text: say('Waiting to send'), tone: 'muted' }
    : !status || status.kind === 'finished'
      ? null
      : status.kind === 'working' || status.kind === 'goal' || status.kind === 'verifying'
        ? { text: chat.activityLabel || strings[shortKey!], tone: 'accent' }
        : WAITING.has(status.kind)
          ? {
              text:
                chat.inputSummary?.requests[0]?.title ||
                (blocker ? inboxBlockerText(blocker, store.language === 'id' ? 'id' : 'en') : strings[shortKey!]),
              tone: 'warn',
            }
          : status.kind === 'failed'
            ? { text: strings[shortKey!], tone: 'bad' }
            : status.kind === 'limit' && chat.waitingUntil
              ? {
                  text: `${strings[shortKey!]} · ${say('retries in {0}', { 0: until(chat.waitingUntil) })}`,
                  tone: 'warn',
                }
              : { text: strings[shortKey!], tone: status.kind === 'limit' ? 'warn' : 'muted' }
  // Then where the work lands: its branch (a worktree's own, or the one its checkout has out), the project in lists
  // that mix projects, helpers still working, and an unreachable host.
  const branch = chat.branch || (chat.mode === 'worktree' ? say('Worktree') : '')
  const facts = Boolean(branch || project || helpers || !online)
  // Without a state to report, the reply says what the thread came to, which is what a person scans the list for.
  const reply = state ? '' : (chat.lastReply ?? '')
  const detail = Boolean(state || reply || facts)
  // Every agent that has worked here, as T3's rows show them: earlier ones (a handoff, a teammate) small and grey
  // before the one leading now. An older host reports only the leading one.
  const agents = providerStack(chat.providers?.length ? chat.providers : chat.provider ? [chat.provider] : [])
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
  return (
    <>
      {divider ? <Divider inset={selecting ? ROW_INSET : space.l} /> : null}
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
          style={{ alignItems: detail ? 'flex-start' : 'center', paddingVertical: 10 }}
          accessibilityLabel={[
            chat.title,
            fullKey ? strings[fullKey] : chat.pending ? state?.text : null,
            reply || null,
            !online ? strings.threadOffline : null,
            branch ? `${say('Branch')} ${branch}` : null,
            project,
            agents.map((provider) => providerNames[provider]).join(', '),
          ]
            .filter(Boolean)
            .join(', ')}
        >
          {selecting ? (
            <View style={{ paddingTop: detail ? 1 : 0 }}>
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
            </View>
          ) : null}
          <View style={{ flex: 1, gap: 3 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <T size={font.body} weight={unread ? '600' : '500'} numberOfLines={stacked ? 2 : 1} style={{ flex: 1 }}>
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
              {detail ? null : <AgentStack agents={agents} />}
              {/* As in the desktop sidebar: the thread's mark when it has something to report, otherwise its age. */}
              {chat.pending ? (
                <Clock size={13} color={c.muted} />
              ) : status ? (
                <StateMark status={status} retrying={!!chat.waitingUntil} label={strings[fullKey!]} />
              ) : (
                <T size={font.caption} tone="muted">
                  {ago(chat.lastActiveAt)}
                </T>
              )}
            </View>
            {state || reply ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
                {state ? (
                  <Fact tone={state.tone} grow>
                    {state.text}
                  </Fact>
                ) : (
                  <T size={font.control} tone="muted" numberOfLines={stacked ? 2 : 1} style={{ flex: 1 }}>
                    {reply}
                  </T>
                )}
                {facts ? null : (
                  <>
                    <View style={{ flex: 1, minWidth: space.s }} />
                    <AgentStack agents={agents} />
                  </>
                )}
              </View>
            ) : null}
            {facts ? (
              <View
                style={{
                  flexDirection: 'row',
                  flexWrap: stacked ? 'wrap' : 'nowrap',
                  alignItems: 'center',
                  columnGap: space.m,
                  rowGap: 2,
                  overflow: 'hidden',
                }}
              >
                {branch ? (
                  <Fact icon={<GitBranch size={11} color={c.muted} />} grow>
                    {branch}
                  </Fact>
                ) : null}
                {project ? (
                  <Fact icon={<Folder size={11} color={c.muted} />} grow={!branch}>
                    {project}
                  </Fact>
                ) : null}
                {helpers ? (
                  <Fact icon={<Bot size={11} color={chat.helperSummary?.waiting ? c.warn : c.muted} />}>
                    {String(helpers)}
                  </Fact>
                ) : null}
                {!online ? (
                  <Fact icon={<CloudOff size={11} color={c.muted} />} label={strings.offline}>
                    {strings.offline}
                  </Fact>
                ) : null}
                <View style={{ flex: 1, minWidth: space.s }} />
                <AgentStack agents={agents} />
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

/** One fact on a thread's detail line: an optional small mark and a word or two. `grow` lets a long one take the spare width. */
function Fact({
  icon,
  label,
  tone = 'muted',
  grow,
  children,
}: {
  icon?: ReactNode
  label?: string
  tone?: 'accent' | 'warn' | 'bad' | 'muted'
  grow?: boolean
  children: string
}) {
  return (
    <View
      accessible={!!label}
      accessibilityLabel={label}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: grow ? 1 : 0, minWidth: 0 }}
    >
      {icon}
      <T size={font.control} tone={tone} numberOfLines={1} style={{ flexShrink: 1 }}>
        {children}
      </T>
    </View>
  )
}

/**
 * The thread's trailing mark, the desktop sidebar's: a spinner while it works, amber when it needs you, red when it
 * failed, grey when it stopped or paused, a clock at a usage limit, violet while a finished run is unread.
 */
function StateMark({
  status,
  retrying,
  label,
}: {
  status: NonNullable<ReturnType<typeof threadStatus>>
  retrying: boolean
  label: string
}) {
  const { c } = useTheme()
  const kind = status.kind
  return (
    <View accessible accessibilityLabel={label} style={{ width: 14, alignItems: 'center' }}>
      {kind === 'working' || kind === 'goal' || kind === 'verifying' ? (
        <Loader size={13} color={c.accent} />
      ) : kind === 'limit' && retrying ? (
        <Clock size={13} color={c.warn} />
      ) : (
        <Dot
          color={
            WAITING.has(kind) || kind === 'limit'
              ? c.warn
              : kind === 'failed'
                ? c.bad
                : kind === 'finished'
                  ? c.accent
                  : c.placeholder
          }
        />
      )}
    </View>
  )
}

/** The thread's agents, the leading one last and in its colours, earlier ones smaller and grey. */
function AgentStack({ agents }: { agents: AgentProvider[] }) {
  if (!agents.length) return null
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
      {agents.map((provider, index) =>
        index < agents.length - 1 ? (
          <View key={provider} style={{ opacity: 0.45 }}>
            <ProviderIcon provider={provider} size={10} muted />
          </View>
        ) : (
          <View key={provider} style={{ opacity: 0.75 }}>
            <ProviderIcon provider={provider} size={12} />
          </View>
        ),
      )}
    </View>
  )
}

/** The app's small status dot, as the desktop sidebar draws it. */
function Dot({ color }: { color: string }) {
  return <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
}

/** How long until `at`, as the list's ages read: `4m`, `2h`. */
function until(at: number): string {
  const minutes = Math.max(1, Math.round((at - Date.now()) / 60_000))
  return minutes < 60 ? `${minutes}m` : `${Math.round(minutes / 60)}h`
}
