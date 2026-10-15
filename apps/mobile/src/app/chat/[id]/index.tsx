import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Alert, FlatList, Platform, Pressable, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import {
  ArrowDown,
  Bell,
  Check,
  Ellipsis,
  CircleArrowUp,
  CircleCheck,
  GitBranch,
  GitCompareArrows,
  Monitor,
  SquareTerminal,
} from 'lucide-react-native'
import { font, radius, space, useTheme } from '../../../theme'
import { useChat, useStore } from '../../../runtime/store'
import { foldTurns } from '../../../runtime/turns'
import { formatChatDate, needsChatDate } from '@ramu/shared/chatDates'
import { commitAndPush, pushBranch } from '../../../runtime/gitQuick'
import { STANDALONE } from '../../../runtime/types'
import {
  Header,
  HeaderButton,
  HeaderMenu,
  Screen,
  PageFlatList,
  nativeScrollEdge,
  type HeaderMenuItem,
} from '../../../components/Screen'
import { Composer } from '../../../components/Composer'
import { MessageMenu, RowToggle, TranscriptItemView, type ItemMeta } from '../../../components/Transcript'
import { ConnectionDot, Row, Sheet, T, tap } from '../../../components/ui'
import { BottomFade, Glass, TopFade, floatingChrome } from '../../../components/Glass'
import { KeyboardLift, useKeyboardHeight } from '../../../components/Keyboard'
import { OfflineBanner, PendingBubble } from '../../../components/Outbox'
import { ContextMeter } from '../../../components/ContextMeter'
import { Arrive, Presence, Shimmer, StreamIn } from '../../../components/Motion'
import { ChatActionsSheet, useChatCommands } from '../../../components/ChatActions'
import { openActivity, useActivitySummary } from '../../../components/ActivityTray'

/** Turns drawn at a time; a chat can have hundreds. */
const TURN_PAGE = 15

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const chat = useChat(id)
  const { c } = useTheme()
  const store = useStore()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const scroll = useRef<FlatList<import('../../../runtime/types').TranscriptItem>>(null)
  const following = useRef(true)
  const userScrolling = useRef(false)
  const [away, setAway] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [composerHeight, setComposerHeight] = useState(120)
  // iOS: the composer and keyboard cover the list's bottom through UIScrollView.contentInset, which moves no content.
  // The keyboard handler then sets the offset itself: the end when following, else the same lines stay above the keys.
  const ios = Platform.OS === 'ios'
  const slack = Math.max(0, insets.bottom - space.s)
  const coverFor = (keys: number) => composerHeight + (keys ? keys - slack : 0)
  const metrics = useRef({ offset: 0, content: 0, viewport: 0, cover: 0 })
  const settling = useRef<ReturnType<typeof setTimeout> | null>(null)
  const keyboardTarget = useRef<number | null>(null)
  const keyboard = useKeyboardHeight((to) => {
    if (!ios) return
    const m = metrics.current,
      cover = coverFor(to)
    const end = Math.max(restTop.current, m.content - m.viewport + cover)
    keyboardTarget.current = following.current
      ? end
      : Math.max(restTop.current, Math.min(end, m.offset + cover - m.cover))
    if (settling.current) clearTimeout(settling.current)
    settling.current = setTimeout(() => {
      settling.current = null
    }, 500)
  })
  useEffect(
    () => () => {
      if (settling.current) clearTimeout(settling.current)
    },
    [],
  )
  // After the new inset is mounted; the native scroll animation runs alongside the keyboard's.
  useEffect(() => {
    const target = keyboardTarget.current
    if (target == null) return
    keyboardTarget.current = null
    const frame = requestAnimationFrame(() => scroll.current?.scrollToOffset({ offset: target, animated: true }))
    return () => cancelAnimationFrame(frame)
  }, [keyboard.height])
  const cover = ios ? coverFor(keyboard.height) : 0
  metrics.current.cover = cover
  // scrollToEnd ignores contentInset, so on iOS it stops `cover` points short; aim past the inset instead.
  // Where the list rests with its first row just below the header. Learned from real scroll events (the header's inset is
  // not a fixed 44 pt); until one arrives, a slightly generous guess keeps a short chat from sliding under the bar.
  // iOS: the list's top inset is set here, not left to UIKit's automatic adjustment. The automatic inset arrives after the
  // first layout when the header is configured during render, so a fresh chat sat under the bar until it was scrolled.
  // The bar is 54 pt from iOS 26 (44 pt before); the list rests at minus that inset.
  const barHeight = Platform.OS === 'ios' && Number(Platform.Version) >= 26 ? 54 : 44
  const topInset = ios ? insets.top + barHeight : 0
  const restTop = useRef(-topInset)
  restTop.current = -topInset
  const toEnd = (animated: boolean) => {
    if (!ios) return scroll.current?.scrollToEnd({ animated })
    const m = metrics.current
    // Not measured yet: an offset worked out from a zero-height viewport lands far down and hides the first messages.
    if (!m.viewport || !m.content) return
    const end = m.content - m.viewport + m.cover
    // A short chat fits on screen: its end is its top. Only move if it was pushed past the top, and then back to the rest.
    // The header height is a guess until UIKit applies it, so a chat that only just overflows is left to UIKit: moving it would
    // slide its first message under the bar. Only clearly long chats are pinned to their end.
    if (end <= restTop.current + 80) return
    scroll.current?.scrollToOffset({ offset: end, animated })
  }
  // The first measured composer height replaces the estimate; stay on the end when that moves the inset.
  useEffect(() => {
    if (following.current && !settling.current) {
      const frame = requestAnimationFrame(() => toEnd(false))
      return () => cancelAnimationFrame(frame)
    }
  }, [composerHeight])
  // A row opened or closed by hand keeps the scroll position; content growth from the agent still follows the end.
  const held = useRef(0)
  const holdScroll = useCallback(() => {
    held.current = Date.now()
  }, [])
  const [restore, setRestore] = useState<{ text: string; n: number }>()
  const computer = store.computers.find((x) => x.id === chat?.computerId)
  // Branch and change counts feed the header's git menu. Native menus have no on-open hook,
  // so refetch on focus, when a turn finishes, and after each action here.
  const [git, setGit] = useState<{
    chatId: string
    repoId: string
    repos: number
    branch: string
    changed: number
    ahead: number
    published: boolean
  }>()
  const [refresh, setRefresh] = useState(0)
  const [sheet, setSheet] = useState(false)
  const [actions, setActions] = useState<'closed' | 'menu' | 'rename'>('closed')
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string>()
  // The toast keeps its text while it fades out.
  const lastToast = useRef('')
  if (toast) lastToast.current = toast
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current)
    },
    [],
  )
  useFocusEffect(
    useCallback(() => {
      if (!chat?.taskId || chat.projectId === STANDALONE || computer?.status !== 'online') return
      let alive = true
      void (async () => {
        const bindings = (await store.invoke(chat.computerId, 'tasks.bindings', chat.taskId)).filter(
          (b) => !b.folderOnly && !b.notGit && b.setupState === 'ready',
        )
        const binding = bindings[0]
        if (!alive || !binding) return
        const status = await store.invoke(chat.computerId, 'git.status', chat.taskId, binding.repoId)
        if (alive)
          setGit({
            chatId: chat.id,
            repoId: binding.repoId,
            repos: bindings.length,
            branch: status.branch ?? (status.oid ? status.oid.slice(0, 7) : 'Detached HEAD'),
            changed: status.entries.length,
            ahead: status.ahead,
            published: Boolean(status.upstream),
          })
      })().catch(() => {})
      return () => {
        alive = false
      }
    }, [chat?.id, chat?.taskId, chat?.computerId, chat?.projectId, chat?.status, computer?.status, refresh]),
  )
  const activity = useActivitySummary()
  // Looking at a chat clears its notice on every device.
  const [focused, setFocused] = useState(true)
  useFocusEffect(
    useCallback(() => {
      setFocused(true)
      return () => setFocused(false)
    }, []),
  )
  const hasNotice = Boolean(
    chat?.sessionId && (store.inbox[chat.computerId] ?? []).some((n) => n.sessionId === chat.sessionId),
  )
  useEffect(() => {
    if (focused && hasNotice && chat) store.acknowledge(chat.id)
  }, [focused, hasNotice, chat?.id])
  const [editing, setEditing] = useState<{ seq: number; files: import('@ramu/shared/types').Attachment[] } | null>(null)
  const [staged, setStaged] = useState<{
    chatId: string
    model: import('../../../components/Composer').ModelChoice
  } | null>(null)
  const commands = useChatCommands(
    chat ??
      ({
        computerId: '',
        taskId: '',
        pinnedAt: null,
        status: 'idle',
        title: '',
        mode: 'current',
      } as unknown as import('../../../runtime/types').Chat),
  )
  // Entries that appear while the screen is open and the agent is working animate in; the first load and recycled rows do not.
  const openedAt = useRef(Date.now())
  const seen = useRef(new Set<string>())
  // Finished turns fold into "Worked for…"; the running turn renders block by block, and only its newest reply animates.
  const rows = useMemo(
    () => foldTurns(chat?.items ?? [], chat?.status === 'running', chat?.status === 'needs-input'),
    [chat?.items, chat?.status],
  )
  // A long chat draws its latest turns; "Earlier turns" brings back the previous page without moving what you are reading.
  const [turnsShown, setTurnsShown] = useState(TURN_PAGE)
  const [pagedBack, setPagedBack] = useState(false)
  useEffect(() => {
    setTurnsShown(TURN_PAGE)
    setPagedBack(false)
  }, [id])
  const { pageRows, hiddenTurns } = useMemo(() => {
    const users = rows.flatMap((row, index) => (row.kind === 'user' ? [index] : []))
    const hidden = Math.max(0, users.length - turnsShown)
    return { pageRows: hidden ? rows.slice(users[hidden]!) : rows, hiddenTurns: hidden }
  }, [rows, turnsShown])
  // Where each message sits in time and in its turn: date labels above turns, time and copy under each turn's last answer.
  const itemMeta = useMemo(() => {
    const map = new Map<string, ItemMeta>()
    let previous: number | undefined
    pageRows.forEach((row, index) => {
      if (row.kind === 'user') {
        const at = row.at || undefined
        if (needsChatDate(at, previous)) map.set(row.id, { date: formatChatDate(at!, Date.now(), store.language) })
        if (at) previous = at
      } else if (row.kind === 'text') {
        const next = pageRows.slice(index + 1).find((other) => other.kind === 'user' || other.kind === 'text')
        if (!next || next.kind === 'user') map.set(row.id, { footer: true })
      }
    })
    return map
  }, [pageRows, store.language])
  if (!chat)
    return (
      <Screen>
        <Header title="Chat not found" />
      </Screen>
    )
  const live = git?.chatId === chat.id ? git : undefined
  const branch = live?.branch ?? chat.branch
  const project =
    chat.projectId === STANDALONE ? 'Standalone' : store.projects.find((p) => p.id === chat.projectId)?.name
  const running = chat.status === 'running'
  // Stopped by you or failed since the last message: the empty send button becomes Continue.
  const lastUser = chat.items.findLastIndex((item) => item.kind === 'user')
  const stopped =
    !running &&
    (chat.status === 'failed' || chat.items.slice(lastUser + 1).some((item) => item.kind === 'end' && item.interrupted))
  const currentModel = { provider: chat.provider, model: chat.model, effort: chat.effort, settings: chat.settings }
  const applyModel = (m: import('../../../components/Composer').ModelChoice) => {
    // As on the desktop: while the agent works the change applies now; otherwise it waits for the next message.
    if (running || !chat.sessionId) {
      setStaged(null)
      void store.setModel(chat.id, m.provider, m.model, m.effort, m.settings)
    } else
      setStaged(
        m.provider === chat.provider &&
          m.model === chat.model &&
          (m.effort || '') === (chat.effort || '') &&
          (m.settings?.access ?? chat.settings?.access) === chat.settings?.access &&
          (m.settings?.autoFallback ?? chat.settings?.autoFallback) === chat.settings?.autoFallback &&
          (m.settings?.serviceTier ?? chat.settings?.serviceTier) === chat.settings?.serviceTier
          ? null
          : { chatId: chat.id, model: m },
      )
  }
  // Another model has no cached copy of this conversation, so the first message after a switch is billed in full.
  const changeModel = (m: import('../../../components/Composer').ModelChoice) => {
    const switching =
      (m.provider !== chat.provider || m.model !== chat.model) && !(m.provider === chat.provider && !chat.model)
    const started = chat.sessionId && rows.some((item) => item.kind === 'user' || item.kind === 'summary')
    if (!switching || !started || store.drafts['pref:model-warning'] === 'off') return applyModel(m)
    Alert.alert(
      'Change model mid-conversation?',
      'The new model cannot reuse the cache built for this conversation, so the first message after the change uses more of your usage than usual.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Change', onPress: () => applyModel(m) },
        {
          text: "Change, don't warn again",
          onPress: () => {
            store.setDraft('pref:model-warning', 'off')
            applyModel(m)
          },
        },
      ],
    )
  }
  /** Sends the revised message as a new request; the agent is told it replaces the earlier one, and files can be put back first. */
  const submitEdit = async (
    text: string,
    mode: 'send' | 'queue' | 'steer',
    attachments?: string[],
    context?: import('@ramu/shared/types').FileContext[],
  ) => {
    if (!editing || !chat.sessionId) return
    const online = store.isOnline(chat.computerId)
    let restored = false
    if (online) {
      const preview = await store
        .invoke(chat.computerId, 'reviews.chatUndoPreview', chat.sessionId, editing.seq)
        .catch(() => null)
      const ready = preview?.files.filter((f) => f.status === 'ready') ?? []
      if (preview && ready.length) {
        const choice = await new Promise<'restore' | 'keep' | 'cancel'>((resolve) =>
          Alert.alert(
            `Restore ${ready.length} file${ready.length === 1 ? '' : 's'}?`,
            `The agent changed ${ready
              .map((f) => f.path)
              .slice(0, 4)
              .join(
                ', ',
              )}${ready.length > 4 ? '…' : ''} after this message. Put ${ready.length === 1 ? 'it' : 'them'} back as before, or keep the current files.`,
            [
              { text: 'Cancel', style: 'cancel', onPress: () => resolve('cancel') },
              { text: 'Keep files', onPress: () => resolve('keep') },
              { text: 'Restore files', onPress: () => resolve('restore') },
            ],
            { cancelable: true, onDismiss: () => resolve('cancel') },
          ),
        )
        if (choice === 'cancel') throw new Error('Edit not sent. Your text is kept.')
        if (choice === 'restore') {
          await store.invoke(
            chat.computerId,
            'reviews.chatUndoApply',
            preview.token,
            ready.map((f) => f.fileId),
          )
          restored = true
        }
      }
    }
    const outgoing = `${text}\n\n<ramu-context>\nThis revises my earlier message ${editing.seq}.${restored ? ' Selected file changes from that message and later captured runs were restored using Ramu. Inspect current files before acting.' : ' Files have not been restored.'} Treat this revised request as replacing the earlier request; the previous transcript remains as historical evidence.\n</ramu-context>`
    const keep = editing.files.map((file) => file.id).filter((id) => !attachments?.includes(id))
    setEditing(null)
    following.current = true
    await store.send(chat.id, outgoing, mode === 'send' ? 'queue' : mode, [...keep, ...(attachments ?? [])], context)
  }
  const offline = !store.isOnline(chat.computerId)
  // Only stuck messages (offline or uncertain) show as pending; one being delivered to a connected computer would just flash.
  const pending = store.outbox.filter(
    (o) => o.chatId === chat.id && (o.state === 'uncertain' || !store.isOnline(chat.computerId)),
  )
  const editPending = (text: string) => setRestore((r) => ({ text, n: (r?.n ?? 0) + 1 }))
  const openScm = () => router.push({ pathname: '/chat/[id]/scm', params: { id: chat.id } })
  const openChanges = () => router.push({ pathname: '/chat/[id]/changes', params: { id: chat.id } })
  const say = (text: string) => {
    setToast(text)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(undefined), 5000)
  }
  const act = async (fn: () => Promise<string>) => {
    if (busy) return
    setBusy(true)
    try {
      say(await fn())
    } catch (error) {
      say(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
      setRefresh((n) => n + 1)
    }
  }
  const changed = live?.changed ?? 0
  // One repository: Commit & push is a true one-tap shortcut. With several, it would commit only one, so it opens Source Control.
  const quickCommit = () => {
    if (!live || live.repos > 1) return openScm()
    Alert.alert(
      `Commit & push ${changed} change${changed === 1 ? '' : 's'}?`,
      `${computer?.name ?? 'This computer'} · ${live.branch}\n\nRamu drafts the message with AI, commits every change, and pushes to origin.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Commit & push',
          onPress: () => void act(async () => `Pushed: ${await commitAndPush(store.invoke, chat, live.repoId)}`),
        },
      ],
    )
  }
  const pushReason = !live
    ? 'Checking repository…'
    : changed
      ? 'Commit or stash local changes before pushing.'
      : live.ahead
        ? `Push ${live.ahead} commit${live.ahead === 1 ? '' : 's'} to origin`
        : !live.published
          ? 'Publish this branch to origin'
          : 'Nothing to push'
  const canPush = Boolean(live) && !changed && (Boolean(live!.ahead) || !live!.published)
  const push = () =>
    live &&
    void act(async () => {
      await pushBranch(store.invoke, chat, live.repoId)
      return `Pushed ${live.branch}`
    })
  const gitItems: HeaderMenuItem[] = [
    {
      title: branch || 'Source control',
      subtitle: live
        ? `${changed ? `${changed} changed` : 'No changes'}${live.ahead ? ` · ${live.ahead}↑` : ''}`
        : undefined,
      systemIcon: 'arrow.triangle.branch',
      onPress: openScm,
    },
    {
      title: live?.repos && live.repos > 1 ? 'Commit…' : changed ? 'Commit & push' : 'Push',
      subtitle: changed || !canPush ? undefined : pushReason,
      systemIcon: 'arrow.up.circle',
      disabled: busy || (changed ? false : !canPush),
      onPress: changed ? quickCommit : push,
    },
    {
      title: 'Review changes',
      subtitle: 'Turn diffs and worktree changes',
      systemIcon: 'text.bubble',
      onPress: openChanges,
    },
    { title: 'More', subtitle: 'Commit, files, branches', systemIcon: 'ellipsis', onPress: () => setSheet(true) },
  ]

  const openTerminal = () => router.push({ pathname: '/chat/[id]/terminal', params: { id: chat.id } })
  const chatItems: HeaderMenuItem[] = [
    {
      title: computer?.name ?? 'Computer unavailable',
      subtitle: [project, branch].filter(Boolean).join(' · ') || undefined,
      systemIcon: 'desktopcomputer',
      disabled: true,
      onPress: () => {},
    },
    { title: 'Terminal', systemIcon: 'terminal', onPress: openTerminal },
    ...(chat.sessionId
      ? [
          {
            title: 'Side questions',
            subtitle: 'Ask without interrupting the chat',
            systemIcon: 'questionmark.bubble' as const,
            onPress: () => router.push({ pathname: '/chat/[id]/aside', params: { id: chat.id } }),
          },
        ]
      : []),
    {
      title: 'Activity',
      subtitle: activity.count
        ? `${activity.count} ${activity.missed.length ? 'with missed notifications' : 'running or waiting'}`
        : undefined,
      systemIcon: activity.missed.length ? 'bell.badge' : 'bell',
      onPress: openActivity,
    },
    {
      title: commands.pinned ? 'Unpin' : 'Pin to top',
      systemIcon: commands.pinned ? 'pin.slash' : 'pin',
      onPress: () => void commands.togglePin(),
    },
    { title: 'Rename', systemIcon: 'pencil', onPress: () => setActions('rename') },
    {
      title: commands.archived ? 'Unarchive' : 'Archive',
      systemIcon: commands.archived ? 'tray.and.arrow.up' : 'archivebox',
      onPress: () => {
        void commands.toggleArchive()
        if (!commands.archived) router.back()
      },
    },
    { title: 'Delete…', systemIcon: 'trash', onPress: () => commands.confirmDelete(() => router.back()) },
  ]

  return (
    <Screen>
      <Header
        title={chat.title}
        subtitle={
          ios ? undefined : (
            <View
              accessible
              accessibilityLabel={`Computer: ${computer?.name ?? 'Unavailable'}, ${computer?.status ?? 'offline'}`}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: '100%' }}
            >
              <Monitor size={11} color={c.muted} />
              <T size={12} tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
                {computer?.name ?? 'Computer unavailable'}
              </T>
              <ConnectionDot status={computer?.status ?? 'offline'} size={5} />
            </View>
          )
        }
        right={
          !chat.pending ? (
            <>
              {chat.projectId !== STANDALONE ? (
                <HeaderMenu
                  icon={GitBranch}
                  label="Source Control"
                  systemIcon="arrow.triangle.branch"
                  items={gitItems}
                  onPress={() => setSheet(true)}
                />
              ) : null}
              {ios ? null : <HeaderButton icon={SquareTerminal} label="Terminal" onPress={openTerminal} />}
              {ios ? null : (
                <HeaderButton
                  icon={Bell}
                  label={activity.count ? `Activity, ${activity.count}` : 'Activity'}
                  onPress={openActivity}
                />
              )}
              <HeaderMenu
                icon={Ellipsis}
                label="Chat actions"
                systemIcon="ellipsis"
                items={chatItems}
                onPress={() => setActions('menu')}
              />
            </>
          ) : null
        }
      />
      <MessageMenu.Provider
        value={{
          // Quote: "> line" blocks appended to the draft, as the desktop's Quote does.
          quote: (text) => {
            const key = `${chat.computerId}:chat:${chat.taskId || chat.id}`
            const current = store.drafts[key] ?? ''
            const quoted = text
              .trim()
              .split('\n')
              .map((line) => `> ${line}`)
              .join('\n')
            const next = current.trim() ? `${current.replace(/\s+$/, '')}\n\n${quoted}\n\n` : `${quoted}\n\n`
            store.setDraft(key, next)
            setRestore((r) => ({ text: next, n: (r?.n ?? 0) + 1 }))
          },
          // Quote in new chat: opens New chat in this project with the passage already quoted in the box.
          // Puts back every file the agent changed after this message, after showing which ones.
          undo: async (seq) => {
            if (!chat.sessionId) return
            try {
              const preview = await store.invoke(chat.computerId, 'reviews.chatUndoPreview', chat.sessionId, seq)
              const ready = preview.files.filter((f) => f.status === 'ready')
              const blocked = preview.files.filter((f) => f.status === 'conflict')
              if (!ready.length)
                return Alert.alert(
                  'Nothing to undo',
                  preview.files.map((f) => `${f.path}: ${f.reason}`).join('\n') ||
                    'The agent has not changed files since this message.',
                )
              Alert.alert(
                `Undo ${ready.length} file${ready.length === 1 ? '' : 's'}?`,
                `${ready
                  .map((f) => `${f.repoName}/${f.path}${f.remove ? ' (delete)' : ''}`)
                  .slice(0, 8)
                  .join('\n')}${blocked.length ? `\n\n${blocked.length} changed since and will be left alone.` : ''}`,
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Undo',
                    style: 'destructive',
                    onPress: () =>
                      void store
                        .invoke(
                          chat.computerId,
                          'reviews.chatUndoApply',
                          preview.token,
                          ready.map((f) => f.fileId),
                        )
                        .then(() => say('Restored the files'))
                        .catch((e) => say(e instanceof Error ? e.message : String(e))),
                  },
                ],
              )
            } catch (error) {
              Alert.alert('Could not undo', error instanceof Error ? error.message : String(error))
            }
          },
          edit: (seq, text, files) => {
            setEditing({ seq, files })
            setRestore((r) => ({ text: text.split('\n\n<ramu-context>')[0]!, n: (r?.n ?? 0) + 1 }))
          },
          quoteNew: (text) =>
            router.push({ pathname: '/new', params: { project: chat.projectId, quote: text.slice(0, 20_000) } }),
          aside: (text, from) => {
            if (chat.sessionId)
              router.push({ pathname: '/chat/[id]/aside', params: { id: chat.id, quote: text.slice(0, 20_000), from } })
          },
        }}
      >
        <RowToggle.Provider value={holdScroll}>
          <PageFlatList
            // As in T3 Code: a list that gets its first rows is mounted fresh, so UIKit applies the header inset while attaching it.
            // Inserting into an attached, empty list under a transparent header can leave short content one header-height too high.
            key={pageRows.length ? 'filled' : 'empty'}
            ref={scroll}
            // As in the T3 Code app: UIKit derives the top inset from the transparent header ("automatic") and no manual top inset is
            // given, so the native scroll-edge effect has a region to draw into. Only the composer/keyboard space is set by hand.
            contentInsetAdjustmentBehavior="automatic"
            automaticallyAdjustsScrollIndicatorInsets
            ListHeaderComponent={
              <View style={{ gap: space.s, paddingBottom: space.m }}>
                {hiddenTurns > 0 ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      tap()
                      following.current = false
                      setPagedBack(true)
                      setTurnsShown((n) => n + TURN_PAGE)
                    }}
                    style={{
                      alignSelf: 'center',
                      height: 32,
                      paddingHorizontal: space.l,
                      borderRadius: radius.full,
                      justifyContent: 'center',
                      backgroundColor: c.fill,
                    }}
                  >
                    <T size={font.control} weight="500" tone="soft">{`Earlier turns · ${hiddenTurns} more`}</T>
                  </Pressable>
                ) : null}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <T size={12} tone="muted" numberOfLines={1} style={{ flexShrink: 1, maxWidth: '50%' }}>
                    {project}
                  </T>
                  {branch ? (
                    <>
                      <GitBranch size={12} color={c.muted} />
                      <T size={12} mono tone="muted" numberOfLines={1} style={{ flex: 1 }}>
                        {branch}
                      </T>
                    </>
                  ) : null}
                </View>
                {offline ? (
                  <OfflineBanner computer={computer?.name ?? 'Computer unavailable'} pending={pending.length} />
                ) : null}
              </View>
            }
            data={pageRows}
            maintainVisibleContentPosition={pagedBack ? { minIndexForVisible: 0 } : undefined}
            keyExtractor={(item) => item.id}
            renderItem={({ item, index }) => {
              const fresh = !seen.current.has(item.id) && Date.now() - openedAt.current > 800
              seen.current.add(item.id)
              const streaming = running && item.kind === 'text' && index === pageRows.length - 1
              const view = <TranscriptItemView item={item} chat={chat} meta={{ ...itemMeta.get(item.id), streaming }} />
              return (
                <Arrive animate={fresh && running}>
                  {streaming ? (
                    <StreamIn text={item.text} active>
                      {view}
                    </StreamIn>
                  ) : (
                    view
                  )}
                </Arrive>
              )
            }}
            initialNumToRender={20}
            maxToRenderPerBatch={12}
            windowSize={7}
            ItemSeparatorComponent={() => <View style={{ height: space.m + 2 }} />}
            style={{ flex: 1 }}
            contentInset={ios ? { bottom: cover } : undefined}
            scrollIndicatorInsets={ios ? { bottom: cover } : undefined}
            contentContainerStyle={{
              padding: space.l,
              paddingBottom: ios ? space.l : (floatingChrome ? composerHeight + space.l : space.l) + keyboard.height,
            }}
            onLayout={(event) => {
              metrics.current.viewport = event.nativeEvent.layout.height
              if (following.current) toEnd(false)
            }}
            onScroll={(event) => {
              const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent
              metrics.current.offset = contentOffset.y
              const gap = contentSize.height - contentOffset.y - layoutMeasurement.height + metrics.current.cover
              // Only the reader's own scrolling decides whether to follow the end. The list's first, programmatic offset
              // (resting at the top before it is measured) used to switch following off, so a chat opened at its top.
              if (!settling.current && userScrolling.current) following.current = gap < 40
              setAway(gap > 80)
              setScrolled(contentOffset.y > 8 - (ios ? topInset : insets.top + 44))
            }}
            scrollEventThrottle={16}
            onScrollBeginDrag={() => {
              userScrolling.current = true
            }}
            onScrollEndDrag={(event) => {
              if (!event.nativeEvent.velocity?.y) userScrolling.current = false
            }}
            onMomentumScrollEnd={() => {
              userScrolling.current = false
            }}
            onContentSizeChange={(_, height) => {
              metrics.current.content = height
              if (following.current && !settling.current && Date.now() - held.current > 600) toEnd(false)
            }}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            ListFooterComponent={
              <View style={{ gap: space.m, paddingTop: space.m }}>
                {pending.map((o) => (
                  <PendingBubble key={o.id} item={o} computer={computer?.name ?? 'the computer'} onEdit={editPending} />
                ))}
                {running && !offline ? (
                  <Arrive animate>
                    <Shimmer>Thinking</Shimmer>
                  </Arrive>
                ) : null}
              </View>
            }
          />
          {/* iOS: shown only when the computer isn't reachable; project and branch live in the list header and the ⋯ menu. */}
          {ios ? (
            <Presence
              visible={computer?.status !== 'online'}
              style={{ position: 'absolute', top: topInset + 22, left: space.l, right: space.l, alignItems: 'center' }}
            >
              <Glass
                radius={radius.full}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  height: 28,
                  paddingHorizontal: space.m,
                  maxWidth: '100%',
                }}
              >
                <View
                  accessible
                  accessibilityLabel={`Computer: ${computer?.name ?? 'Unavailable'}, ${computer?.status ?? 'offline'}`}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}
                >
                  <Monitor size={11} color={c.muted} />
                  <T size={12} tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
                    {computer?.name ?? 'Computer unavailable'}
                  </T>
                  <ConnectionDot status={computer?.status ?? 'offline'} size={5} />
                  <T size={12} tone="muted">
                    {computer?.status === 'connecting'
                      ? 'Connecting…'
                      : computer?.status === 'revoked'
                        ? 'Pair again'
                        : 'Offline'}
                  </T>
                </View>
              </Glass>
            </Presence>
          ) : null}
          {nativeScrollEdge ? null : <TopFade visible={scrolled} color={c.window} />}
          <KeyboardLift keyboard={keyboard}>
            <BottomFade height={composerHeight * 0.75} color={c.window} />
            {/* iOS/web: the glass composer floats over the transcript, which scrolls beneath it. */}
            <View
              onLayout={(e) => setComposerHeight(e.nativeEvent.layout.height)}
              style={[
                { paddingBottom: Math.max(insets.bottom, space.s), paddingTop: space.xs },
                floatingChrome && { position: 'absolute', left: 0, right: 0, bottom: 0 },
              ]}
            >
              <Composer
                running={running}
                model={staged?.chatId === chat.id ? staged.model : currentModel}
                currentModel={staged?.chatId === chat.id ? currentModel : undefined}
                onModel={changeModel}
                onSend={async (text, mode, attachments, context) => {
                  if (editing) return submitEdit(text, mode, attachments, context)
                  if (staged?.chatId === chat.id) {
                    const m = staged.model
                    setStaged(null)
                    await store.setModel(chat.id, m.provider, m.model, m.effort, m.settings)
                  }
                  // "/aside question" (or "/btw") asks beside the chat: the agent keeps working and never sees it.
                  const side = /^\/(?:aside|btw)\s+(\S[\s\S]*)$/.exec(text.trim())
                  if (side && !attachments?.length && chat.sessionId)
                    return store
                      .invoke(chat.computerId, 'aside.ask', chat.sessionId, null, '', 'assistant', side[1]!.trim())
                      .then((made) => {
                        router.push({ pathname: '/chat/[id]/aside', params: { id: chat.id, aside: made.id } })
                      })
                  following.current = true
                  return store.send(chat.id, text, mode, attachments, context)
                }}
                taskId={chat.taskId || undefined}
                chatId={chat.id}
                computerId={chat.computerId}
                draftKey={`${chat.computerId}:chat:${chat.taskId || chat.id}`}
                onStop={() => store.stop(chat.id)}
                goal={chat.goal}
                queue={chat.queue}
                queuePaused={chat.queuePaused}
                onResumeQueue={
                  chat.sessionId
                    ? () =>
                        void store
                          .invoke(chat.computerId, 'agent.resumeQueue', chat.sessionId!)
                          .then(() => store.refresh(chat.computerId))
                          .catch(() => {})
                    : undefined
                }
                meter={<ContextMeter computerId={chat.computerId} sessionId={chat.sessionId} />}
                onToggleGoal={() => store.toggleGoal(chat.id)}
                onClearGoal={() => store.clearGoal(chat.id)}
                onRemoveQueued={(q) => store.removeQueued(chat.id, q)}
                offline={offline}
                restore={restore}
                onResume={
                  stopped
                    ? () => {
                        following.current = true
                        void store.send(
                          chat.id,
                          '\n\n<ramu-context>\nContinue where you left off.\n</ramu-context>',
                          'steer',
                        )
                      }
                    : undefined
                }
                editing={
                  editing
                    ? { label: `Editing your message · the agent is told it replaces the earlier one` }
                    : undefined
                }
                onCancelEdit={() => {
                  setEditing(null)
                  setRestore((r) => ({ text: '', n: (r?.n ?? 0) + 1 }))
                }}
                placeholder={offline ? `Message · sends when ${computer?.name ?? 'it'} is back` : undefined}
              />
            </View>
            <Presence
              visible={away}
              fade={false}
              style={{ position: 'absolute', alignSelf: 'center', bottom: composerHeight + space.s }}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Scroll to latest"
                onPress={() => {
                  tap()
                  following.current = true
                  setAway(false)
                  toEnd(true)
                }}
              >
                <Glass
                  radius={radius.full}
                  interactive
                  style={{
                    width: 40,
                    height: 40,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: floatingChrome ? undefined : c.raised,
                  }}
                >
                  {running ? (
                    <ActivityIndicator size="small" color={c.accent} />
                  ) : (
                    <ArrowDown size={18} color={c.text} strokeWidth={2} />
                  )}
                </Glass>
              </Pressable>
            </Presence>
          </KeyboardLift>
        </RowToggle.Provider>
      </MessageMenu.Provider>
      <Presence
        visible={Boolean(toast)}
        style={{ position: 'absolute', left: space.l, right: space.l, top: insets.top + (ios ? 52 : 56 + space.s) }}
      >
        <View pointerEvents="none">
          <Glass
            radius={radius.full}
            style={{
              paddingHorizontal: space.l,
              paddingVertical: space.m,
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.s,
              backgroundColor: floatingChrome ? undefined : c.raised,
            }}
          >
            <Check size={15} color={c.ok} />
            <T size={font.control} weight="500" numberOfLines={2} style={{ flex: 1 }}>
              {toast ?? lastToast.current}
            </T>
          </Glass>
        </View>
      </Presence>
      {!chat.pending ? (
        <ChatActionsSheet
          chat={chat}
          open={actions !== 'closed'}
          rename={actions === 'rename'}
          onClose={() => setActions('closed')}
        />
      ) : null}
      <Sheet open={sheet} onClose={() => setSheet(false)} title={branch || 'Source control'}>
        {(
          [
            {
              icon: CircleCheck,
              title: 'Commit',
              sub: !live
                ? 'Open Source Control'
                : changed
                  ? `${changed} file${changed === 1 ? '' : 's'} changed`
                  : 'No changes to commit',
              run: openScm,
            },
            {
              icon: CircleArrowUp,
              title: 'Commit & push',
              sub: changed ? 'AI message, commit all, push' : 'No changes to commit',
              run: quickCommit,
              off: !changed || busy,
            },
            { icon: CircleArrowUp, title: 'Push', sub: pushReason, run: push, off: !canPush || busy },
            {
              icon: GitCompareArrows,
              title: 'Review changes',
              sub: 'Inspect turn diffs and worktree changes',
              run: openChanges,
            },
            { icon: GitBranch, title: 'Branches', sub: 'Switch, create, stash, and sync', run: openScm },
          ] as const
        ).map((item) => (
          <Row
            key={item.title}
            disabled={'off' in item && item.off}
            style={{ opacity: 'off' in item && item.off ? 0.45 : 1 }}
            onPress={() => {
              setSheet(false)
              setTimeout(item.run, 300)
            }}
          >
            <item.icon size={19} color={c.soft} />
            <View style={{ flex: 1 }}>
              <T weight="600">{item.title}</T>
              <T size={font.caption} tone="muted">
                {item.sub}
              </T>
            </View>
          </Row>
        ))}
      </Sheet>
    </Screen>
  )
}
