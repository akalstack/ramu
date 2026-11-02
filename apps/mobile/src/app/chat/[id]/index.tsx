import { deliveryVisible } from '../../../runtime/transcript'
import { transcriptScrollState } from '../../../runtime/chatViewport'
import { goBackOrHome } from '../../../runtime/navigation'
import { VIEW_ONLY_WRITE_NOTICE } from '../../../runtime/viewerAccess'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Alert, FlatList, Platform, Pressable, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import {
  Activity,
  ArrowDown,
  Check,
  CircleArrowUp,
  CircleCheck,
  Folder,
  GitBranch,
  GitFork,
  GitCompareArrows,
  MessageCircleQuestion,
  Gauge,
  Globe,
  Monitor,
  Server,
  SquareTerminal,
} from 'lucide-react-native'
import { font, radius, space, useTheme } from '../../../theme'
import { belowHeader } from '../../../components/UndoToast'
import { useChat, useStore } from '../../../runtime/store'
import { MODEL_WARNING_DEVICE_KEY, resolveModelChangeWarning } from '../../../runtime/busyMode'
import { sharedValue } from '@ramu/shared/sharedFields'
import { foldTurns } from '../../../runtime/turns'
import { withChangeCards } from '../../../runtime/changeCards'
import { sideChat } from '../../../runtime/sideChat'
import { limitPlaceholderKey, limitTrayModel, limitWaitOf } from '../../../runtime/limitTray'
import { fill, useT, useSay } from '../../../i18n'
import { formatChatDate, needsChatDate } from '@ramu/shared/chat/chatDates'
import { commitAndPush, pushBranch } from '../../../runtime/gitQuick'
import { STANDALONE } from '../../../runtime/types'
import { Header, HeaderButton, HeaderMenu, Screen, PageFlatList } from '../../../components/Screen'
import { SheetGroup, SheetOption } from '../../../components/SheetOptions'
import { ThreadActivity } from '../../../components/ThreadActivity'
import { BackgroundTerminals } from '../../../components/BackgroundTerminals'
import { BrowserActivity } from '../../../components/BrowserActivity'
import { BrowserNotice, useThreadBrowserTabs } from '../../../components/BrowserNotice'
import { useThreadToolActivity } from '../../../runtime/useThreadToolActivity'
import { ComputerActivity } from '../../../components/ComputerActivity'
import { ComputerUseNotice } from '../../../components/ComputerUseNotice'
import { translate } from '@ramu/shared/i18n'
import { Composer } from '../../../components/Composer'
import type { TranscriptItem } from '../../../runtime/types'
import type { AgentSettings } from '@ramu/shared/types'
import {
  CancelPendingSettings,
  MessageMenu,
  RowToggle,
  TranscriptListRow,
  type ItemMeta,
} from '../../../components/Transcript'
import { ConnectionDot, Sheet, T, tap } from '../../../components/ui'
import { BottomFade, Glass, TopFade, floatingChrome } from '../../../components/Glass'
import { ComposerDock, KeyboardLift, useKeyboardHeight } from '../../../components/Keyboard'
import { PendingBubble } from '../../../components/Outbox'
import { PlanUsageSheet } from '../../../components/PlanUsage'
import { ContextMeter } from '../../../components/ContextMeter'
import { Arrive, Presence, animateLayout, useReducedMotion } from '../../../components/Motion'
import { ChatActionsSheet, confirmChatDeletion, offerThreadUndo } from '../../../components/ChatActions'
import * as Clipboard from 'expo-clipboard'

/** Turns drawn at a time; a chat can have hundreds. */
const TURN_PAGE = 15

const RowSeparator = () => <View style={{ height: space.m + 2 }} />

export default function ChatScreen() {
  const tr = useSay()
  const { id } = useLocalSearchParams<{ id: string }>()
  const chat = useChat(id)
  const { c } = useTheme()
  const t = useT()
  const store = useStore()
  const latestStore = useRef(store)
  latestStore.current = store
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const scroll = useRef<FlatList<import('../../../runtime/types').TranscriptItem>>(null)
  const [contentScreenFocused, setContentScreenFocused] = useState(false)
  const toolActivity = useThreadToolActivity(chat, contentScreenFocused)
  const [visibleContentRows, setVisibleContentRows] = useState<Set<string>>(() => new Set())
  const contentViewability = useRef({ itemVisiblePercentThreshold: 1 }).current
  const contentViewabilityChanged = useRef(({ viewableItems }: { viewableItems: { item: { id: string } }[] }) => {
    const ids = new Set(viewableItems.map((row) => row.item.id))
    setVisibleContentRows((previous) =>
      previous.size === ids.size && [...ids].every((id) => previous.has(id)) ? previous : ids,
    )
  }).current
  useFocusEffect(
    useCallback(() => {
      setContentScreenFocused(true)
      return () => setContentScreenFocused(false)
    }, []),
  )
  const following = useRef(true)
  const smoothSendScroll = useRef(false)
  const reducedMotion = useReducedMotion()
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
  // Native scroll-edge chrome overlays the list; UIKit supplies its top inset.
  const topInset = ios ? insets.top + (Number(Platform.Version) >= 26 ? 54 : 44) : 0
  const restTop = useRef(-topInset)
  restTop.current = -topInset
  const toEnd = (animated: boolean) => {
    animated = animated && !reducedMotion
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [composerHeight] by design; the values it reads beyond these are current as of that run
  }, [composerHeight])
  // A row opened or closed by hand keeps the scroll position; content growth from the agent still follows the end.
  const held = useRef(0)
  const holdScroll = useCallback(() => {
    held.current = Date.now()
  }, [])
  const [restore, setRestore] = useState<{ text: string; n: number }>()
  const computer = store.computers.find((x) => x.id === chat?.computerId)
  const viewOnly = computer?.access === 'viewer'
  const viewerNow = () =>
    latestStore.current.computers.find((host) => host.id === chat?.computerId)?.access === 'viewer'
  const requireWriteAccess = () => {
    if (viewerNow()) throw new Error(VIEW_ONLY_WRITE_NOTICE[latestStore.current.language])
  }
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
  const [usageOpen, setUsageOpen] = useState(false)
  const [tool, setTool] = useState<'browser' | 'computer' | null>(null)
  const browserTabs = useThreadBrowserTabs(chat)
  const [backgroundFor, setBackgroundFor] = useState<string | null>(null)
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
      // eslint-disable-next-line react-hooks/exhaustive-deps -- recomputes on [chat?.id, chat?.taskId, chat?.computerId, chat?.projectId, chat?.st...] by design; the values it reads beyond these are current as of that run
    }, [chat?.id, chat?.taskId, chat?.computerId, chat?.projectId, chat?.status, computer?.status, refresh]),
  )
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [focused, hasNotice, chat?.id] by design; the values it reads beyond these are current as of that run
  }, [focused, hasNotice, chat?.id])
  // Editing a sent message keeps its place with the draft text: leaving the chat or restarting does not drop it.
  const editDraftKey = chat ? `${chat.computerId}:chat:${chat.taskId || chat.id}:editing` : null
  const storedEdit = editDraftKey ? store.drafts[editDraftKey] : undefined
  const editing = useMemo(() => {
    if (!storedEdit) return null
    try {
      const edit = JSON.parse(storedEdit) as { seq: number; files: import('@ramu/shared/types').Attachment[] }
      return typeof edit?.seq === 'number' && Array.isArray(edit.files) ? edit : null
    } catch {
      return null
    }
  }, [storedEdit])
  const setEditing = (next: { seq: number; files: import('@ramu/shared/types').Attachment[] } | null) => {
    if (editDraftKey) store.setDraft(editDraftKey, next ? JSON.stringify(next) : '')
  }
  // A model chosen for the next send is a draft like the message text: it survives leaving the chat and restarting.
  const modelDraftKey = chat ? `${chat.computerId}:chat:${chat.taskId || chat.id}:model` : null
  const storedModel = modelDraftKey ? store.drafts[modelDraftKey] : undefined
  const staged = useMemo(() => {
    if (!chat || !storedModel) return null
    try {
      const model = JSON.parse(storedModel) as import('../../../components/Composer').ModelChoice
      const same =
        model.provider === chat.provider &&
        model.model === chat.model &&
        (model.effort || '') === (chat.effort || '') &&
        (model.settings?.access ?? chat.settings?.access) === chat.settings?.access &&
        (model.settings?.autoFallback ?? chat.settings?.autoFallback) === chat.settings?.autoFallback &&
        (model.settings?.serviceTier ?? chat.settings?.serviceTier) === chat.settings?.serviceTier
      return model && typeof model.provider === 'string' && !same ? { chatId: chat.id, model } : null
    } catch {
      return null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recomputes on [storedModel, chat?.id, chat?.provider, chat?.model, chat?.effort, c...] by design; the values it reads beyond these are current as of that run
  }, [storedModel, chat?.id, chat?.provider, chat?.model, chat?.effort, chat?.settings])
  const setStaged = (next: { chatId: string; model: import('../../../components/Composer').ModelChoice } | null) => {
    if (modelDraftKey) store.setDraft(modelDraftKey, next ? JSON.stringify(next.model) : '')
  }
  // New chat blocks animate in; first loads, history pagination and recycled rows do not.
  const openedAt = useRef(Date.now())
  const seen = useRef(new Set<string>())
  // Finished turns fold into "Worked for…"; the running turn renders block by block, and only its newest reply animates.
  // The host streams the open thread's transcript in full and every other thread in brief, so a thread on screen asks for it.
  useEffect(() => {
    if (!chat?.sessionId) return
    return store.watch(chat.computerId, ['agent:event'], { 'agent:event': [chat.sessionId] })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [chat?.computerId, chat?.sessionId] by design; the values it reads beyond these are current as of that run
  }, [chat?.computerId, chat?.sessionId])
  // Recorded change reviews end their turns as Changes cards, as on desktop; re-read whenever the thread settles.
  const [reviews, setReviews] = useState<import('@ramu/shared/types').ChangeReview[]>([])
  useEffect(() => {
    if (!chat?.sessionId || chat.status === 'running' || !store.isOnline(chat.computerId)) return
    let alive = true
    store
      .invoke(chat.computerId, 'reviews.list', chat.sessionId)
      .then((list) => alive && setReviews(list))
      .catch(() => {})
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [chat?.computerId, chat?.sessionId, chat?.status] by design; the values it reads beyond these are current as of that run
  }, [chat?.computerId, chat?.sessionId, chat?.status])
  const rows = useMemo(
    () =>
      withChangeCards(
        foldTurns(chat?.items ?? [], chat?.status === 'running', chat?.status === 'needs-input'),
        reviews,
        chat?.sessionId,
      ),
    [chat?.items, chat?.status, chat?.sessionId, reviews],
  )
  const arrivalReady = useRef(false)
  const arrivalChat = useRef(id)
  if (arrivalChat.current !== id) {
    arrivalChat.current = id
    seen.current.clear()
    arrivalReady.current = false
    openedAt.current = Date.now()
  }
  const initialItems = chat?.items
  if (!arrivalReady.current && initialItems?.length) {
    for (const row of rows) seen.current.add(row.id)
    arrivalReady.current = true
  }
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
    const shown = hidden ? rows.slice(users[hidden]!) : rows
    // A model change waiting for the next send is drawn at the end of the chat, like the "Context handoff" it becomes.
    const waiting = staged && chat && staged.chatId === chat.id && chat.settings ? staged.model : null
    const pageRows: TranscriptItem[] = waiting
      ? [
          ...shown,
          {
            kind: 'note',
            id: 'pending-settings',
            title: '',
            pending: true,
            detail:
              waiting.provider !== chat!.provider ? 'Context handoff · applies when you send' : 'Applies when you send',
            previous: chat!.settings!,
            settings: {
              ...chat!.settings!,
              ...waiting.settings,
              provider: waiting.provider,
              model: waiting.model,
              effort: (waiting.effort || null) as AgentSettings['effort'],
            },
          },
        ]
      : shown
    return { pageRows, hiddenTurns: hidden }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recomputes on [rows, turnsShown, staged, chat?.id, chat?.provider, chat?.settings] by design; the values it reads beyond these are current as of that run
  }, [rows, turnsShown, staged, chat?.id, chat?.provider, chat?.settings])
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
  // New rows ease the rows around them into place instead of the list jumping.
  const rowCount = useRef<number | null>(null)
  const itemCount = chat?.items.length ?? 0
  useEffect(() => {
    if (rowCount.current !== null && itemCount > rowCount.current) animateLayout(180)
    rowCount.current = itemCount
  }, [itemCount])
  const renderRow = ({ item }: { item: TranscriptItem; index: number }) => {
    const fresh = !seen.current.has(item.id)
    seen.current.add(item.id)
    return (
      <TranscriptListRow
        item={item}
        chat={chat!}
        date={itemMeta.get(item.id)?.date}
        footer={itemMeta.get(item.id)?.footer}
        streaming={false}
        fresh={fresh && item.kind !== 'user'}
        visible={contentScreenFocused && visibleContentRows.has(item.id)}
      />
    )
  }
  if (!chat)
    return (
      <Screen>
        <Header title={tr('Thread not found')} />
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
  // Held at a usage limit: the tray, queue label and play button follow limitTrayModel, never a failed turn.
  const limitWait = limitWaitOf(chat.items)
  const limit = limitWait
    ? limitTrayModel(limitWait, chat.settings, store.appPreferences[chat.computerId]?.fallback)
    : null
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
    if (
      !switching ||
      !started ||
      !resolveModelChangeWarning(
        store.drafts?.[MODEL_WARNING_DEVICE_KEY],
        sharedValue(store.mobileLayers?.[chat.computerId], 'modelChangeWarning'),
        store.appPreferences[chat.computerId]?.warnModelChange,
      ).warn
    )
      return applyModel(m)
    Alert.alert(
      'Change model mid-conversation?',
      'The new model cannot reuse the cache built for this conversation, so the first message after the change uses more of your usage than usual.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Change', onPress: () => applyModel(m) },
        {
          text: "Change, don't warn again",
          onPress: () => {
            store.setDraft(MODEL_WARNING_DEVICE_KEY, 'off')
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
    requireWriteAccess()
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
        requireWriteAccess()
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
    requireWriteAccess()
    const outgoing = `${text}\n\n<ramu-context>\nThis revises my earlier message ${editing.seq}.${restored ? ' Selected file changes from that message and later captured runs were restored using Ramu. Inspect current files before acting.' : ' Files have not been restored.'} Treat this revised request as replacing the earlier request; the previous transcript remains as historical evidence.\n</ramu-context>`
    const keep = editing.files.map((file) => file.id).filter((id) => !attachments?.includes(id))
    setEditing(null)
    following.current = true
    await store.send(chat.id, outgoing, mode === 'send' ? 'queue' : mode, [...keep, ...(attachments ?? [])], context)
  }
  const offline = !store.isOnline(chat.computerId)
  // Keep the submitted text visible while the host accepts it.
  const pending = store.outbox.filter((o) => o.chatId === chat.id && !deliveryVisible(o, chat))
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
      `${computer?.name ?? 'This host'} · ${live.branch}\n\nRamu drafts the message with AI, commits every change, and pushes to origin.`,
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
  const openTerminal = () => router.push({ pathname: '/chat/[id]/terminal', params: { id: chat.id } })
  // Thread actions that belong to this screen sit above the shared ones (pin, rename, archive…) in the same sheet:
  // first the tools that look into the thread's workspace, then usage and where it runs.
  const say_ = (text: string) => translate(store.language, text)
  const chatExtras: {
    icon: typeof Folder
    label: string
    onPress?: () => void
    group: 'tools' | 'info'
    symbol?: import('../../../components/Screen').HeaderMenuAction['icon']
  }[] = [
    // A thread an agent started opens the thread that started it, as the desktop's header chip does.
    // A thread another host's agent started cannot be opened from here; the menu says where it came from.
    ...(chat.startedFrom?.host
      ? [
          {
            icon: GitFork,
            label: tr('From {0} on {1}', {
              '0': chat.startedFrom.title ?? tr('another thread'),
              '1': chat.startedFrom.host,
            }),
            symbol: 'arrow.triangle.branch' as const,
            group: 'info' as const,
            onPress: () => Alert.alert(tr('Started by an agent on {0}', { '0': chat.startedFrom!.host! })),
          },
        ]
      : []),
    ...(chat.startedFrom?.taskId
      ? [
          {
            icon: GitFork,
            label: tr('From {0}', { '0': chat.startedFrom.title ?? tr('another thread') }),
            symbol: 'arrow.triangle.branch' as const,
            group: 'info' as const,
            onPress: () =>
              router.push({
                pathname: '/chat/[id]',
                params: { id: store.resolveChat(chat.computerId, chat.startedFrom!.taskId!) },
              }),
          },
        ]
      : []),
    {
      icon: Folder,
      label: say_('Browse files'),
      symbol: 'folder',
      group: 'tools',
      onPress: () => router.push({ pathname: '/explorer', params: { computer: chat.computerId, ctx: chat.taskId } }),
    },
    { icon: SquareTerminal, label: say_('Terminal'), symbol: 'terminal', group: 'tools', onPress: openTerminal },
    {
      icon: Activity,
      label: say_('Background terminals'),
      symbol: 'list.bullet.rectangle',
      group: 'tools',
      onPress: () => setBackgroundFor(chat.id),
    },
    ...(chat.taskId
      ? [
          {
            icon: Globe,
            label: say_('Browser'),
            symbol: 'globe' as const,
            group: 'tools' as const,
            onPress: () => setTool('browser'),
          },
          {
            icon: Monitor,
            label: say_('Computer'),
            symbol: 'desktopcomputer' as const,
            group: 'tools' as const,
            onPress: () => setTool('computer'),
          },
        ]
      : []),
    ...(chat.sessionId
      ? [
          {
            icon: MessageCircleQuestion,
            label: say_('Side questions'),
            symbol: 'questionmark.bubble' as const,
            group: 'tools' as const,
            onPress: () => router.push({ pathname: '/chat/[id]/aside', params: { id: chat.id } }),
          },
        ]
      : []),
    {
      icon: Gauge,
      label: say_('Plan usage'),
      symbol: 'gauge.with.dots.needle.50percent',
      group: 'info',
      onPress: () => setUsageOpen(true),
    },
    // Which computer runs the thread: information only, so it has no action (and no native menu entry).
    {
      icon: Server,
      label: `${computer?.name ?? say_('Host unavailable')} · ${say_(computer?.status === 'online' ? 'Online' : computer?.status === 'connecting' ? 'Connecting…' : 'Offline')}`,
      group: 'info',
    },
  ]

  return (
    <Screen>
      <Header
        align="left"
        title={chat.title}
        subtitle={
          chat.projectId !== STANDALONE ? (
            // Where the thread works: its project and branch, under the title instead of inside the conversation.
            <View
              accessible
              accessibilityLabel={`Project ${project}${branch ? `, branch ${branch}` : ''}`}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: '100%' }}
            >
              {chat.startedFrom ? <GitFork size={11} color={c.muted} /> : null}
              <T size={12} tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
                {project}
              </T>
              {branch ? (
                <>
                  <GitBranch size={11} color={c.muted} />
                  <T size={12} mono tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
                    {branch}
                  </T>
                </>
              ) : null}
              <View
                accessible
                accessibilityLabel={`${computer?.name ?? say_('Host unavailable')} · ${say_(computer?.status === 'online' ? 'Online' : computer?.status === 'connecting' ? 'Connecting…' : 'Offline')}`}
              >
                <ConnectionDot status={computer?.status ?? 'offline'} size={5} />
              </View>
            </View>
          ) : (
            <View
              accessible
              accessibilityLabel={`Host: ${computer?.name ?? 'Unavailable'}, ${computer?.status ?? 'offline'}`}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: '100%' }}
            >
              <Monitor size={11} color={c.muted} />
              <T size={12} tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
                {computer?.name ?? 'Host unavailable'}
              </T>
              <ConnectionDot status={computer?.status ?? 'offline'} size={5} />
            </View>
          )
        }
        right={
          !chat.pending ? (
            <>
              {chat.projectId !== STANDALONE ? (
                <HeaderButton
                  icon={GitBranch}
                  label={tr('Source Control')}
                  systemIcon="arrow.triangle.branch"
                  onPress={() => setSheet(true)}
                />
              ) : (
                <HeaderButton
                  icon={Folder}
                  label={tr('Explorer')}
                  systemIcon="folder"
                  onPress={() =>
                    router.push({ pathname: '/explorer', params: { computer: chat.computerId, ctx: chat.taskId } })
                  }
                />
              )}
              <HeaderMenu
                label={tr('Thread actions')}
                onPress={() => setActions('menu')}
                actions={[
                  // The same groups as the sheet: workspace tools, usage, then the thread itself, with Delete last.
                  ...chatExtras
                    .filter((extra) => extra.onPress)
                    .map((extra) => ({
                      label: extra.label,
                      onPress: extra.onPress!,
                      icon: extra.symbol,
                      section: extra.group,
                    })),
                  ...(!viewOnly
                    ? [
                        {
                          label: say_(chat.pinnedAt !== null ? 'Unpin' : 'Pin to top'),
                          icon: (chat.pinnedAt !== null ? 'pin.slash' : 'pin') as 'pin',
                          section: 'thread',
                          onPress: () => {
                            if (viewerNow()) return
                            void latestStore.current
                              .invoke(chat.computerId, 'tasks.pin', chat.taskId, chat.pinnedAt === null)
                              .then(() => store.refresh(chat.computerId))
                              .catch((error) => say(String(error)))
                          },
                        },
                        {
                          label: say_('Rename'),
                          icon: 'pencil' as const,
                          section: 'thread',
                          onPress: () => {
                            if (!viewerNow()) setActions('rename')
                          },
                        },
                        ...(chat.settings && chat.titleGenerationState !== 'pending' && !offline
                          ? [
                              {
                                label: chat.titleGenerationState === 'failed' ? t.retryTitleGeneration : t.renameWithAI,
                                icon: 'sparkles' as const,
                                section: 'thread',
                                onPress: () => {
                                  if (viewerNow()) return
                                  void latestStore.current
                                    .invoke(chat.computerId, 'tasks.generateTitle', chat.taskId, chat.settings!, true)
                                    .then(() => store.refresh(chat.computerId))
                                    .catch((error) => say(String(error)))
                                },
                              },
                            ]
                          : []),
                        {
                          label: say_(chat.status === 'archived' ? 'Unarchive' : 'Archive'),
                          icon: 'archivebox' as const,
                          section: 'thread',
                          onPress: () => {
                            if (viewerNow()) return
                            const archiving = chat.status !== 'archived'
                            void latestStore.current
                              .invoke(chat.computerId, 'tasks.archive', chat.taskId, archiving)
                              .then(() => store.refresh(chat.computerId))
                              // Archiving leaves the thread, as the sheet's Archive does.
                              .then(() => {
                                if (!archiving) return
                                offerThreadUndo(latestStore.current, chat, 'archived')
                                goBackOrHome(router)
                              })
                              .catch((error) => say(String(error)))
                          },
                        },
                      ]
                    : []),
                  {
                    label: say_('Copy thread ID'),
                    icon: 'doc.on.doc' as const,
                    section: 'thread',
                    onPress: () => void Clipboard.setStringAsync(chat.taskId),
                  },
                  ...(!viewOnly
                    ? [
                        {
                          label: say_('Delete…'),
                          icon: 'trash' as const,
                          destructive: true,
                          section: 'danger',
                          onPress: () => {
                            if (!viewerNow())
                              void confirmChatDeletion(latestStore.current, chat, () => goBackOrHome(router))
                          },
                        },
                      ]
                    : []),
                ]}
              />
            </>
          ) : null
        }
      />
      <PlanUsageSheet
        hosts={[chat.computerId]}
        open={usageOpen}
        onClose={() => setUsageOpen(false)}
        provider={chat.provider}
        accountId={chat.settings?.accountId}
        context={
          <View style={{ padding: space.m }}>
            <ContextMeter computerId={chat.computerId} sessionId={chat.sessionId} />
          </View>
        }
      />
      <MessageMenu.Provider
        value={{
          readOnly: viewOnly,
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
            if (viewerNow() || !chat.sessionId) return
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
                      !viewerNow() &&
                      void latestStore.current
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
            if (viewerNow()) return
            setEditing({ seq, files })
            setRestore((r) => ({ text: text.split('\n\n<ramu-context>')[0]!, n: (r?.n ?? 0) + 1 }))
          },
          quoteNew: (text) =>
            router.push({ pathname: '/new', params: { project: chat.projectId, quote: text.slice(0, 20_000) } }),
          aside: (text, from) => {
            if (!viewerNow() && chat.sessionId)
              router.push({ pathname: '/chat/[id]/aside', params: { id: chat.id, quote: text.slice(0, 20_000), from } })
          },
        }}
      >
        <CancelPendingSettings.Provider value={() => setStaged(null)}>
          <RowToggle.Provider value={holdScroll}>
            <PageFlatList
              key={chat.id}
              ref={scroll}
              contentInsetAdjustmentBehavior="automatic"
              automaticallyAdjustsScrollIndicatorInsets
              ListHeaderComponent={
                <View style={{ gap: space.s, paddingBottom: space.m }}>
                  {chat.branchNamingFallback ? (
                    <T size={font.caption} tone="muted">
                      {t.branchNamingFallback}
                    </T>
                  ) : null}
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
                        minHeight: 44,
                        paddingHorizontal: space.l,
                        borderRadius: radius.full,
                        justifyContent: 'center',
                        backgroundColor: c.fill,
                      }}
                    >
                      <T size={font.control} weight="500" tone="soft">
                        {store.language === 'id' ? 'Tampilkan giliran sebelumnya' : 'Show earlier turns'}
                      </T>
                    </Pressable>
                  ) : null}
                </View>
              }
              data={pageRows}
              viewabilityConfig={contentViewability}
              onViewableItemsChanged={contentViewabilityChanged}
              maintainVisibleContentPosition={pagedBack ? { minIndexForVisible: 0 } : undefined}
              keyExtractor={(item) => item.id}
              renderItem={renderRow}
              initialNumToRender={20}
              maxToRenderPerBatch={12}
              windowSize={7}
              ItemSeparatorComponent={RowSeparator}
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
                const position = transcriptScrollState(
                  following.current,
                  gap,
                  userScrolling.current,
                  !!settling.current,
                )
                following.current = position.following
                setAway(position.away)
                setScrolled(contentOffset.y > 8 - topInset)
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
                if (following.current && !settling.current && Date.now() - held.current > 600) {
                  toEnd(smoothSendScroll.current && !reducedMotion)
                  smoothSendScroll.current = false
                }
              }}
              keyboardDismissMode="on-drag"
              keyboardShouldPersistTaps="handled"
              ListFooterComponent={
                <View style={{ gap: space.m, paddingTop: space.m }}>
                  {pending.map((o) => (
                    <Arrive key={o.id} animate={o.createdAt >= openedAt.current}>
                      <PendingBubble item={o} computer={computer?.name ?? 'the host'} onEdit={editPending} />
                    </Arrive>
                  ))}
                </View>
              }
            />
            {ios ? null : <TopFade visible={scrolled} color={c.window} />}
            <KeyboardLift keyboard={keyboard}>
              <BottomFade height={composerHeight * 0.75} color={c.window} />
              {/* iOS/web: the glass composer floats over the transcript, which scrolls beneath it. */}
              <ComposerDock onLayout={(e) => setComposerHeight(e.nativeEvent.layout.height)}>
                <Composer
                  activity={
                    <>
                      <ThreadActivity
                        chat={chat}
                        leading={
                          <>
                            <ComputerUseNotice chat={chat} onOpen={() => setTool('computer')} />
                            <BrowserNotice chat={chat} tabs={browserTabs.tabs} onOpen={() => setTool('browser')} />
                          </>
                        }
                        actions={[
                          ...(toolActivity.terminal
                            ? [{ label: 'Terminal', icon: SquareTerminal, onPress: openTerminal }]
                            : []),
                        ]}
                      >
                        <BackgroundTerminals
                          key={`${chat.computerId}:${chat.taskId}`}
                          chat={chat}
                          open={backgroundFor === chat.id}
                          onOpen={() => setBackgroundFor(chat.id)}
                          onClose={() => setBackgroundFor((current) => (current === chat.id ? null : current))}
                        />
                      </ThreadActivity>
                    </>
                  }
                  running={running}
                  model={staged?.chatId === chat.id ? staged.model : currentModel}
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
                      // One side chat per thread: /btw continues it rather than starting another.
                      return store
                        .invoke(chat.computerId, 'aside.list', chat.sessionId)
                        .then((asides) => {
                          const latest = asides.find((aside) => aside.id === sideChat(asides).continueId)
                          return store.invoke(
                            chat.computerId,
                            'aside.ask',
                            chat.sessionId!,
                            latest?.id ?? null,
                            latest?.quote ?? '',
                            latest?.quoteFrom ?? 'assistant',
                            side[1]!.trim(),
                          )
                        })
                        .then(() => {
                          router.push({ pathname: '/chat/[id]/aside', params: { id: chat.id } })
                        })
                    following.current = true
                    smoothSendScroll.current = true
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
                  onToggleGoal={() => store.toggleGoal(chat.id)}
                  onClearGoal={() => store.clearGoal(chat.id)}
                  onVerifyGoal={chat.sessionId ? (command) => store.setGoalVerify(chat.id, command) : undefined}
                  onRemoveQueued={(q) => store.removeQueued(chat.id, q)}
                  offline={offline}
                  restore={restore}
                  limited={!!limit && !running}
                  resumeLabel={limit && !stopped ? (limit.action === 'resume' ? t.resume : t.tryAgain) : undefined}
                  onResume={
                    limit && !running && limit.primary && !stopped
                      ? () => {
                          following.current = true
                          void store.retryLimitNow(chat.id)
                        }
                      : stopped
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
                  placeholder={
                    offline
                      ? `Message · sends when ${computer?.name ?? 'it'} is back`
                      : limit && !running
                        ? fill(
                            t[limitPlaceholderKey(limit)],
                            limit.resetAt !== undefined
                              ? new Date(limit.resetAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                              : '',
                          )
                        : undefined
                  }
                />
              </ComposerDock>
              <Presence
                visible={away}
                fade={false}
                style={{ position: 'absolute', alignSelf: 'center', bottom: composerHeight + space.s }}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={tr('Scroll to latest')}
                  // A small button keeps the transcript visible; the slop keeps the touch target at 44 points.
                  hitSlop={6}
                  onPress={() => {
                    tap()
                    following.current = true
                    userScrolling.current = false
                    setAway(false)
                    toEnd(true)
                  }}
                >
                  <Glass
                    radius={radius.full}
                    interactive
                    style={{
                      width: 32,
                      height: 32,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: floatingChrome ? undefined : c.raised,
                    }}
                  >
                    {running ? (
                      <ActivityIndicator size="small" color={c.text} style={{ transform: [{ scale: 0.75 }] }} />
                    ) : (
                      <ArrowDown size={16} color={c.text} strokeWidth={2} />
                    )}
                  </Glass>
                </Pressable>
              </Presence>
            </KeyboardLift>
          </RowToggle.Provider>
        </CancelPendingSettings.Provider>
      </MessageMenu.Provider>
      <Presence
        visible={Boolean(toast)}
        style={{ position: 'absolute', left: space.l, right: space.l, top: belowHeader(insets.top) }}
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
          extras={chatExtras}
          onGone={() => goBackOrHome(router)}
          open={actions !== 'closed'}
          rename={actions === 'rename'}
          onClose={() => setActions('closed')}
        />
      ) : null}
      <BrowserActivity
        key={`browser:${chat.computerId}:${chat.taskId}`}
        chat={chat}
        open={tool === 'browser'}
        onClose={() => setTool(null)}
      />
      <ComputerActivity
        key={`computer:${chat.computerId}:${chat.taskId}`}
        chat={chat}
        open={tool === 'computer'}
        onClose={() => setTool(null)}
      />
      <Sheet open={sheet} onClose={() => setSheet(false)} title={branch || tr('Source control')}>
        {(
          [
            [
              {
                icon: CircleCheck,
                title: 'Commit',
                sub: !live
                  ? 'Open Source Control'
                  : changed
                    ? changed === 1
                      ? '1 file changed'
                      : `${changed} files changed`
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
            ],
            [
              {
                icon: GitCompareArrows,
                title: 'Review changes',
                sub: 'Inspect turn diffs and worktree changes',
                run: openChanges,
              },
              {
                icon: GitBranch,
                title: 'Branches and history',
                sub: 'Switch, create, stash, and browse commits',
                run: openScm,
              },
            ],
          ] as const
        ).map((group) => (
          <SheetGroup key={group[0].title}>
            {group.map((item) => (
              <SheetOption
                key={item.title}
                icon={item.icon}
                title={tr(item.title)}
                help={tr(item.sub)}
                disabled={'off' in item && item.off}
                onPress={() => {
                  setSheet(false)
                  setTimeout(item.run, 300)
                }}
              />
            ))}
          </SheetGroup>
        ))}
      </Sheet>
    </Screen>
  )
}
