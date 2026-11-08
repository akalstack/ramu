import { HelperDetails } from '../../../components/Helpers'
import { deliveryVisible, visibleText } from '../../../runtime/transcript'
import { finishedAnswerRow, transcriptScrollState } from '../../../runtime/chatViewport'
import { goBackOrHome } from '../../../runtime/navigation'
import { shareRows } from '../../../runtime/shareRows'
import { VIEW_ONLY_WRITE_NOTICE } from '../../../runtime/viewerAccess'
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react'
import {
  ActivityIndicator,
  Alert,
  Keyboard as SystemKeyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import {
  Activity,
  Archive,
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
  Users,
  X,
  Plug,
  MessageSquarePlus,
  Search,
  AppWindow,
} from 'lucide-react-native'
import { font, radius, space, useTheme } from '../../../theme'
import { belowHeader } from '../../../components/UndoToast'
import { ChatFindBar } from '../../../components/ChatFindBar'
import { MAKE_PAGE_PROMPT } from '@ramu/shared/artifacts'
import { useAutomation } from '../../../runtime/automation'
import { useChat, useStore, type OutboxItem } from '../../../runtime/store'
import { MODEL_WARNING_DEVICE_KEY, resolveModelChangeWarning } from '../../../runtime/busyMode'
import { sharedValue } from '@ramu/shared/sharedFields'
import { foldTurns } from '../../../runtime/turns'
import { withChangeCards } from '../../../runtime/changeCards'
import { sideChat } from '../../../runtime/sideChat'
import { limitPlaceholderKey, limitTrayModel, limitWaitOf } from '../../../runtime/limitTray'
import { fill, useT, useSay } from '../../../i18n'
import { LoadingMark } from '../../../components/AnimatedMark'
import { ProviderIcon } from '../../../components/Logos'
import { McpStatusSheet } from '../../../components/McpStatusSheet'
import { editFromHere } from '../../../runtime/editFromHere'
import { looseInvoke } from '../../../runtime/settingsModel'
import { formatChatDate, needsChatDate } from '@ramu/shared/chat/chatDates'
import { commitAndPush, pushBranch } from '../../../runtime/gitQuick'
import { STANDALONE } from '../../../runtime/types'
import { Header, HeaderButton, HeaderMenu, Screen, PageLegendList } from '../../../components/Screen'
import type { LegendListRef } from '@legendapp/list/react-native'
import Reanimated, { cancelAnimation, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'
import { SheetGroup, SheetOption } from '../../../components/SheetOptions'
import { ThreadActivity } from '../../../components/ThreadActivity'
import { WorkingLine } from '../../../components/WorkingLine'
import { BackgroundTerminals } from '../../../components/BackgroundTerminals'
import { BrowserActivity } from '../../../components/BrowserActivity'
import { BrowserNotice, useThreadBrowserTabs } from '../../../components/BrowserNotice'
import { useThreadToolActivity } from '../../../runtime/useThreadToolActivity'
import { ComputerActivity } from '../../../components/ComputerActivity'
import { ComputerUseNotice } from '../../../components/ComputerUseNotice'
import { translate } from '@ramu/shared/i18n'
import { quoteSource } from '@ramu/shared/chat/quoteSource'
import { showToast } from '../../../runtime/toast'
import { Composer } from '../../../components/Composer'
import { ContinueOnHostSheet } from '../../../components/ContinueOnHost'
import { teammatesOf } from '../../../components/Teammate'
import {
  draftMention,
  draftMentions,
  joiningTeammate,
  modelHandle,
  resolveMention,
  type AbilityModels,
} from '@ramu/shared/chat/teammateMentions'
import type { CustomAgent } from '@ramu/shared/customAgents'
import type { Chat, TranscriptItem } from '../../../runtime/types'
import { sameAgentSettings } from '@ramu/shared/chat/settingsChanges'
import type { AgentSettings, QueuedMessage, TeammateMode } from '@ramu/shared/types'
import {
  CancelPendingSettings,
  ChatMentions,
  MessageMenu,
  type MessageSelection,
  RowToggle,
  TranscriptListRow,
  type ItemMeta,
} from '../../../components/Transcript'
import { SelectionBar } from '../../../components/SelectionBar'
import { Button, Chip, ConnectionDot, IconButton, Segmented, Sheet, T, tap } from '../../../components/ui'
import { BottomFade, Glass, TopFade, floatingChrome } from '../../../components/Glass'
import { ComposerDock, KeyboardLift, useKeyboardHeight } from '../../../components/Keyboard'
import { PendingBubble } from '../../../components/Outbox'
import { PlanUsageSheet } from '../../../components/PlanUsage'
import { ContextMeter } from '../../../components/ContextMeter'
import { Presence, PressGrow, SentArrive, useReducedMotion } from '../../../components/Motion'
import { ChatActionsSheet, confirmChatDeletion, offerThreadUndo } from '../../../components/ChatActions'
import * as Clipboard from 'expo-clipboard'

/** Turns drawn at a time; a chat can have hundreds. */
const TURN_PAGE = 15

const RowSeparator = () => <View style={{ height: space.m + 2 }} />

/** A transcript row, or a message from this phone on its way to the host. */
type ListRow = TranscriptItem | { kind: 'pending'; id: string; outbox: OutboxItem }

/**
 * A choice that changes nothing the thread runs with, every field included: the login too, so switching accounts is
 * staged and shown for the next message like a model change rather than dropped.
 */
function keepsSettings(chat: Chat, m: import('../../../components/Composer').ModelChoice): boolean {
  if (!chat.settings)
    return m.provider === chat.provider && m.model === chat.model && (m.effort || '') === (chat.effort || '')
  return sameAgentSettings(chat.settings, {
    ...chat.settings,
    ...m.settings,
    provider: m.provider,
    model: m.model,
    effort: (m.effort || null) as AgentSettings['effort'],
  })
}

export default function ChatScreen() {
  const tr = useSay()
  const { id } = useLocalSearchParams<{ id: string }>()
  const chat = useChat(id)
  const { seeFailure } = useAutomation()
  const [continueHost, setContinueHost] = useState<string | null>(null)
  const [mcpOpen, setMcpOpen] = useState(false)
  // What the composer changed for a teammate the draft brings in, kept for that target only.
  const [joinEdits, setJoinEdits] = useState<{
    key: string
    model?: import('../../../components/Composer').ModelChoice
    mode?: TeammateMode
  }>({ key: '' })
  const failedAt = chat?.status === 'failed' ? chat.lastActiveAt : null
  useFocusEffect(
    useCallback(() => {
      if (failedAt !== null) seeFailure({ id, lastActiveAt: failedAt })
    }, [failedAt, id, seeFailure]),
  )
  const { c } = useTheme()
  const t = useT()
  const store = useStore()
  const latestStore = useRef(store)
  latestStore.current = store
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const scroll = useRef<LegendListRef>(null)
  // The host's row for a message sent from here keeps the key its sending row had (see listRows).
  const aliases = useRef(new Map<string, string>())
  const handedOver = useRef<OutboxItem[]>([])
  // The keys the list showed last render, so a row that replaces others can keep one of their keys.
  const shownKeys = useRef<string[]>([])
  const rowKey = (item: ListRow) => aliases.current.get(item.id) ?? item.id
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
  // A long thread renders top-down in batches; jumping to its end after each batch showed the whole transcript
  // scrolling past. It stays hidden until its size settles at the end, then appears already there.
  const [revealed, setRevealed] = useState(false)
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const revealCap = useRef<ReturnType<typeof setTimeout> | null>(null)
  const settleReveal = () => {
    if (revealed) return
    // A started thread whose history is still on its way has nothing to show yet: wait for it, briefly.
    const loading = !!chat?.sessionId && !chat.items?.length
    revealCap.current ??= setTimeout(() => setRevealed(true), loading ? 2500 : 800)
    if (loading) return
    if (revealTimer.current) clearTimeout(revealTimer.current)
    revealTimer.current = setTimeout(() => setRevealed(true), 150)
  }
  useEffect(
    () => () => {
      if (revealTimer.current) clearTimeout(revealTimer.current)
      if (revealCap.current) clearTimeout(revealCap.current)
    },
    [],
  )
  const reducedMotion = useReducedMotion()
  const userScrolling = useRef(false)
  const [away, setAway] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [composerHeight, setComposerHeight] = useState(120)
  const [selection, setSelection] = useState<MessageSelection | null>(null)
  // The selection bar sits on the composer, and the jump-to-latest button stacks above it rather than under it.
  const [selectionBarHeight, setSelectionBarHeight] = useState(0)
  // iOS: the composer and keyboard cover the list's bottom through UIScrollView.contentInset, which moves no content.
  // The keyboard handler then sets the offset itself: the end when following, else the same lines stay above the keys.
  const ios = Platform.OS === 'ios'
  const slack = Math.max(0, insets.bottom - space.s)
  const coverFor = (keys: number) => composerHeight + (keys ? keys - slack : 0)
  const metrics = useRef({ offset: 0, content: 0, viewport: 0, cover: 0 })
  // The list keeps itself at the end (maintainScrollAtEnd) once the chat is taller than the screen; a chat that fits
  // rests at its top, where UIKit puts it. That following pauses while the keyboard moves, so the list's own jump
  // never interrupts the scroll that moves with the keyboard, and right after a row is opened by hand, which keeps
  // its place.
  const [overflowing, setOverflowing] = useState(false)
  const [followPaused, setFollowPaused] = useState(false)
  const pauseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const settling = useRef(false)
  const pauseFollow = (ms: number, keyboardMoving: boolean) => {
    settling.current ||= keyboardMoving
    setFollowPaused(true)
    if (pauseTimer.current) clearTimeout(pauseTimer.current)
    pauseTimer.current = setTimeout(() => {
      pauseTimer.current = null
      const keyboardMoved = settling.current
      settling.current = false
      setFollowPaused(false)
      if (!keyboardMoved) return
      // Rows that arrived meanwhile were not followed; glide to them once.
      if (following.current && !userScrolling.current) toEnd(true)
    }, ms)
  }
  useEffect(
    () => () => {
      if (pauseTimer.current) clearTimeout(pauseTimer.current)
    },
    [],
  )
  // When the keyboard moves, the list moves with it: at the end it stays on the end (worked out once the new inset and
  // any just-sent message are laid out, so it is one motion), elsewhere the same lines stay above the keys.
  const keyboardMove = useRef<'end' | number | null>(null)
  const keyboard = useKeyboardHeight((to) => {
    pauseFollow(500, true)
    const m = metrics.current
    const cover = coverFor(to)
    keyboardMove.current = following.current
      ? 'end'
      : ios
        ? Math.max(restTop.current, Math.min(m.content - m.viewport + cover, m.offset + cover - m.cover))
        : null
  })
  useEffect(() => {
    const move = keyboardMove.current
    if (move == null) return
    keyboardMove.current = null
    const frame = requestAnimationFrame(() =>
      move === 'end' ? toEnd(true) : scroll.current?.scrollToOffset({ offset: move, animated: true }),
    )
    return () => cancelAnimationFrame(frame)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [keyboard.height] by design; the values it reads beyond these are current as of that run
  }, [keyboard.height])
  const cover = ios ? coverFor(keyboard.height) : 0
  metrics.current.cover = cover
  // Native scroll-edge chrome overlays the list; UIKit supplies its top inset.
  const topInset = ios ? insets.top + (Number(Platform.Version) >= 26 ? 54 : 44) : 0
  // Where UIKit rests a chat that fits on screen: read from the list while it is short, since the bar's real height can
  // differ from the guess above.
  const measuredRest = useRef<number | null>(null)
  const restTop = useRef(-topInset)
  restTop.current = measuredRest.current ?? -topInset
  /** The end of a chat taller than the screen, past the composer and keyboard inset; a chat that fits stays put. */
  const endOffset = () => {
    const m = metrics.current
    // Not measured yet: an offset worked out from a zero-height viewport lands far down and hides the first messages.
    if (!m.viewport || !m.content) return null
    const end = m.content - m.viewport + m.cover
    return end > restTop.current + 1 ? end : null
  }
  const toEnd = (animated: boolean) => {
    animated = animated && !reducedMotion
    if (!ios) return scroll.current?.scrollToEnd({ animated })
    const end = endOffset()
    if (end !== null) scroll.current?.scrollToOffset({ offset: end, animated })
  }
  /**
   * The list follows the end itself once its end is past offset 0, since the native scroll to the end stops at 0. A
   * chat taller than the screen by less than the bar under it is followed here, and so is the change that first makes
   * the list follow (a long reply, the keyboard, a sent message), which the list does not follow itself.
   */
  const catchUp = () => {
    const end = endOffset()
    const listFollows = end !== null && end > 0
    const was = overflowing
    setOverflowing(listFollows)
    if (end === null || followPaused || !following.current || userScrolling.current) return
    // Before the chat is shown it lands on its end at once; afterwards a reply or a sent message glides into view.
    if (!listFollows || !was) toEnd(revealed)
  }
  /** Sending closes the keyboard; the list stays on the end if it was there, and stays put if the reader scrolled up. */
  const followSend = () => {
    if (keyboard.height > 0) SystemKeyboard.dismiss()
  }
  // The composer growing or shrinking moves the inset under the list; stay on the end.
  useEffect(() => {
    if (following.current && !followPaused && !userScrolling.current) toEnd(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [composerHeight] by design; the values it reads beyond these are current as of that run
  }, [composerHeight])
  // A row opened or closed by hand keeps its place; the agent's own output still follows the end afterwards.
  const holdScroll = useCallback(() => {
    pauseFollow(600, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pauseFollow only touches refs and stable setters
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
    /** The thread already has its own worktree, so it cannot move into a new one. */
    isolated: boolean
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
            isolated: bindings.some((b) => b.mode === 'worktree'),
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
  const teammates = useMemo(() => (chat ? teammatesOf(chat) : []), [chat])
  // Kept on this phone for this thread: after talking to a teammate, plain messages keep going to it.
  const [recipientId, setRecipientId] = useState<string | null>(null)
  const recipient = teammates.find((task) => task.agentId === recipientId) ?? null
  // A teammate's own work (its task, output, report, Stop), opened from its chip with a long press.
  const [teammateShown, setTeammateShown] = useState<string | null>(null)
  const viewer = computer?.access === 'viewer'
  const hostId = chat?.computerId
  const catalogs = hostId ? store.catalogs[hostId] : undefined
  // A device that may only view can talk to no one, so it is offered nothing to bring in either.
  const models = useMemo(
    () => (viewer ? [] : (catalogs ?? []).flatMap((catalog) => catalog.models)),
    [catalogs, viewer],
  )
  const [customAgents, setCustomAgents] = useState<CustomAgent[]>([])
  useEffect(() => {
    if (hostId && !viewer) void store.invoke(hostId, 'customAgents.list').then(setCustomAgents, () => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [hostId, viewer] by design; the store is current as of that run
  }, [hostId, viewer])
  const agents = useMemo(() => (viewer ? [] : customAgents), [customAgents, viewer])
  // `@images` and the other ability handles bring in whichever model the host picks for that ability.
  const [abilityModels, setAbilityModels] = useState<AbilityModels>({})
  useEffect(() => {
    if (hostId && !viewer) void store.invoke(hostId, 'abilities.teammateModels').then(setAbilityModels, () => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [hostId, viewer] by design; the store is current as of that run
  }, [hostId, viewer])
  const chatDraftKey = chat ? `${chat.computerId}:chat:${chat.taskId || chat.id}` : ''
  const draftText = (chatDraftKey && store.drafts[chatDraftKey]) || ''
  // Puts a draft in the box and the store at once, so who it brings in follows straight away.
  const writeDraft = (next: string) => {
    if (chatDraftKey) store.setDraft(chatDraftKey, next)
    setRestore({ text: next, n: Date.now() })
  }
  // Adding a teammate starts a message to the thread's own model; the composer then shows its settings to change.
  const startTeammate = () => {
    if (!chat) return
    const model =
      models.find((m) => m.provider === chat.provider && m.id === chat.model) ??
      models.find((m) => !m.isLegacy) ??
      models[0]
    if (model) writeDraft(`@${modelHandle(model)} ${draftText.replace(/^@\S+\s*/, '')}`)
  }
  const composerTeammate = useMemo(
    () => ({
      teammates: teammates.map((task) => ({ name: task.name, mode: task.teammate ?? ('review' as const) })),
      models,
      agents,
      mentions: draftMentions(teammates, models, agents, abilityModels),
      ...(viewer ? {} : { onAdd: startTeammate }),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- startTeammate reads the draft and chat current at the tap
    [teammates, models, agents, abilityModels, viewer],
  )
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
      return model && typeof model.provider === 'string' && !keepsSettings(chat, model)
        ? { chatId: chat.id, model }
        : null
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
  // Folded rows are rebuilt as new objects; keeping the unchanged ones lets each memoised row skip its render.
  const previousRows = useRef<TranscriptItem[]>([])
  const rows = useMemo(() => {
    const next = shareRows(
      previousRows.current,
      withChangeCards(
        foldTurns(chat?.items ?? [], chat?.status === 'running', chat?.status === 'needs-input'),
        reviews,
        chat?.sessionId,
      ),
    )
    previousRows.current = next
    return next
  }, [chat?.items, chat?.status, chat?.sessionId, reviews])
  const arrivalReady = useRef(false)
  const arrivalChat = useRef(id)
  if (arrivalChat.current !== id) {
    arrivalChat.current = id
    if (revealed) setRevealed(false)
    if (revealCap.current) clearTimeout(revealCap.current)
    revealCap.current = null
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
  // A quote in the composer leads back to the message it came from: that row scrolls into view and lights up.
  const [found, setFound] = useState<{ id: string; at: number } | null>(null)
  const findQuote = (quote: string) => {
    const messages = pageRows.flatMap((row, index) =>
      row.kind === 'text' || row.kind === 'user' || row.kind === 'report'
        ? [{ id: row.id, index, text: row.kind === 'report' ? row.body : row.text }]
        : [],
    )
    const source = quoteSource(messages, quote)
    if (!source) {
      showToast(translate(store.language, 'The quoted message is not in the loaded turns.'))
      return
    }
    following.current = false
    // A row not laid out yet can refuse to be scrolled to; the highlight still marks it once it is.
    try {
      scroll.current?.scrollToIndex({ index: source.index, animated: true, viewPosition: 0.3 })
    } catch {}
    setFound({ id: source.id, at: Date.now() })
  }
  // Find in the loaded turns: a match scrolls into view and lights up, as a quote's source does.
  const [finding, setFinding] = useState(false)
  const jumpToMatch = (match: { id: string; index: number }) => {
    following.current = false
    try {
      scroll.current?.scrollToIndex({ index: match.index, animated: true, viewPosition: 0.3 })
    } catch {}
    setFound({ id: match.id, at: Date.now() })
  }
  // When a turn finishes while the reader follows its end, an answer taller than the screen is read from its first line:
  // the list glides to its top and stops following, rather than leaving the reader at its last line.
  const latestRows = useRef(pageRows)
  latestRows.current = pageRows
  const isRunning = chat?.status === 'running'
  const wasRunning = useRef(isRunning)
  useEffect(() => {
    const finished = wasRunning.current && !isRunning
    wasRunning.current = isRunning
    if (!finished || !revealed || !following.current || userScrolling.current) return
    // After the finished turn folds under Worked for and its answer is measured.
    const timer = setTimeout(() => {
      if (!following.current || userScrolling.current) return
      const m = metrics.current
      const index = finishedAnswerRow(
        latestRows.current,
        (at) => scroll.current?.getState().sizeAtIndex(at) ?? 0,
        m.viewport ? m.viewport - m.cover - topInset - space.l : 0,
      )
      if (index === null) return
      following.current = false
      pauseFollow(800, false)
      scroll.current?.scrollToIndex({
        index,
        animated: !reducedMotion,
        viewPosition: 0,
        viewOffset: topInset + space.s,
      })
    }, 350)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the turn stops; the rest is read from refs then
  }, [isRunning])
  // Where each message sits in time and in its turn: date labels above turns, time and copy under each turn's last answer.
  const itemMeta = useMemo(() => {
    const map = new Map<string, ItemMeta>()
    let previous: number | undefined
    for (const row of pageRows) {
      if (row.kind !== 'user') continue
      const at = row.at || undefined
      if (needsChatDate(at, previous)) map.set(row.id, { date: formatChatDate(at!, Date.now(), store.language) })
      if (at) previous = at
    }
    // From the end, one pass: a reply is its turn's last when the next user or reply row after it is a user's.
    let nextIsUser = true
    for (let index = pageRows.length - 1; index >= 0; index--) {
      const row = pageRows[index]!
      if (row.kind === 'user') nextIsUser = true
      else if (row.kind === 'text') {
        if (nextIsUser) map.set(row.id, { ...map.get(row.id), footer: true })
        nextIsUser = false
      }
    }
    return map
  }, [pageRows, store.language])
  // New rows fade in on their own (`fresh` below). A screen-wide layout animation is not used here: it left the list's
  // row positions behind their measured sizes, drawing a tall message over the reply under it.
  const renderRow = ({ item }: { item: ListRow; index: number }) => {
    const key = rowKey(item)
    const fresh = !seen.current.has(key)
    seen.current.add(key)
    if (item.kind === 'pending')
      return (
        <SentArrive identity={key} start={fresh && item.outbox.createdAt >= openedAt.current}>
          <PendingBubble item={item.outbox} computer={computer?.name ?? 'the host'} onEdit={editPending} />
        </SentArrive>
      )
    const row = (
      <TranscriptListRow
        found={found?.id === item.id ? found.at : undefined}
        item={item}
        chat={chat!}
        date={itemMeta.get(item.id)?.date}
        footer={itemMeta.get(item.id)?.footer}
        // The newest reasoning or reply of a running turn is live: reasoning streams (also as the last step of a tool
        // group), and a reply fades in block by block.
        streaming={
          (item.kind === 'thinking' ||
            item.kind === 'text' ||
            (item.kind === 'tools' && item.entries.at(-1)?.kind === 'thinking')) &&
          running &&
          item === rows.at(-1)
        }
        fresh={fresh && item.kind !== 'user'}
        visible={contentScreenFocused && visibleContentRows.has(item.id)}
      />
    )
    // The host's copy of a message sent from here keeps its row's key, and finishes the rise the sent one began.
    return item.kind === 'user' && key.startsWith('pending:') ? (
      <SentArrive identity={key} start={false}>
        {row}
      </SentArrive>
    ) : (
      row
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
  const lastRow = rows.at(-1)
  const lastShowsWork =
    running &&
    (lastRow?.kind === 'thinking' ||
      (lastRow?.kind === 'tool' && lastRow.status === 'in_progress') ||
      (lastRow?.kind === 'tools' &&
        (lastRow.entries.at(-1)?.kind === 'thinking' || lastRow.tools.some((tool) => tool.status === 'in_progress'))))
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
  // While the draft starts with `@model` or `@custom-agent`, the composer's model chip and mode are that teammate's.
  const joinTarget =
    chat.settings && chat.sessionId && !viewer
      ? draftMention(draftText, teammates, models, agents, abilityModels)
      : null
  const joinStart = joinTarget && joinTarget.kind !== 'teammate' ? joiningTeammate(joinTarget, chat.settings!) : null
  const joinOwn = joinStart && joinEdits.key === joinStart.key ? joinEdits : null
  const joining = joinStart
    ? {
        ...joinStart,
        mode: joinOwn?.mode ?? joinStart.mode,
        model: joinOwn?.model ?? {
          provider: joinStart.settings.provider,
          model: joinStart.settings.model,
          effort: joinStart.settings.effort ?? '',
          settings: joinStart.settings,
        },
      }
    : null
  const chooseJoinModel = (m: import('../../../components/Composer').ModelChoice) => {
    if (!joining) return
    const found = models.find((entry) => entry.provider === m.provider && entry.id === m.model)
    const key = found && joinTarget?.kind === 'model' ? `model:${modelHandle(found)}` : joining.key
    setJoinEdits({ key, model: m, mode: joinOwn?.mode })
    if (found && key !== joining.key) writeDraft(draftText.replace(/^@\S+/, `@${modelHandle(found)}`))
  }
  const applyModel = (m: import('../../../components/Composer').ModelChoice) => {
    // As on the desktop: while the agent works, or is held at a usage limit (a change made to get unblocked, which the
    // next try or automatic resume must use), the change applies now; otherwise it waits for the next message.
    if (running || limitWait || !chat.sessionId) {
      setStaged(null)
      void store.setModel(chat.id, m.provider, m.model, m.effort, m.settings)
    } else setStaged(keepsSettings(chat, m) ? null : { chatId: chat.id, model: m })
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
  /** After Edit from here rewound the thread, the changed message goes out as an ordinary one, with the attachments it kept. */
  const submitEdit = async (
    text: string,
    mode: 'send' | 'queue' | 'steer',
    attachments?: string[],
    context?: import('@ramu/shared/types').FileContext[],
  ) => {
    requireWriteAccess()
    if (!editing) return
    const keep = editing.files.map((file) => file.id).filter((id) => !attachments?.includes(id))
    setEditing(null)
    followSend()
    await store.send(chat.id, text, mode, [...keep, ...(attachments ?? [])], context)
  }
  const offline = !store.isOnline(chat.computerId)
  // Keep the submitted text visible while the host accepts it.
  const pending = store.outbox.filter((o) => o.chatId === chat.id && !deliveryVisible(o, chat))
  // A message on its way is a row of the list, as T3 Code does it, not a footer: the list follows it in like any row,
  // and when the host's copy arrives that row keeps the same key. The list then sees one row whose size it already
  // knows, instead of a bubble removed from the footer and a new row it must measure, which moved the chat up and down.
  for (const sent of handedOver.current)
    if (!pending.some((item) => item.id === sent.id)) {
      const shown = visibleText(sent.text)
      const arrived = pageRows.findLast(
        (row) => row.kind === 'user' && row.text === shown && !aliases.current.has(row.id),
      )
      if (arrived) aliases.current.set(arrived.id, `pending:${sent.id}`)
    }
  handedOver.current = pending
  // A finished turn folds its steps into one "Worked for" row in their place. That row takes the key of the first step
  // it replaces, so the list knows its size at once (both are one collapsed line) instead of laying out an unmeasured
  // row at an estimate and moving the end when it is measured.
  const keysNow = new Set(pageRows.map(rowKey))
  pageRows.forEach((row, index) => {
    if (row.kind !== 'summary' || aliases.current.has(row.id)) return
    const before = index > 0 ? rowKey(pageRows[index - 1]!) : null
    const at = before === null ? 0 : shownKeys.current.indexOf(before) + 1
    const replaced = at > 0 || before === null ? shownKeys.current[at] : undefined
    if (replaced && !keysNow.has(replaced) && !replaced.startsWith('pending:')) aliases.current.set(row.id, replaced)
  })
  const listRows: ListRow[] = pending.length
    ? [...pageRows, ...pending.map((outbox) => ({ kind: 'pending' as const, id: `pending:${outbox.id}`, outbox }))]
    : pageRows
  shownKeys.current = listRows.map(rowKey)
  const editPending = (text: string) => setRestore((r) => ({ text, n: (r?.n ?? 0) + 1 }))
  // Editing a queued message takes it out of the queue first, so it is not sent while being changed.
  const editQueued = (message: QueuedMessage) => {
    store.removeQueued(chat.id, message.id)
    editPending(visibleText(message.text))
  }
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
  // As on the desktop: the host writes a hand-off of this conversation, and a new thread on the same checkout starts
  // with it as its first message, on this thread's settings. A thread made but not started is removed again.
  const continueInNewThread = () =>
    act(async () => {
      const host = chat.computerId
      const projectId =
        chat.projectId === STANDALONE ? STANDALONE : chat.projectId.slice(chat.projectId.indexOf(':') + 1)
      const prompt = await store.invoke(host, 'agent.continuationPrompt', chat.sessionId!)
      const task = await store.invoke(host, 'tasks.create', {
        projectId,
        title: `Continue: ${chat.title}`.slice(0, 60),
        mode: chat.mode,
        workspaceId: chat.workspaceId ?? undefined,
      })
      try {
        await store.invoke(host, 'agent.start', task.id, prompt, chat.settings ?? undefined, [], [])
      } catch (error) {
        await store.invoke(host, 'tasks.delete', task.id, false).catch(() => {})
        throw error
      }
      await store.refresh(host)
      router.push({ pathname: '/chat/[id]', params: { id: `${host}:${task.id}` } })
      return tr('Continued in {0}', { 0: task.title })
    })
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
    {
      icon: Search,
      label: tr('Find in conversation'),
      symbol: 'magnifyingglass' as const,
      group: 'tools' as const,
      onPress: () => setFinding(true),
    },
    // As on the desktop: one tap asks the agent to turn what the thread found into an artifact, after its current work.
    ...(chat.sessionId && chat.items.length && computer?.access !== 'viewer'
      ? [
          {
            icon: AppWindow,
            label: tr('Make a page from this thread'),
            symbol: 'macwindow' as const,
            group: 'tools' as const,
            onPress: () => {
              followSend()
              void store.send(chat.id, MAKE_PAGE_PROMPT, 'queue')
            },
          },
        ]
      : []),
    ...(chat.sessionId
      ? [
          {
            icon: Plug,
            label: tr('MCP servers'),
            symbol: 'powerplug' as const,
            group: 'tools' as const,
            onPress: () => setMcpOpen(true),
          },
        ]
      : []),
    ...(chat.sessionId && chat.taskId && computer?.access !== 'viewer'
      ? [
          {
            icon: MessageSquarePlus,
            label: tr('Continue in new thread'),
            symbol: 'plus.bubble' as const,
            group: 'tools' as const,
            onPress: () =>
              Alert.alert(
                tr('Continue in a new thread?'),
                tr('Start a new thread in this checkout using the current conversation as context.'),
                [
                  { text: tr('Cancel'), style: 'cancel' },
                  { text: tr('Continue'), onPress: () => void continueInNewThread() },
                ],
              ),
          },
        ]
      : []),
    ...(live && !live.isolated && chat.sessionId && computer?.access !== 'viewer'
      ? [
          {
            icon: GitFork,
            label: tr('Continue in a new worktree'),
            symbol: 'arrow.triangle.branch' as const,
            group: 'tools' as const,
            onPress: () =>
              Alert.alert(
                tr('Continue in a new worktree?'),
                tr(
                  'Start a new thread on a new branch in its own worktree, with the current conversation and a copy of the uncommitted changes, new files included. This checkout keeps its changes.',
                ),
                [
                  { text: tr('Cancel'), style: 'cancel' },
                  {
                    text: tr('Continue'),
                    onPress: () =>
                      void act(async () => {
                        const started = await store.invoke(
                          chat.computerId,
                          'threads.continueInWorktree',
                          chat.sessionId!,
                        )
                        return tr('Continued in {0}', { 0: started.title })
                      }),
                  },
                ],
              ),
          },
        ]
      : []),
    ...store.computers
      .filter((pc) => pc.id !== chat.computerId && pc.status === 'online' && computer?.access !== 'viewer')
      .map((pc) => ({
        icon: GitFork,
        label: tr('Continue on {0}', { 0: pc.name }),
        symbol: 'arrow.triangle.branch' as const,
        group: 'tools' as const,
        onPress: () => setContinueHost(pc.id),
      })),
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
          select: setSelection,
          goTo: (itemId) => {
            const index = pageRows.findIndex((row) => row.id === itemId)
            if (index < 0) return
            following.current = false
            // A row not laid out yet can refuse to be scrolled to.
            try {
              scroll.current?.scrollToIndex({ index, animated: true, viewPosition: 0 })
            } catch {}
          },
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
          // Edit from here, as on the desktop: the thread rewinds to before this message (stopping the agent first),
          // the agent's file changes since can be put back, and the message returns to the box to change and send.
          edit: async (seq, text, files) => {
            if (viewerNow() || !chat.sessionId) return
            if (!store.isOnline(chat.computerId)) {
              Alert.alert(tr('Edit from here?'), tr('Reconnect to {0} to edit from here.', { 0: computer?.name ?? '' }))
              return
            }
            const sessionId = chat.sessionId
            try {
              const done = await editFromHere({
                invoke: (method, ...args) => looseInvoke(latestStore.current.invoke)(chat.computerId, method, ...args),
                sessionId,
                seq,
                stillWritable: () => !viewerNow(),
                confirm: (revertable) =>
                  new Promise((resolve) =>
                    Alert.alert(
                      tr('Edit from here?'),
                      tr(
                        running
                          ? 'Stops the agent and rewinds the thread to before this message. Your prompt and attachments return to the message box.'
                          : 'Rewinds the thread to before this message. Your prompt and attachments return to the message box.',
                      ),
                      [
                        { text: tr('Cancel'), style: 'cancel', onPress: () => resolve(null) },
                        ...(revertable
                          ? [
                              {
                                text:
                                  revertable === 1
                                    ? tr('Revert 1 file too')
                                    : tr('Revert {0} files too', { 0: revertable }),
                                onPress: () => resolve('revert' as const),
                              },
                            ]
                          : []),
                        { text: tr('Edit from here'), onPress: () => resolve('keep' as const) },
                      ],
                      { cancelable: true, onDismiss: () => resolve(null) },
                    ),
                  ),
              })
              if (done !== 'rewound') return
              void latestStore.current.refresh(chat.computerId)
              setEditing({ seq, files })
              setRestore((r) => ({ text: visibleText(text), n: (r?.n ?? 0) + 1 }))
            } catch (error) {
              Alert.alert(tr('Edit from here?'), error instanceof Error ? error.message : String(error))
            }
          },
          quoteNew: (text) =>
            router.push({ pathname: '/new', params: { project: chat.projectId, quote: text.slice(0, 20_000) } }),
          aside: (text, from) => {
            if (!viewerNow() && chat.sessionId)
              router.push({ pathname: '/chat/[id]/aside', params: { id: chat.id, quote: text.slice(0, 20_000), from } })
          },
        }}
      >
        <ChatMentions.Provider value={composerTeammate.mentions}>
          <CancelPendingSettings.Provider value={() => setStaged(null)}>
            <RowToggle.Provider value={holdScroll}>
              <PageLegendList
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
                data={listRows}
                viewabilityConfig={contentViewability}
                onViewableItemsChanged={contentViewabilityChanged}
                // Earlier turns arrive above what you are reading; they must not move it.
                maintainVisibleContentPosition={pagedBack ? { data: true, size: true } : undefined}
                keyExtractor={rowKey}
                renderItem={renderRow}
                // Each kind keeps its own measured size, so unmeasured rows above and below are estimated closely.
                // A message on its way is measured as the sent message it becomes.
                getItemType={(item) => (item.kind === 'pending' ? 'user' : item.kind)}
                estimatedItemSize={260}
                drawDistance={400}
                // Lays out the newest rows first instead of the whole page from the top.
                initialScrollAtEnd
                // Pinned to the end, gliding as a reply streams in or a message is sent (the list gathers the changes of
                // half a second into one motion), and without motion before the chat is shown or with Reduce Motion on.
                // It stops following once the reader scrolls up past its threshold, and a chat that fits on screen is
                // left where UIKit rests it.
                maintainScrollAtEnd={overflowing && !followPaused ? { animated: revealed && !reducedMotion } : false}
                ItemSeparatorComponent={RowSeparator}
                style={{ flex: 1 }}
                contentInset={ios ? { bottom: cover } : undefined}
                scrollIndicatorInsets={ios ? { bottom: cover } : undefined}
                contentContainerStyle={{
                  padding: space.l,
                  paddingBottom: ios
                    ? space.l
                    : (floatingChrome ? composerHeight + space.l : space.l) + keyboard.height,
                }}
                onLayout={(event) => {
                  metrics.current.viewport = event.nativeEvent.layout.height
                  catchUp()
                }}
                onScroll={(event) => {
                  const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent
                  metrics.current.offset = contentOffset.y
                  if (
                    ios &&
                    !userScrolling.current &&
                    contentOffset.y < 0 &&
                    contentSize.height + metrics.current.cover <= layoutMeasurement.height + contentOffset.y
                  ) {
                    measuredRest.current = contentOffset.y
                    restTop.current = contentOffset.y
                  }
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
                  settleReveal()
                  catchUp()
                }}
                keyboardDismissMode="on-drag"
                keyboardShouldPersistTaps="handled"
                ListFooterComponent={
                  <View style={{ gap: space.m, paddingTop: space.m }}>
                    {/* The running turn's status at its end, as on the desktop: a shimmering label, unless the newest row
                        (reasoning, or a tool group at work) already says what the agent is doing. */}
                    <WorkingLine inline quiet={lastShowsWork} chat={chat} sending={pending.length > 0} />
                  </View>
                }
              />
              {/* Covers the transcript while it settles at its end, then fades away; the composer stays above it. */}
              <OpeningCover
                visible={!revealed}
                color={c.window}
                spinner={c.muted}
                top={topInset}
                bottom={composerHeight}
              />
              {ios ? null : <TopFade visible={scrolled} color={c.window} />}
              {finding ? <ChatFindBar rows={pageRows} onJump={jumpToMatch} onClose={() => setFinding(false)} /> : null}
              <KeyboardLift keyboard={keyboard}>
                <BottomFade height={composerHeight * 0.75} color={c.window} />
                {selection ? (
                  <View
                    style={{ position: 'absolute', left: 0, right: 0, bottom: composerHeight }}
                    onLayout={(event) => setSelectionBarHeight(event.nativeEvent.layout.height)}
                  >
                    <SelectionBar selection={selection} />
                  </View>
                ) : null}
                {/* iOS/web: the glass composer floats over the transcript, which scrolls beneath it. */}
                <ComposerDock onLayout={(e) => setComposerHeight(e.nativeEvent.layout.height)}>
                  {chat.status === 'archived' && !viewer ? (
                    // An archived thread takes no messages; it is unarchived first, which is offered right here.
                    <Glass
                      radius={radius.xl}
                      style={{
                        marginHorizontal: space.s + 2,
                        padding: space.m,
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: space.m,
                      }}
                    >
                      <Archive size={18} color={c.muted} />
                      <T tone="soft" style={{ flex: 1 }}>
                        {tr('This thread is archived.')}
                      </T>
                      <Button
                        kind="secondary"
                        title={tr('Unarchive')}
                        onPress={() =>
                          void store
                            .invoke(chat.computerId, 'tasks.archive', chat.taskId, false)
                            .then(() => store.refresh(chat.computerId))
                            .catch((error) =>
                              Alert.alert(tr('Unarchive'), error instanceof Error ? error.message : String(error)),
                            )
                        }
                      />
                    </Glass>
                  ) : (
                    <Composer
                      activity={
                        <>
                          <ThreadActivity
                            inlineStatus
                            chat={chat}
                            onEditQueued={offline ? undefined : editQueued}
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
                      model={joining ? joining.model : staged?.chatId === chat.id ? staged.model : currentModel}
                      onModel={joining ? chooseJoinModel : changeModel}
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
                        // `@lead` goes to the main agent; `@name` talks to a teammate here or brings a model or custom
                        // agent in; without a mention, a teammate chosen as the recipient gets it.
                        const lead = /^@(?:lead|main)\s+/i.test(text.trim())
                        if (lead) setRecipientId(null)
                        const mention =
                          chat.sessionId && chat.settings && !attachments?.length && !lead
                            ? resolveMention(text, teammates, models, agents, abilityModels)
                            : null
                        const target =
                          mention ??
                          (recipient && !lead && !attachments?.length && text.trim() && !text.trim().startsWith('/')
                            ? ({ kind: 'teammate', task: recipient, body: text.trim() } as const)
                            : null)
                        if (target && chat.sessionId && chat.settings) {
                          const base = chat.settings
                          const sessionId = chat.sessionId
                          if (target.kind === 'teammate')
                            return store
                              .invoke(chat.computerId, 'agent.messageTask', sessionId, target.task.agentId, target.body)
                              .then(() => setRecipientId(target.task.agentId))
                          // What the composer showed for this teammate is what it joins with.
                          const start = joiningTeammate(target, base)
                          const shown = joining?.key === start.key ? joining : null
                          const chosen = shown?.model
                          const settings: AgentSettings = chosen
                            ? {
                                ...start.settings,
                                ...chosen.settings,
                                provider: chosen.provider,
                                model: chosen.model,
                                effort: (chosen.effort || null) as AgentSettings['effort'],
                              }
                            : start.settings
                          return store
                            .invoke(
                              chat.computerId,
                              'agent.addTeammate',
                              sessionId,
                              settings,
                              shown?.mode ?? start.mode,
                              target.kind === 'agent' ? `${target.agent.instructions}\n\n${target.body}` : target.body,
                            )
                            .then((joined) => setRecipientId(joined.agentId))
                        }
                        followSend()
                        return store.send(chat.id, text, mode, attachments, context)
                      }}
                      taskId={chat.taskId || undefined}
                      chatId={chat.id}
                      onFindQuote={findQuote}
                      teammate={composerTeammate}
                      header={
                        joining ? (
                          // One row says who joins and how; × takes the mention out and the message goes to the thread again.
                          // The composer's text inset, so the row lines up with what is typed below it.
                          <View style={{ width: '100%', gap: 4, paddingLeft: space.s + 4, paddingVertical: 2 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
                              <ProviderIcon provider={joining.model.provider} size={14} />
                              <T size={font.control} weight="500" numberOfLines={1} style={{ flexShrink: 1 }}>
                                {tr('{0} joins as', { 0: joining.name })}
                              </T>
                              <View style={{ flex: 1, minWidth: 140, maxWidth: 220, marginLeft: 'auto' }}>
                                <Segmented<TeammateMode>
                                  small
                                  value={joining.mode}
                                  onChange={(mode) => setJoinEdits({ key: joining.key, model: joinOwn?.model, mode })}
                                  options={[
                                    { key: 'review', label: tr('Review') },
                                    { key: 'take-over', label: tr('Take over') },
                                  ]}
                                />
                              </View>
                              <IconButton
                                icon={X}
                                label={tr('Don’t add {0}', { 0: joining.name })}
                                size={32}
                                tone="muted"
                                onPress={() => writeDraft(draftText.replace(/^@\S+\s*/, ''))}
                              />
                            </View>
                            <T size={font.caption} tone="muted" numberOfLines={1} style={{ paddingBottom: 4 }}>
                              {joining.mode === 'review'
                                ? tr('Reads the changes and reports. Never edits.')
                                : tr('Edits while the lead waits, then hands back.')}
                            </T>
                          </View>
                        ) : teammates.length && !viewer ? (
                          <ScrollView
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            keyboardShouldPersistTaps="always"
                          >
                            {/* Who the next message goes to: a recipient, not a view, so the row says "To". */}
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
                              <T size={font.caption} tone="muted" style={{ paddingLeft: space.s, paddingRight: 2 }}>
                                {tr('To')}
                              </T>
                              <Chip
                                small
                                label={tr('Main agent')}
                                selected={!recipient}
                                onPress={() => setRecipientId(null)}
                              />
                              {teammates.map((task) => (
                                <Chip
                                  key={task.agentId}
                                  small
                                  icon={Users}
                                  label={task.name}
                                  maxLabelWidth={140}
                                  selected={recipient?.agentId === task.agentId}
                                  accessibilityLabel={tr('To {0}', { 0: task.name })}
                                  accessibilityHint={tr('Touch and hold to see its work')}
                                  onPress={() => setRecipientId(task.agentId)}
                                  onLongPress={() => setTeammateShown(task.agentId)}
                                />
                              ))}
                            </View>
                          </ScrollView>
                        ) : undefined
                      }
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
                      onSendQueuedNow={offline ? undefined : (q) => store.sendQueuedNow(chat.id, q)}
                      onSteerQueued={offline ? undefined : (q) => store.steerQueued(chat.id, q)}
                      onEditQueued={offline ? undefined : editQueued}
                      offline={offline}
                      restore={restore}
                      limited={!!limit && !running}
                      resumeLabel={limit && !stopped ? (limit.action === 'resume' ? t.resume : t.tryAgain) : undefined}
                      onResume={
                        limit && !running && limit.primary && !stopped
                          ? () => {
                              followSend()
                              void store.retryLimitNow(chat.id)
                            }
                          : stopped
                            ? () => {
                                followSend()
                                void store.send(
                                  chat.id,
                                  '\n\n<ramu-context>\nContinue where you left off.\n</ramu-context>',
                                  'steer',
                                )
                              }
                            : undefined
                      }
                      editing={
                        editing ? { label: tr('Rewound to before your message. Change it and send.') } : undefined
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
                                  ? new Date(limit.resetAt).toLocaleTimeString([], {
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })
                                  : '',
                              )
                            : joining
                              ? tr('Tell {0} what to do', { 0: joining.name })
                              : undefined
                      }
                    />
                  )}
                </ComposerDock>
                <Presence
                  visible={away}
                  fade={false}
                  // While the agent works it turns into a spinner, so a reader scrolled up still sees the turn is running.
                  style={{
                    position: 'absolute',
                    alignSelf: 'center',
                    bottom: composerHeight + (selection ? selectionBarHeight : 0) + space.s,
                  }}
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={tr('Scroll to latest')}
                    // The send button's size, so the two round controls match; the slop keeps the target at 44 points.
                    hitSlop={5}
                    onPress={() => {
                      tap()
                      following.current = true
                      userScrolling.current = false
                      setAway(false)
                      toEnd(true)
                    }}
                  >
                    {({ pressed }) => (
                      <PressGrow pressed={pressed}>
                        {/* Not interactive glass: its press bulge balloons a button this small over the transcript. */}
                        <Glass
                          radius={radius.full}
                          style={{
                            width: 34,
                            height: 34,
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: floatingChrome ? undefined : c.raised,
                          }}
                        >
                          {running ? (
                            <ActivityIndicator size="small" color={c.text} style={{ transform: [{ scale: 0.75 }] }} />
                          ) : (
                            <ArrowDown size={18} color={c.text} strokeWidth={2.4} />
                          )}
                        </Glass>
                      </PressGrow>
                    )}
                  </Pressable>
                </Presence>
              </KeyboardLift>
            </RowToggle.Provider>
          </CancelPendingSettings.Provider>
        </ChatMentions.Provider>
      </MessageMenu.Provider>
      {teammateShown ? (
        <HelperDetails
          task={chat.items
            .flatMap((item) => (item.kind === 'agents' ? item.agents : []))
            .findLast((agent) => agent.agentId === teammateShown)}
          chat={chat}
          onClose={() => setTeammateShown(null)}
        />
      ) : null}
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
      <ContinueOnHostSheet chat={chat} targetId={continueHost} onClose={() => setContinueHost(null)} />
      {chat.sessionId ? (
        <McpStatusSheet
          open={mcpOpen}
          onClose={() => setMcpOpen(false)}
          computerId={chat.computerId}
          sessionId={chat.sessionId}
          readOnly={computer?.access === 'viewer'}
        />
      ) : null}
    </Screen>
  )
}

/** A plain surface with Ramu's loading mark over a thread that is still settling, faded out once it is ready. */
function OpeningCover({
  visible,
  color,
  spinner,
  top,
  bottom,
}: {
  visible: boolean
  color: string
  spinner: string
  /** Where the floating header ends and the composer begins, from the window's top and bottom edges. */
  top: number
  bottom: number
}) {
  const say = useSay()
  const window = useWindowDimensions()
  const cover = useRef<ComponentRef<typeof View>>(null)
  // The cover's own top in the window: it is not the screen's, and the cover runs past the bottom edge.
  const [offset, setOffset] = useState<number | null>(null)
  const opacity = useSharedValue(visible ? 1 : 0)
  const [mounted, setMounted] = useState(visible)
  useEffect(() => {
    if (visible) {
      opacity.value = 1
      setMounted(true)
      return
    }
    opacity.value = withTiming(0, { duration: 200 }, (finished) => {
      if (finished) scheduleOnRN(setMounted, false)
    })
    return () => cancelAnimation(opacity)
  }, [visible, opacity])
  const fade = useAnimatedStyle(() => ({ opacity: opacity.value }))
  if (!mounted) return null
  return (
    <Reanimated.View
      ref={cover}
      pointerEvents="none"
      onLayout={() => cover.current?.measureInWindow((_, y) => setOffset(y))}
      style={[StyleSheet.absoluteFill, { backgroundColor: color }, fade]}
    >
      {offset === null ? null : (
        // Centered in what is visible between the floating header and the composer.
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: Math.max(top, offset) - offset,
            height: Math.max(0, window.height - bottom - Math.max(top, offset)),
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <LoadingMark color={spinner} label={say('Loading conversation')} />
        </View>
      )}
    </Reanimated.View>
  )
}
