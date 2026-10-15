import { NO_PROJECT, RESPONSE_STYLE_LABELS } from '@ramu/shared/types'
import { chatCodeComponents } from '../ChatCodeBlock'
import { focusComposer } from '../ComposerInput'
import { clipText } from '@ramu/shared/text'
import { highlightSource } from '@ramu/shared/sourceNavigation'
import { ChatLink, ReferenceText } from '../ChatReferences'
import { remarkChatReferences, SKILL_REFERENCE_PREFIX } from '@ramu/shared/chatReferences'
import { Spinner } from '@/components/ui/spinner'
import { cachedData, ipcQueryKey, queryClient } from '../dataQueries'
import { useQuery } from '@tanstack/react-query'
import { t as translate, useLanguage, currentLanguage, formatLocale } from './../i18n'
import { LoadingDots } from '@/components/loading-dots'
import { AgentContentView } from '../AgentContentView'
import { toolKind, KIND_LABEL, KIND_VERB } from '@ramu/shared/agentTools'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { compactionLabel, isCompacting, isTurnFooter } from '@ramu/shared/compaction'
import { Button } from '@/components/desktop-button'
import { OverlayScrollArea } from '@/components/overlay-scroll-area'
import { Input } from '@/components/ui/input'
import type { FileContext } from '@ramu/shared/types'
import {
  SquarePen,
  Wrench,
  Globe,
  FilePenLine,
  FileMinus2,
  ArrowRightLeft,
  Settings2,
  Image as ImageIcon,
  ArrowDown,
  ArrowLeft,
  Plus,
  Bot,
  Brain,
  MessageCircle,
  Quote,
  BookOpen,
  CircleCheck,
  CircleSlash,
  CircleX,
  LoaderCircle,
  Search,
  Send,
  Square,
  X,
  Check,
  CornerDownRight,
  GitFork,
  ListEnd,
  MoreHorizontal,
  Pencil,
  Trash2,
  RotateCcw,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Minimize2,
  Copy,
  ShieldQuestion,
  SquareTerminal,
  Lightbulb,
  CalendarClock,
  MessageSquareText,
  ListChecks,
  Sparkles,
} from 'lucide-react'
import {
  describeRamuTool,
  ramuTool,
  ramuToolHasOwnUi,
  summarizeAgentStatuses,
  type RamuToolIcon,
} from '@ramu/shared/ramuTools'
import { Children, memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Markdown, { defaultUrlTransform, type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type {
  Attachment,
  ChatGoal,
  QueuedMessage,
  AgentEvent,
  AgentSettings,
  AgentSessionInfo,
  AgentSessionState,
  ViewDescriptor,
} from '@ramu/shared/types'
import { foldChatTurn as foldTurn, toolNeedsAttention, type ChatBlock as Block } from '@ramu/shared/chatFolding'
import { toolIsRunning, toolVerb } from '@ramu/shared/toolStatus'
import { agentActivityLabel } from '@ramu/shared/agentActivity'
import { ChatActivityButton } from '../ChatActivity'
import { GoalBar, GoalDone, GoalNote } from '../GoalBar'
import { goalChanges } from '@ramu/shared/goalHistory'
import { accessName, AgentControls, providerName } from '../AgentControls'
import { useAppSettings } from '../AppSettings'
import { reviewsByTurn } from '@ramu/shared/reviewGroups'
import { useReviews } from '../reviews'
import { FILE_DRAG_TYPE } from '../ComposerSuggestions'
import { ChatFind } from '../ChatFind'
import { paneFadeIn } from '../paneMotion'
import { formatKeys } from '../commands'
import {
  advisorTranscript,
  advisorAgentId,
  effectiveStatus,
  latestTasks,
  parseAdvice,
  parseTaskMessage,
  parseTaskReport,
  parseTaskStop,
} from '@ramu/shared/agentTasks'
import type { AgentTask, Aside } from '@ramu/shared/types'
import { createPortal } from 'react-dom'
import { ProviderRouteChip } from '../ProviderRoute'
import { CompressionMeter, ContextMeter } from '../Usage'
import { ProviderIcon } from '../ProviderIcon'
import { modelDisplayName, settingsNames, useModelSets } from '../ModelSets'
import { Textarea } from '@/components/ui/textarea'
import { slide } from '../slide'
import { animatePanelChange, reducedMotion } from '../panelMotion'
import { CommentsChip, pendingComments, sentComments } from '../ReviewChip'
import { SessionChangesButton, TurnChanges } from '../Changes'
import { SessionCheckpointButton } from '../SessionCheckpoint'
import { ScheduleChatCard } from '../Automation'
import { Attachments } from '../Attachments'
import { UndoRun } from '../UndoRun'
import { Composer } from '../Composer'
import { invoke, ramu, copyText } from '../ipc'
import { errorText } from '../TaskPane'
import { Dialog, Menu } from '../Menu'
import { useWorkspaceActions } from '../workspace'
import { formatChatDate, needsChatDate } from '@ramu/shared/chatDates'
import { ElicitationCard } from '../ElicitationCard'
import { QuestionDock, QuestionRow } from '../QuestionCard'
import { parseAnswerMessage, questionState, type QuestionState } from '@ramu/shared/questions'
import { localFileLink } from '@ramu/shared/fileLinks'
import { notifyError } from '../Notifications'
import { draftKey, loadDraft, saveDraft, useDraftPersistence } from '../drafts'
import { outbox, useOutbox, OUTBOX_LIMIT } from '../outbox'
import { useHostConnection } from '../computers'
import { registerWorkspaceCheckpoint } from '../workspaceCheckpoint'
import { HostWaitNote, ProviderWaitNote } from '../ProviderWait'
import { ComposerTray } from '../ComposerTray'
import { providerWaitOf } from '@ramu/shared/providerWait'

type AgentViewDesc = Extract<ViewDescriptor, { kind: 'agent' }>
type ToolUse = Extract<AgentEvent, { kind: 'tool-use' }>
type ToolResult = Extract<AgentEvent, { kind: 'tool-result' }>

const STATE_LABEL: Partial<Record<AgentSessionState, string>> = {
  'needs-input': 'Needs your input',
  failed: 'Failed',
}

const LIVE: AgentSessionState[] = ['starting', 'running', 'needs-input', 'idle']
const NEAR_BOTTOM_PX = 80

/** Consecutive tool calls collapse into one line, like "Ran 2 commands". */
function toBlocks(events: AgentEvent[]): Block[] {
  const blocks: Block[] = []
  const agentUpdates = new Map(
    events.flatMap((event) =>
      event.kind === 'agent' && event.taskType !== 'local_bash' ? [[event.agentId, event] as const] : [],
    ),
  )
  const seenAgents = new Set<string>()
  const goalNotes = goalChanges(events)
  const failed = new Set(
    events.flatMap((event) => (event.kind === 'tool-result' && event.isError ? [event.toolUseId] : [])),
  )
  // The call that started a sub-agent is the card it produced.
  const agentCalls = new Set(
    events.flatMap((event) =>
      event.kind === 'agent' && event.taskType !== 'local_bash' && event.toolUseId ? [event.toolUseId] : [],
    ),
  )
  for (const event of events) {
    // A sub-agent's own output lives in its panel; its card stands for it here.
    if (event.agentId && event.kind !== 'agent') continue
    if (event.kind === 'compaction' && event.state === 'started') continue
    // Keep one activity row at each agent's starting position,
    // updated with its latest state instead of repeating every progress event.
    if (event.kind === 'agent' && event.taskType !== 'local_bash') {
      if (!seenAgents.has(event.agentId)) {
        seenAgents.add(event.agentId)
        blocks.push({ kind: 'event', event: agentUpdates.get(event.agentId)! })
      }
      continue
    }
    // Background commands use their Bash row.
    if (event.kind === 'agent' && event.taskType === 'local_bash') continue
    // The advisor's card stands for its tool calls.
    if (event.kind === 'tool-use' && isAdvisorTool(event)) continue
    // Questions, goals, schedules and sub-agents have their own place in the chat; a failed call stays, since nothing else shows it.
    if (
      event.kind === 'tool-use' &&
      (ramuToolHasOwnUi(event) || agentCalls.has(event.toolUseId)) &&
      !failed.has(event.toolUseId)
    )
      continue
    // A goal leaves a line at each turning point; the rest of its ticks live in the tray.
    if (event.kind === 'goal' && goalNotes.has(event)) {
      blocks.push({ kind: 'event', event })
      continue
    }
    if (
      event.kind === 'goal' ||
      event.kind === 'queue' ||
      event.kind === 'tool-result' ||
      event.kind === 'state' ||
      event.kind === 'request-resolved' ||
      event.kind === 'question-state'
    )
      continue
    const last = blocks.at(-1)
    if (event.kind === 'tool-use') {
      if (last?.kind === 'tools') last.tools.push(event)
      else blocks.push({ kind: 'tools', tools: [event] })
    } else blocks.push({ kind: 'event', event })
  }
  return blocks
}

type Turn = {
  key: number
  user: Block | null
  items: Block[]
  ended: boolean
  interrupted?: boolean
  startedAt?: number
  endedAt?: number
}

const blockIndex = (block: Block, blocks: Block[]) =>
  block.kind === 'tools'
    ? blocks.findIndex((original) => original.kind === 'tools' && original.tools.includes(block.tools[0]!))
    : blocks.indexOf(block)

const blockAt = (block: Block): number | undefined => (block.kind === 'event' ? block.event.at : block.tools[0]?.at)

/** One user message and everything the agent did in answer to it. */
function toTurns(blocks: Block[], events: AgentEvent[]): Turn[] {
  const turns: Turn[] = []
  blocks.forEach((block, index) => {
    if (block.kind === 'event' && block.event.kind === 'user') {
      turns.push({ key: index, user: block, items: [], ended: false, startedAt: block.event.at })
      return
    }
    let turn = turns.at(-1)
    if (!turn) {
      turn = { key: -1, user: null, items: [], ended: false }
      turns.push(turn)
    }
    turn.items.push(block)
    if (block.kind === 'event' && block.event.kind === 'result') {
      turn.ended = true
      turn.interrupted = block.event.isError || /interrupt|abort/i.test(block.event.text)
      turn.endedAt = block.event.at
    }
  })
  // Terminal states also end turns without a provider result (interrupts and failures).
  const ends = new Map<AgentEvent | null, number>()
  let user: AgentEvent | null = null
  for (const event of events) {
    if (event.agentId) continue
    if (event.kind === 'user') user = event
    if (
      event.kind === 'state' &&
      ['idle', 'failed', 'stopped'].includes(event.state) &&
      event.at !== undefined &&
      !ends.has(user)
    )
      ends.set(user, event.at)
  }
  for (const turn of turns) turn.endedAt ??= ends.get(turn.user?.kind === 'event' ? turn.user.event : null)
  return turns
}

function formatDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

/** Seconds since `since`, ticking once a second while `active`. */
function useElapsed(since: number | undefined, active: boolean): number | null {
  useLanguage()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])
  return since && active ? Math.max(0, now - since) : null
}

/** Ramu's advisor tools: mcp__ramu__advisor from Claude, `advisor` on the ramu server from Codex. */
const isAdvisorTool = (e: { name: string; summary: string; input?: string }) => {
  const call = ramuTool(e)
  return call?.name === 'advisor' || call?.name === 'wait_for_advice'
}

/** MCP tools arrive as mcp__server__tool; show the tool name. */
const toolLabel = (name: string) => (name.startsWith('mcp__') ? name.split('__').slice(2).join('__') || name : name)

const VERBS: Record<string, [string, string, string]> = {
  Bash: ['Ran', 'command', 'commands'],
  Edit: ['Edited', 'file', 'files'],
  MultiEdit: ['Edited', 'file', 'files'],
  Write: ['Wrote', 'file', 'files'],
  NotebookEdit: ['Edited', 'notebook', 'notebooks'],
  Read: ['Read', 'file', 'files'],
  Grep: ['Searched', 'pattern', 'patterns'],
  Glob: ['Listed', 'pattern', 'patterns'],
  WebFetch: ['Fetched', 'page', 'pages'],
  WebSearch: ['Searched the web', '', ''],
}

function describeTools(tools: ToolUse[], results: Map<string, ToolResult>, active: boolean): string {
  const keyOf = (t: ToolUse) => {
    const call = ramuTool(t)
    return call ? `ramu:${call.name}` : t.name
  }
  const counts = new Map<string, number>()
  for (const t of tools) counts.set(keyOf(t), (counts.get(keyOf(t)) ?? 0) + 1)
  const parts = [...counts].map(([key, n]) => {
    const first = tools.find((t) => keyOf(t) === key)!
    const running = tools.some((t) => keyOf(t) === key && toolIsRunning(results.get(t.toolUseId), active))
    const call = ramuTool(first)
    if (call) {
      const row = describeRamuTool(call, results.get(first.toolUseId)?.summary)
      return `${translate(running ? row.running : row.done)}${n > 1 ? ` ×${n}` : row.subject ? ` ${row.subject}` : ''}`
    }
    const name = key
    const v = VERBS[name]
    if (!v) {
      const category = toolKind(first)
      return category === 'other'
        ? translate('Used {name}{count}', { name: toolLabel(name), count: n > 1 ? ` ×${n}` : '' })
        : `${translate(toolVerb(KIND_VERB[category], running))} ${n > 1 ? `${n} · ` : ''}${first.title ?? translate(KIND_LABEL[category])}`
    }
    const verb = translate(toolVerb(v[0], running))
    return v[1] ? translate('{verb} {count} {unit}', { verb, count: n, unit: translate(n === 1 ? v[1] : v[2]) }) : verb
  })
  return parts.join(', ')
}

// Per-chat presentation state belongs to the UI, separate from the data query cache.
const chatPresentation = new Map<string, { draft: string; attachments: Attachment[]; top: number; stick: boolean }>()

export const AgentView = memo(function AgentView({
  view,
  history,
  visible = true,
}: {
  view: AgentViewDesc
  history?: React.ReactNode
  visible?: boolean
}) {
  useLanguage()
  // Keep these queries observed while the chat is mounted. Hydration and live
  // events below reconcile revisions; observers only manage cache lifetime.
  useQuery({
    queryKey: ipcQueryKey('agent.get', view.sessionId),
    queryFn: () => ramu.invoke('agent.get', view.sessionId),
    enabled: false,
    notifyOnChangeProps: [],
  })
  useQuery({
    queryKey: ipcQueryKey('agent.events', view.sessionId),
    queryFn: () => ramu.invoke('agent.events', view.sessionId),
    enabled: false,
    notifyOnChangeProps: [],
  })
  const { preferences, save } = useAppSettings()
  const { reviews } = useReviews()
  const [eventSequences, setEventSequences] = useState<Map<AgentEvent, number>>(
    () => new Map((cachedData('agent.events', view.sessionId) ?? []).map((event, i) => [event, i + 1])),
  )
  const [attachments, setAttachments] = useState<Attachment[]>(
    () => chatPresentation.get(view.sessionId)?.attachments ?? [],
  )
  const [queuePaused, setQueuePaused] = useState(false)
  const [queued, setQueued] = useState<QueuedMessage[]>([])
  const [hydrating, setHydrating] = useState(() => !cachedData('agent.events', view.sessionId))
  const [session, setSession] = useState<AgentSessionInfo | null>(() => cachedData('agent.get', view.sessionId) ?? null)
  const [events, setEvents] = useState<AgentEvent[]>(() => cachedData('agent.events', view.sessionId) ?? [])
  const [liveText, setLiveText] = useState<AgentEvent | null>(null)
  const [draft, setDraft] = useState(
    () => chatPresentation.get(view.sessionId)?.draft ?? loadDraft(draftKey.chat(view.sessionId)),
  )
  useDraftPersistence(draftKey.chat(view.sessionId), draft)
  /** The sent message being edited in place: its sequence number, text and attachments. The composer and its draft are left alone. */
  const [editing, setEditing] = useState<{ seq: number; text: string; files: Attachment[] } | null>(null)
  const [pendingSettings, setPendingSettings] = useState<AgentSettings | null>(null)
  const [configuring, setConfiguring] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(chatPresentation.get(view.sessionId)?.stick ?? true)
  const latestChat = useRef({ session, events, draft, attachments })
  latestChat.current = { session, events, draft, attachments }
  useEffect(() => registerWorkspaceCheckpoint(async () => latestChat.current.attachments.length === 0), [])
  useLayoutEffect(() => {
    const saved = chatPresentation.get(view.sessionId)
    if (saved && scroller.current) scroller.current.scrollTop = saved.top
    return () => {
      const current = latestChat.current
      chatPresentation.set(view.sessionId, {
        draft: current.draft,
        attachments: current.attachments,
        top: scroller.current?.scrollTop ?? 0,
        stick: stick.current,
      })
      // Refresh cache lifetime on leaving an open chat, even if it was idle for
      // longer than the query's normal garbage-collection interval.
      if (current.session) queryClient.setQueryData(ipcQueryKey('agent.get', view.sessionId), current.session)
      queryClient.setQueryData(ipcQueryKey('agent.events', view.sessionId), current.events)
    }
  }, [view.sessionId])
  const scrollFrame = useRef(0)
  const [dropping, setDropping] = useState(false)
  const [finding, setFinding] = useState(false)
  const [findRequest, setFindRequest] = useState(0)
  // The sub-agent panel: one agent's transcript, or '*' for the list of all of them.
  const [openAgent, setOpenAgentState] = useState<string | null>(null)
  // The aside panel: one aside (a new one carries its quote), or '*' for the list.
  const [openAside, setOpenAsideState] = useState<AsideTarget | '*' | null>(null)
  // The aside and sub-agent dock land in one step and fade in, like the terminal: they hold whole transcripts that would otherwise
  // reflow on every frame of a width animation.
  const dock = useRef<HTMLDivElement>(null)
  const dockOpen = !!(openAside || openAgent)
  const dockWasOpen = useRef(dockOpen)
  useLayoutEffect(() => {
    if (dockWasOpen.current === dockOpen) return
    dockWasOpen.current = dockOpen
    return dockOpen ? paneFadeIn(dock.current) : undefined
  }, [dockOpen])
  // One side panel at a time.
  const setOpenAgent = (value: string | null | ((current: string | null) => string | null)) =>
    animatePanelChange(
      () => {
        setOpenAsideState(null)
        setOpenAgentState(value)
      },
      'chat',
      typeof value === 'function' ? () => value(openAgent) !== null : value !== null,
    )
  const setOpenAside = (value: typeof openAside) =>
    animatePanelChange(
      () => {
        setOpenAgentState(null)
        setOpenAsideState(value)
      },
      'chat',
      value !== null,
    )
  const [asides, setAsides] = useState<Aside[]>([])
  const panelOpen = openAside !== null || openAgent !== null
  useEffect(() => {
    let cancelled = false
    setAsides([])
    void invoke('aside.list', view.sessionId).then(
      (list) => {
        if (!cancelled) setAsides(list)
      },
      () => {},
    )
    const off = ramu.on('aside:changed', ({ sessionId, aside, asideId }) => {
      if (sessionId !== view.sessionId) return
      setAsides((current) =>
        aside
          ? [...current.filter((entry) => entry.id !== aside.id), aside].sort((a, b) => a.createdAt - b.createdAt)
          : current.filter((entry) => entry.id !== asideId),
      )
    })
    return () => {
      cancelled = true
      off()
    }
  }, [view.sessionId])
  const root = useRef<HTMLDivElement>(null)
  const [findQuery, setFindQuery] = useState<string | undefined>()
  const openFind = (query?: string) => {
    setFindQuery(query)
    setFinding(true)
    setFindRequest((n) => n + 1)
  }
  const closeFind = () => {
    setFinding(false)
    focusComposer(root.current)
  }
  // ⌘F (the chat.find command) opens find in whichever chat is on screen; hidden panes keep theirs closed.
  useEffect(() => {
    const onFind = (event: Event) => {
      if (root.current?.checkVisibility()) openFind((event as CustomEvent<{ query?: string } | null>).detail?.query)
    }
    window.addEventListener('ramu:find-in-chat', onFind)
    return () => window.removeEventListener('ramu:find-in-chat', onFind)
  }, [])
  // Eases to the bottom over a fixed, short time (the browser's own smooth scroll is slow and uneven over long distances); a wheel or touch stops it.
  const scrollToLatest = () => {
    const el = scroller.current
    if (!el) return
    cancelAnimationFrame(scrollFrame.current)
    if (reducedMotion()) {
      el.scrollTop = el.scrollHeight
      stick.current = true
      return
    }
    const from = el.scrollTop,
      start = performance.now()
    const duration = Math.min(420, 160 + Math.abs(el.scrollHeight - el.clientHeight - from) / 12)
    const stop = () => {
      cancelAnimationFrame(scrollFrame.current)
      el.removeEventListener('wheel', stop)
      el.removeEventListener('touchstart', stop)
    }
    el.addEventListener('wheel', stop, { passive: true, once: true })
    el.addEventListener('touchstart', stop, { passive: true, once: true })
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration),
        eased = 1 - Math.pow(1 - t, 3)
      el.scrollTop = from + (el.scrollHeight - el.clientHeight - from) * eased
      if (t < 1) scrollFrame.current = requestAnimationFrame(step)
      else {
        stick.current = true
        el.removeEventListener('wheel', stop)
        el.removeEventListener('touchstart', stop)
      }
    }
    scrollFrame.current = requestAnimationFrame(step)
  }
  const [edges, setEdges] = useState({ top: false, bottom: false })
  const measureEdges = () => {
    const el = scroller.current
    if (!el) return
    const top = el.scrollTop > 2,
      bottom = el.scrollHeight - el.scrollTop - el.clientHeight > 2
    setEdges((current) => (current.top === top && current.bottom === bottom ? current : { top, bottom }))
  }

  // Match the transcript's usable width, including non-overlay OS scrollbars.
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    let previousWidth = -1
    const measure = () => {
      // Measuring the transcript forces layout. Defer this stable scrollbar
      // gutter until release instead of doing it for every live drag frame.
      if (
        document.querySelector('[data-separator="active"], [data-workspace-split][data-dragging], [data-rail-dragging]')
      )
        return
      const width = el.offsetWidth - el.clientWidth
      if (width === previousWidth) return
      previousWidth = width
      root.current?.style.setProperty('--chat-scrollbar-width', `${width}px`)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    const release = new MutationObserver(measure)
    release.observe(document.documentElement, {
      subtree: true,
      attributes: true,
      attributeFilter: ['data-separator', 'data-dragging', 'data-rail-dragging'],
    })
    return () => {
      observer.disconnect()
      release.disconnect()
    }
  }, [])

  useEffect(() => {
    const cached = cachedData('agent.events', view.sessionId)
    setHydrating(!cached)
    setError(null)
    let cancelled = false,
      revision = 0,
      latestState: AgentSessionState | undefined
    const stored = new Map<number, { event: AgentEvent; revision: number }>(
      (cached ?? []).map((event, index) => [index + 1, { event, revision: 0 }]),
    )
    const refreshEvents = () => {
      setEventSequences(new Map([...stored].map(([seq, item]) => [item.event, seq])))
      const list = [...stored].sort(([a], [b]) => a - b).map(([, item]) => item.event)
      setEvents(list)
      queryClient.setQueryData(ipcQueryKey('agent.events', view.sessionId), list)
      const queue = list.findLast((e) => e.kind === 'queue')
      if (queue?.kind === 'queue') {
        setQueued(queue.messages)
        setQueuePaused(!!queue.paused)
      }
    }
    const hydrate = async () => {
      const requestedAt = revision
      const [s, evs] = await Promise.all([invoke('agent.get', view.sessionId), invoke('agent.events', view.sessionId)])
      if (cancelled) return
      evs.forEach((event, index) => {
        if ((stored.get(index + 1)?.revision ?? -1) <= requestedAt)
          stored.set(index + 1, { event, revision: requestedAt })
      })
      setSession({ ...s, state: latestState ?? s.state })
      refreshEvents()
      setHydrating(false)
    }
    setEvents(cached ?? [])
    setLiveText(null)
    void hydrate().catch((e) => {
      if (!cancelled) {
        setError(errorText(e))
        setHydrating(false)
      }
    })
    const reconnect = ramu.on('background:connection', ({ connected }) => {
      if (connected) void hydrate().catch(() => {})
    })
    const off = ramu.on('agent:event', ({ sessionId, event, seq }) => {
      if (sessionId !== view.sessionId) return
      revision++
      if (event.kind === 'state') {
        latestState = event.state
        setSession((s) => (s ? { ...s, state: event.state } : s))
        if (event.at === undefined) return
      }
      if (event.agentId && event.kind !== 'agent') {
        /* sub-agent output never streams into the main reply */
      } else if (event.kind === 'text') setLiveText(event)
      else if (event.kind === 'tool-use' || event.kind === 'result') setLiveText(null)
      if (seq !== undefined) stored.set(seq, { event, revision })
      else {
        const sameMessage =
          event.kind === 'text' && event.messageId
            ? [...stored].find(([, i]) => i.event.kind === 'text' && i.event.messageId === event.messageId)?.[0]
            : undefined
        stored.set(sameMessage ?? Math.max(0, ...stored.keys()) + 1, { event, revision })
      }
      refreshEvents()
      if (event.kind === 'settings')
        setSession((s) => (s ? { ...s, provider: event.settings.provider, settings: event.settings } : s))
    })
    return () => {
      cancelled = true
      off()
      reconnect()
    }
  }, [view.sessionId])

  useEffect(() => {
    if (session) queryClient.setQueryData(ipcQueryKey('agent.get', view.sessionId), session)
  }, [session, view.sessionId])

  // Follow new output only while the reader is already at the bottom.
  useEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
    measureEdges()
    // Markdown, code and images settle after the first paint and grow the content; follow that growth once more.
    const frame = requestAnimationFrame(() => {
      const node = scroller.current
      if (node && stick.current) {
        node.scrollTop = node.scrollHeight
        measureEdges()
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [events, session?.state, reviews])

  const outcomes = useMemo(
    () => new Map(events.flatMap((e) => (e.kind === 'request-resolved' ? [[e.requestId, e.outcome] as const] : []))),
    [events],
  )
  const questionStates = useMemo(
    () =>
      new Map(
        events.flatMap((e) =>
          e.kind === 'question' || e.kind === 'elicitation'
            ? [[e.requestId, questionState(events, e.requestId)] as const]
            : [],
        ),
      ),
    [events],
  )
  const [showQuestions, setShowQuestions] = useState(false)
  // Questions float above the message box; the transcript row opens them.
  const [questionDockOpen, setQuestionDockOpen] = useState(true)
  const [questionFocus, setQuestionFocus] = useState<{ requestId: string; at: number } | null>(null)
  const openQuestion = (requestId: string) => setQuestionFocus({ requestId, at: Date.now() })
  const results = useMemo(
    () => new Map(events.flatMap((e) => (e.kind === 'tool-result' ? [[e.toolUseId, e] as const] : []))),
    [events],
  )
  const blocks = useMemo(() => toBlocks(events), [events])
  const goalNotes = useMemo(() => goalChanges(events), [events])
  const latestAssistant = blocks.findLast((block) => block.kind === 'event' && block.event.kind === 'text')
  // A long chat draws its latest turns first; see "Earlier turns" below.
  const [shownTurns, setShownTurns] = useState(TURN_PAGE)
  const handledSource = useRef<string | null>(null)
  useEffect(() => {
    if (!visible || !view.sourceSeq || !events.length) return
    const request = view.sourceRequestId ?? `${view.sessionId}:${view.sourceSeq}`
    if (handledSource.current === request) return
    const source = events[view.sourceSeq - 1]
    const index = blocks.findIndex((b) =>
      b.kind === 'event'
        ? b.event === source
        : b.tools.some((t) => t === source || (source?.kind === 'tool-result' && t.toolUseId === source.toolUseId)),
    )
    const node = scroller.current?.querySelector(`[data-block-index="${index}"]`)
    // The message lives in a turn that is not drawn yet: bring every turn back, then this runs again.
    if (!node && index >= 0) {
      setShownTurns(Number.MAX_SAFE_INTEGER)
      return
    }
    if (node) {
      handledSource.current = request
      stick.current = false
      node.scrollIntoView({ block: 'center' })
      return highlightSource(node, () => {
        if (session?.taskId) ws.consumeSourceNavigation(session.taskId, view.id, view.sourceRequestId)
      })
    }
  }, [view.sourceSeq, view.sourceRequestId, events.length, visible, session?.taskId, shownTurns])
  const live = session ? LIVE.includes(session.state) : false
  const pendingQuestions = events.filter(
    (e): e is Extract<AgentEvent, { kind: 'question' | 'elicitation' }> =>
      (e.kind === 'question' || e.kind === 'elicitation') &&
      !outcomes.has(e.requestId) &&
      (e.kind === 'elicitation' ? live : e.responseMode === 'message' || live),
  )
  const dockQuestions = useMemo(
    () => pendingQuestions.filter((e): e is Extract<AgentEvent, { kind: 'question' }> => e.kind === 'question'),
    [events, live, outcomes],
  )
  // A new question opens the dock, even after "Answer later".
  const dockKey = dockQuestions.map((e) => e.requestId).join(',')
  const seenQuestions = useRef(new Set<string>())
  useEffect(() => {
    if (dockQuestions.some((e) => !seenQuestions.current.has(e.requestId))) setQuestionDockOpen(true)
    dockQuestions.forEach((e) => seenQuestions.current.add(e.requestId))
  }, [dockKey])
  const allTasks = useMemo(() => latestTasks(events), [events])
  const tasks = useMemo(() => allTasks.filter((task) => task.taskType !== 'local_bash'), [allTasks])
  const commands = allTasks.filter(
    (task) => task.taskType === 'local_bash' && task.background && effectiveStatus(task, live) === 'running',
  )
  const goalEvent = events.findLast((event) => event.kind === 'goal')
  const goal = goalEvent?.kind === 'goal' ? goalEvent.goal : null
  const liveGoal = goal && goal.status !== 'completed' ? goal : null
  const providerWait = useMemo(() => providerWaitOf(events), [events])
  const runningTasks = tasks.filter((task) => effectiveStatus(task, live) === 'running')
  const backgroundTool = (toolUseId: string) =>
    void act(() => invoke('agent.backgroundTool', view.sessionId, toolUseId))
  const stopTask = (task: AgentTask) => void act(() => invoke('agent.stopTask', view.sessionId, task.agentId))
  const working = session?.state === 'running' || session?.state === 'starting'
  const compacting = session?.state !== 'stopped' && session?.state !== 'failed' && isCompacting(events)
  const activityLabel = compacting ? 'Compacting context…' : agentActivityLabel(session?.state, events)
  const turns = useMemo(() => toTurns(blocks, events), [blocks, events])
  // A long chat draws its latest turns first; "Earlier turns" brings back the previous page, keeping the reader where they were.
  const hiddenTurns = Math.max(0, turns.length - shownTurns)
  const pageTurns = hiddenTurns ? turns.slice(hiddenTurns) : turns
  const pageAnchor = useRef<{ height: number; top: number } | null>(null)
  useEffect(() => {
    setShownTurns(TURN_PAGE)
  }, [view.sessionId])
  useLayoutEffect(() => {
    const anchor = pageAnchor.current,
      el = scroller.current
    if (!anchor || !el) return
    pageAnchor.current = null
    el.scrollTop = anchor.top + (el.scrollHeight - anchor.height)
    measureEdges()
  }, [shownTurns])
  const showEarlierTurns = () => {
    const el = scroller.current
    if (el) {
      pageAnchor.current = { height: el.scrollHeight, top: el.scrollTop }
      stick.current = false
    }
    setShownTurns((count) => count + TURN_PAGE)
  }
  const statusGroup =
    working && !turns.at(-1)?.ended ? turns.at(-1)?.items.findLast((block) => block.kind === 'tools') : undefined
  // A finished goal stays in the turn where it completed, after that turn's answer.
  const completedGoals = useMemo(() => {
    const byTurn = new Map<AgentEvent | null, ChatGoal[]>(),
      seen = new Set<string>()
    let user: AgentEvent | null = null
    for (const event of events) {
      if (event.kind === 'user' && !event.agentId) user = event
      else if (event.kind === 'goal' && event.goal?.status === 'completed' && !seen.has(event.goal.id)) {
        seen.add(event.goal.id)
        byTurn.set(user, [...(byTurn.get(user) ?? []), event.goal])
      }
    }
    return byTurn
  }, [events])
  const turnReviews = useMemo(
    () =>
      reviewsByTurn(
        reviews,
        view.sessionId,
        turns.map((turn) => ({
          key: turn.key,
          sequences: [...(turn.user ? [turn.user] : []), ...turn.items].flatMap((block) =>
            (block.kind === 'event' ? [block.event] : block.tools).flatMap((event) => {
              const seq = eventSequences.get(event)
              return seq === undefined ? [] : [seq]
            }),
          ),
        })),
      ),
    [reviews, turns, view.sessionId, eventSequences],
  )
  // Relative day labels stay current when a chat remains open across midnight.
  const [dateNow, setDateNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setDateNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])
  const turnDates = useMemo(() => {
    let previousAt: number | undefined
    return turns.map((turn) => {
      const at = turn.startedAt ?? turn.items.map(blockAt).find((value) => value !== undefined)
      const separator = needsChatDate(at, previousAt) ? at : undefined
      // Measure the pause from the last activity, including a long-running answer.
      previousAt = turn.endedAt ?? turn.items.map(blockAt).findLast((value) => value !== undefined) ?? at ?? previousAt
      return separator
    })
  }, [turns])
  const lastUserAt = turns.findLast((turn) => turn.user)?.startedAt
  const elapsed = useElapsed(lastUserAt, working)

  const act = async (fn: () => Promise<unknown>) => {
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(errorText(e))
    }
  }

  const busyAgent = working || session?.state === 'needs-input'
  // A stopped turn can be picked up again: Stop in this view, or a turn the provider reports as interrupted.
  const [interrupted, setInterrupted] = useState(false)
  const lastResult = events.findLast((e) => e.kind === 'result')
  const lastUserIndex = events.findLastIndex((e) => e.kind === 'user')
  const stopped =
    interrupted ||
    (!!lastResult &&
      events.lastIndexOf(lastResult) > lastUserIndex &&
      /interrupt|abort/i.test(lastResult.kind === 'result' ? lastResult.text : ''))
  useEffect(() => {
    if (working) setInterrupted(false)
  }, [working])
  const ws = useWorkspaceActions()
  const [continuing, setContinuing] = useState(false),
    [confirmContinue, setConfirmContinue] = useState(false)
  // A fresh chat in the same checkout that opens with this one's transcript as hidden context.
  const continueInNewChat = async () => {
    const previous = session && ws.task(session.taskId)
    if (!session || !previous) return
    setContinuing(true)
    let created: string | null = null
    try {
      const prompt = await invoke('agent.continuationPrompt', session.id)
      const task = await invoke('tasks.create', {
        projectId: previous.projectId,
        title: clipText(`Continue: ${previous.title}`, 60),
        mode: previous.mode,
        workspaceId: previous.workspaceId ?? undefined,
      })
      created = task.id
      const next = await invoke('agent.start', task.id, prompt, pendingSettings ?? session.settings, [], [])
      created = null
      await ws.refresh()
      ws.openTask(task.id)
      ws.openView(task.id, { kind: 'agent', sessionId: next.id })
    } catch (e) {
      if (created) {
        await invoke('tasks.delete', created, false).catch(() => {})
        await ws.refresh().catch(() => {})
      }
      setError(errorText(e))
    } finally {
      setContinuing(false)
      setConfirmContinue(false)
    }
  }
  const { offline: hostOffline, name: hostName } = useHostConnection()
  const pending = useOutbox(view.sessionId)
  const supportsSteering = !!session
  const action = supportsSteering ? preferences.busyMessageAction : 'queue'
  const opposite = action === 'queue' ? 'steer' : 'queue'
  // While the agent is working, a model change takes effect right away and the run continues with the new settings.
  // The model bar hands over one change when the slider is released. While the agent is working it is applied straight away.
  const [modelWarning, setModelWarning] = useState<AgentSettings | null>(null)
  const [dontWarn, setDontWarn] = useState(false)
  // Another model has no cached copy of this conversation, so the first message after a switch is billed in full.
  const changeSettings = (next: AgentSettings) => {
    const current = pendingSettings ?? session?.settings
    const switching =
      !!current &&
      (current.provider !== next.provider || current.model !== next.model) &&
      !(current.provider === next.provider && !current.model)
    if (switching && preferences.warnModelChange && events.some((event) => event.kind === 'user')) {
      setDontWarn(false)
      setModelWarning(next)
      return
    }
    applySettings(next)
  }
  const applySettings = (next: AgentSettings) => {
    setPendingSettings(next)
    if (!busyAgent) return
    void invoke('agent.configure', view.sessionId, next).then(
      (updated) => {
        setSession(updated)
        setPendingSettings((current) => (current === next ? null : current))
      },
      (error) => {
        setPendingSettings(null)
        notifyError(errorText(error), 'Model')
      },
    )
  }
  const attached = pendingComments(reviews, view.sessionId)
  // Editing keeps history and offers a provider-independent file restore before resending.
  /** Adds a Markdown quote to the message box and puts the cursor after it. */
  const quoteIntoDraft = (text: string) => {
    const quoted = text
      .trim()
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n')
    setDraft((current) => (current.trim() ? `${current.replace(/\s+$/, '')}\n\n${quoted}\n\n` : `${quoted}\n\n`))
    requestAnimationFrame(() => {
      focusComposer(root.current, Number.MAX_SAFE_INTEGER)
    })
  }
  /** Opens New chat in this chat's project with the quote already in the box. Nothing is sent. */
  const quoteIntoNewChat = (text: string) => {
    const project = ws.task(session?.taskId ?? '')?.projectId ?? NO_PROJECT
    saveDraft(
      draftKey.newChat(project),
      `${text
        .trim()
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n')}\n\n`,
    )
    ws.newTask(project)
  }
  const editMessage = (text: string, files: Attachment[], seq?: number) => {
    if (seq === undefined) return
    setEditing({ seq, text, files })
  }
  const cancelEdit = () => {
    setEditing(null)
    requestAnimationFrame(() => {
      focusComposer(root.current, draft.length)
    })
  }
  /** Sends the revised message as a new request; the agent is told it replaces the earlier one. */
  const submitEdit = (text: string, restored: boolean) =>
    act(async () => {
      if (!editing) return
      const outgoing = `${text}\n\n<ramu-context>\nThis revises my earlier message ${editing.seq}.${restored ? ' Selected file changes from that message and later captured runs were restored using Ramu. Inspect current files before acting.' : ' Files have not been restored.'} Treat this revised request as replacing the earlier request; the previous transcript remains as historical evidence.\n</ramu-context>`
      // Offline, the revision waits in the outbox like any other message; file restore needs the host, so it isn't offered.
      if (hostOffline) {
        if (!outbox().add(view.sessionId, outgoing, editing.files))
          throw new Error(
            translate('{0} messages are already waiting. Remove one or wait for {1} to reconnect.', {
              0: OUTBOX_LIMIT,
              1: hostName,
            }),
          )
        setEditing(null)
        stick.current = true
        requestAnimationFrame(() => {
          focusComposer(root.current, draft.length)
        })
        return
      }
      setConfiguring(true)
      try {
        if (pendingSettings) {
          setSession(await invoke('agent.configure', view.sessionId, pendingSettings))
          setPendingSettings(null)
        }
        await invoke(
          'agent.submit',
          view.sessionId,
          outgoing,
          action,
          editing.files.map((file) => file.id),
          [],
        )
        setEditing(null)
        stick.current = true
        requestAnimationFrame(() => {
          focusComposer(root.current, draft.length)
        })
      } finally {
        setConfiguring(false)
      }
    })
  /** The last plain message you sent, for ↑ in an empty message box. */
  const editLast = () => {
    for (const turn of [...turns].reverse()) {
      const event = turn.user?.kind === 'event' ? turn.user.event : null
      if (
        event?.kind !== 'user' ||
        event.agentId ||
        parseAnswerMessage(event.text) ||
        parseTaskStop(event.text) ||
        parseTaskMessage(event.text)
      )
        continue
      editMessage(event.text.split('\n\n<ramu-context>\n')[0] ?? '', event.attachments ?? [], eventSequences.get(event))
      return
    }
  }
  /** "/aside question" (or Claude Code's "/btw") asks about the whole chat beside it: the agent keeps working and never sees it. */
  const askAside = (question: string) =>
    act(async () => {
      const submitted = draft
      const aside = await invoke('aside.ask', view.sessionId, null, '', 'assistant', question)
      setDraft((current) => (current === submitted ? '' : current))
      setOpenAside({ id: aside.id, quote: aside.quote, from: aside.quoteFrom, keepFocus: true })
    })
  /** With nothing to quote, the aside is about the whole chat: type the question straight away. Existing asides stay listed. */
  const newAside: AsideTarget = { id: null, quote: '', from: 'assistant' }
  const toggleAside = () =>
    setOpenAside(
      openAside
        ? null
        : asides.length === 0
          ? newAside
          : asides.length === 1
            ? { id: asides[0]!.id, quote: '', from: 'assistant' }
            : '*',
    )
  const toggleAsideRef = useRef(toggleAside)
  toggleAsideRef.current = toggleAside
  useEffect(() => {
    const openPanel = (event: Event) => {
      if (!root.current?.checkVisibility()) return
      const panel = (event as CustomEvent<{ panel: string }>).detail.panel
      if (panel === 'aside') toggleAside()
      else if (panel === 'agents' && tasks.length) setOpenAgent('*')
    }
    window.addEventListener('ramu:chat-panel', openPanel)
    return () => window.removeEventListener('ramu:chat-panel', openPanel)
  }, [openAside, openAgent, asides, tasks])
  // ⌘⇧A with no text selected opens an aside on the whole chat (a selection is handled by SelectionActions).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.code !== 'KeyA' || event.defaultPrevented)
        return
      if (!root.current?.checkVisibility() || document.getSelection()?.toString().trim()) return
      event.preventDefault()
      toggleAsideRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const send = (mode: 'queue' | 'steer' = action, context: FileContext[] = []) => {
    const side = /^\/(?:aside|btw)\s+(\S[\s\S]*)$/.exec(draft.trim())
    return side && !attachments.length && !attached.length ? askAside(side[1]!.trim()) : sendToAgent(mode, context)
  }
  const sendToAgent = (mode: 'queue' | 'steer', context: FileContext[]) =>
    act(async () => {
      const submitted = draft
      const submittedFiles = attachments
      // Review comments live on the host, so a message carrying them waits for the connection rather than the outbox.
      if (hostOffline && attached.length)
        throw new Error(translate('Review comments send once {0} is back. Your message is kept.', { 0: hostName }))
      if (hostOffline) {
        if (!outbox().add(view.sessionId, submitted, submittedFiles, context))
          throw new Error(
            translate('{0} messages are already waiting. Remove one or wait for {1} to reconnect.', {
              0: OUTBOX_LIMIT,
              1: hostName,
            }),
          )
        setDraft((current) => (current === submitted ? '' : current))
        setAttachments((current) => current.filter((file) => !submittedFiles.some((sent) => sent.id === file.id)))
        stick.current = true
        return
      }
      const outgoing = submitted
      setConfiguring(true)
      try {
        if (pendingSettings) {
          setSession(await invoke('agent.configure', view.sessionId, pendingSettings))
          setPendingSettings(null)
        }
        if (attached.length) {
          // Review comments go out with this message, as one request to the agent.
          for (const [index, group] of attached.entries())
            await invoke(
              'reviews.sendComments',
              group.review.id,
              group.ids,
              index === 0 ? outgoing : '',
              index === 0 ? submittedFiles.map((file) => file.id) : [],
              index === 0 ? context : [],
            )
        } else
          await invoke(
            'agent.submit',
            view.sessionId,
            outgoing,
            mode,
            submittedFiles.map((file) => file.id),
            context,
          )
        setDraft((current) => (current === submitted ? '' : current))
        setAttachments((current) => current.filter((file) => !submittedFiles.some((sent) => sent.id === file.id)))
        stick.current = true
      } finally {
        setConfiguring(false)
      }
    })

  return (
    <div
      ref={root}
      className={`agent-view [&.dropping::after]:[content:'Drop_to_add_to_the_message'] [&.dropping::after]:absolute [&.dropping::after]:inset-1.5 [&.dropping::after]:z-20 [&.dropping::after]:grid [&.dropping::after]:place-items-center [&.dropping::after]:[border:1px_dashed_var(--line-strong)] [&.dropping::after]:rounded-(--radius-m) [&.dropping::after]:[background:color-mix(in_srgb,_var(--canvas)_78%,_transparent)] [&.dropping::after]:text-foreground [&.dropping::after]:text-control [&.dropping::after]:pointer-events-none flex flex-col flex-1 min-h-0 min-w-0 relative${dropping ? ' dropping' : ''}`}
      data-state={session?.state}
      data-chat-visible={visible || undefined}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes(FILE_DRAG_TYPE) || event.dataTransfer.types.includes('Files')) {
          event.preventDefault()
          setDropping(true)
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false)
      }}
      onDrop={(event) => {
        setDropping(false)
        // A drop on the message box is already handled by the box itself.
        if ((event.target as Element).closest?.('.composer')) return
        const dragged = event.dataTransfer.getData(FILE_DRAG_TYPE),
          files = [...event.dataTransfer.files]
        if (!dragged && !files.length) return
        event.preventDefault()
        window.dispatchEvent(
          new CustomEvent('ramu:chat-drop', { detail: { root: event.currentTarget, dragged, files } }),
        )
      }}
    >
      <div className="agent-header [&_.path]:flex-1 [&:not(:has(>_:not(.grow)))]:hidden [&_.grow]:hidden [&_.state]:mr-auto [&_.small]:gap-1.5 [&_.small]:text-soft [&_>_*]:flex-none [&_>_*]:whitespace-nowrap flex items-center flex-none text-control min-w-0 justify-end h-auto min-h-[36px] p-[4px_10px_0] gap-1.5 flex-wrap gap-y-1 pb-1">
        {history}
        <SessionChangesButton sessionId={view.sessionId} />
        <SessionCheckpointButton sessionId={view.sessionId} />
        {session && STATE_LABEL[session.state] && (
          <span
            className={`state [&.running]:text-brand [&.starting]:text-brand [&.needs-input]:text-warn [&.failed]:text-bad [&::before]:[content:''] [&::before]:w-1.5 [&::before]:h-1.5 [&::before]:rounded-full [&::before]:[background:var(--muted)] [&.idle::before]:[background:var(--ok)] [&.running::before]:[background:var(--accent)] [&.running::before]:[animation:pulse_1.6s_ease-in-out_infinite] [&.starting::before]:[background:var(--accent)] [&.starting::before]:[animation:pulse_1.6s_ease-in-out_infinite] [&.needs-input::before]:[background:var(--warn)] [&.failed::before]:[background:var(--bad)] [&:empty]:hidden tabular-nums text-muted-foreground whitespace-nowrap inline-flex items-center gap-1.5 p-[2px_9px_2px_8px] rounded-full bg-hover text-caption ${session.state}`}
          >
            {STATE_LABEL[session.state]}
          </span>
        )}
        <span className="grow flex-1 min-w-0 text-left" />
        {pendingQuestions.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover small text-caption"
            aria-pressed={showQuestions}
            onClick={() => setShowQuestions((open) => !open)}
          >
            <ShieldQuestion size={14} />
            {translate('Questions · ')}
            {pendingQuestions.length}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover small text-caption asides-chip gap-1.5 text-soft"
          aria-pressed={openAside !== null}
          title={`${translate('Side questions about this chat')} (${formatKeys('mod+shift+a')})`}
          onClick={toggleAside}
        >
          <MessageCircle size={13} />
          {asides.length > 0 ? `${translate('Aside')} · ${asides.length}` : translate('Aside')}
        </Button>
        {commands.length > 0 && (
          <Menu
            label={translate('Background commands')}
            icon={
              <>
                <LoaderCircle size={13} className="spin [animation:spin_0.9s_linear_infinite]" />
                {translate('{0} background {1}', {
                  '0': commands.length,
                  '1': commands.length === 1 ? 'command' : 'commands',
                })}
              </>
            }
            className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover small text-caption agents-chip [&.running]:text-foreground [&.running]:bg-hover gap-1.5 text-soft running"
            align="end"
            items={commands.map((task) => ({
              key: task.agentId,
              label: (
                <>
                  <Square size={12} /> {translate('Stop')} · {task.name}
                </>
              ),
              onSelect: () => stopTask(task),
            }))}
          />
        )}
        {tasks.length > 0 && (
          <Button
            variant="secondary"
            className={`ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover small text-caption agents-chip [&.running]:text-foreground [&.running]:bg-hover gap-1.5 text-soft${runningTasks.length ? ' running' : ''}`}
            aria-pressed={openAgent !== null}
            title={
              runningTasks.length
                ? translate('Sub-agents still working; they can keep going after the turn ends')
                : translate('Sub-agents in this chat')
            }
            onClick={() =>
              setOpenAgent((current) => (current ? null : runningTasks.length === 1 ? runningTasks[0]!.agentId : '*'))
            }
          >
            {runningTasks.length ? (
              <LoaderCircle size={13} className="spin [animation:spin_0.9s_linear_infinite]" />
            ) : (
              <Bot size={14} />
            )}
            {runningTasks.length
              ? translate('{0} {1} running', {
                  '0': runningTasks.length,
                  '1': runningTasks.length === 1 ? 'agent' : 'agents',
                })
              : translate('Agents · {0}', { '0': tasks.length })}
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-xs"
          className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)"
          aria-label={translate('Find in conversation')}
          title={translate('Find in conversation ({0})', { '0': formatKeys('mod+f') })}
          onClick={() => openFind()}
        >
          <Search size={14} />
        </Button>
        {session && events.length > 0 && (
          <Menu
            label={translate('More actions')}
            icon={
              continuing ? (
                <LoaderCircle size={14} className="spin [animation:spin_0.9s_linear_infinite]" />
              ) : (
                <MoreHorizontal size={14} />
              )
            }
            className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)"
            align="end"
            items={[
              {
                key: 'continue',
                label: (
                  <>
                    <GitFork size={13} /> {translate('Continue in new chat')}
                  </>
                ),
                onSelect: () => setConfirmContinue(true),
              },
            ]}
          />
        )}
      </div>
      <div className="agent-split [&_>_.agent-panel]:relative [&_>_.agent-panel]:inset-auto [&_>_.agent-panel]:flex-none [&_>_.agent-panel]:w-[min(440px,_45%)] [&_>_.agent-panel]:h-auto [&_>_.agent-panel]:[box-shadow:none] [&_>_.agent-panel]:[animation:none] [&_>_.agent-panel]:[border-left:var(--pane-border-width)_solid_var(--pane-border-color)] relative flex flex-1 min-h-0 min-w-0 [container:agent-split_/_inline-size]">
        <div className="agent-main relative flex flex-col [flex:1_1_0] min-w-0 min-h-0">
          {finding && (
            <ChatFind root={scroller} focusRequest={findRequest} initialQuery={findQuery} onClose={closeFind} />
          )}
          {modelWarning && (
            <Dialog
              title={translate('Change model mid-conversation?')}
              confirmLabel={translate('Change model')}
              onCancel={() => setModelWarning(null)}
              onConfirm={() => {
                const next = modelWarning
                setModelWarning(null)
                if (dontWarn)
                  void save({ ...preferences, warnModelChange: false }).catch((error) =>
                    notifyError(errorText(error), 'Settings'),
                  )
                applySettings(next)
              }}
            >
              <p>
                {translate(
                  "The new model can't reuse the cache built for this conversation, so the first message after the change uses more of your usage than usual.",
                )}
              </p>
              <label className="mt-2 flex items-center gap-2 text-control">
                <input type="checkbox" checked={dontWarn} onChange={(event) => setDontWarn(event.target.checked)} />
                {translate("Don't show this again")}
              </label>
            </Dialog>
          )}
          {confirmContinue && (
            <Dialog
              title={translate('Continue in a new chat?')}
              confirmLabel={translate('Continue in new chat')}
              busy={continuing}
              onCancel={() => {
                if (!continuing) setConfirmContinue(false)
              }}
              onConfirm={() => void continueInNewChat()}
            >
              <p>{translate('Start a new chat in this checkout using the current conversation as context.')}</p>
            </Dialog>
          )}
          {showQuestions && pendingQuestions.length > 0 && (
            <div
              className="pending-questions [&_button]:whitespace-normal [&_button]:text-left flex flex-wrap gap-1 p-[6px_12px] [border-bottom:1px_solid_var(--line)] max-h-[130px] overflow-auto"
              aria-label={translate('Pending questions')}
            >
              {pendingQuestions.map((question) => (
                <Button
                  variant="ghost"
                  size="sm"
                  key={question.requestId}
                  className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover small text-caption"
                  onClick={() => {
                    if (question.kind === 'question') return openQuestion(question.requestId)
                    const card = [
                      ...(scroller.current?.querySelectorAll<HTMLElement>('[data-question-request]') ?? []),
                    ].find((node) => node.dataset.questionRequest === question.requestId)
                    card?.scrollIntoView({ block: 'center', behavior: 'smooth' })
                    card?.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus({ preventScroll: true })
                  }}
                >
                  {question.kind === 'elicitation' ||
                  questionStates.get(question.requestId)?.waiting ||
                  question.responseMode !== 'message'
                    ? 'Waiting: '
                    : 'Pending: '}
                  {question.kind === 'elicitation'
                    ? `${question.serverName}: ${question.message}`
                    : question.dependsOn || question.questions[0]?.question}
                </Button>
              ))}
            </div>
          )}
          <div
            className={`transcript-frame [&_>_.transcript]:min-h-0 [&_>_.transcript]:[flex:1_1_0] [&_>_.transcript]:min-w-0 [&::before]:[content:''] [&::before]:absolute [&::before]:left-0 [&::before]:right-0 [&::before]:h-[36px] [&::before]:pointer-events-none [&::before]:z-1 [&::before]:opacity-0 [&::before]:[transition:opacity_150ms_var(--motion-curve)] [&::before]:top-0 [&::before]:[background:linear-gradient(to_bottom,_var(--canvas)_15%,_transparent)] [&::after]:[content:''] [&::after]:absolute [&::after]:left-0 [&::after]:right-0 [&::after]:h-[36px] [&::after]:pointer-events-none [&::after]:z-1 [&::after]:opacity-0 [&::after]:[transition:opacity_150ms_var(--motion-curve)] [&::after]:bottom-0 [&::after]:[background:linear-gradient(to_top,_var(--canvas)_15%,_transparent)] [&.shadow-top::before]:opacity-100 [&.shadow-bottom::after]:opacity-100 [&_>_.agent-panel]:relative [&_>_.agent-panel]:inset-auto [&_>_.agent-panel]:flex-none [&_>_.agent-panel]:w-[min(440px,_45%)] [&_>_.agent-panel]:h-auto [&_>_.agent-panel]:[box-shadow:none] [&_>_.agent-panel]:[animation:none] [&_>_.agent-panel]:[border-left:var(--pane-border-width)_solid_var(--pane-border-color)] relative flex-1 min-h-0 min-w-0 flex [container:transcript-frame_/_inline-size] flex-col${edges.top ? ' shadow-top' : ''}${edges.bottom ? ' shadow-bottom' : ''}`}
          >
            <OverlayScrollArea
              className={`transcript flex-1 ${hydrating && !turns.length ? 'chat-loading' : ''}`}
              contentClassName={hydrating && !turns.length ? 'h-full' : undefined}
              viewportClassName="p-[12px_24px_28px] pt-3"
              viewportRef={scroller}
              viewportProps={{
                onScroll: (e) => {
                  const el = e.currentTarget
                  stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX
                  measureEdges()
                },
              }}
            >
              <div
                className={`${hydrating && !turns.length ? 'h-full justify-center' : ''} transcript-col [&_>_[data-block-index]:has(>_.msg.user)]:flex [&_>_[data-block-index]:has(>_.msg.user)]:justify-end max-w-[var(--chat-column-width)] m-[0_auto] flex flex-col gap-3.5`}
              >
                {hydrating && !turns.length && (
                  <div className="flex items-center justify-center">
                    <Spinner className="size-5 text-muted-foreground" aria-label={translate('Loading conversation')} />
                  </div>
                )}
                {hiddenTurns > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mx-auto mb-2 text-muted-foreground"
                    onClick={showEarlierTurns}
                  >
                    {translate('Earlier turns ({0} more)', { '0': hiddenTurns })}
                  </Button>
                )}
                {pageTurns.map((turn, ti) => {
                  const isLast = ti === pageTurns.length - 1
                  // A turn is done when the agent reported a result, a later message exists, or nothing is running any more.
                  const finished = turn.ended || !isLast || (!working && session?.state !== 'needs-input')
                  const { folded, kept, answer } = finished
                    ? foldTurn(turn.items, outcomes, results)
                    : { folded: [] as Block[], kept: turn.items, answer: [] as Block[] }
                  const render = (b: Block, actions = false, latest = false) => {
                    const index = blockIndex(b, blocks)
                    return (
                      <div key={index} data-block-index={index}>
                        {b.kind === 'tools' ? (
                          <ToolGroup
                            tools={b.tools}
                            results={results}
                            cwd={session?.cwd ?? ''}
                            active={busyAgent && !finished}
                            activity={b === statusGroup ? translate(activityLabel ?? 'Working') : undefined}
                            taskId={session?.taskId}
                            onBackground={session?.provider === 'claude-code' && live ? backgroundTool : undefined}
                          />
                        ) : b.event.kind === 'goal' ? (
                          goalNotes.has(b.event) ? (
                            <GoalNote change={goalNotes.get(b.event)!} />
                          ) : null
                        ) : b.event.kind === 'agent' ? (
                          b.event.taskType === 'advisor' ? (
                            <AdvisorActivity
                              task={b.event}
                              live={live}
                              onOpen={() => setOpenAgent(b.event.kind === 'agent' ? b.event.agentId : null)}
                            />
                          ) : (
                            <AgentTaskCard
                              task={b.event}
                              live={live}
                              onOpen={() => setOpenAgent(b.event.kind === 'agent' ? b.event.agentId : null)}
                              onStop={stopTask}
                            />
                          )
                        ) : (
                          <EventRow
                            event={relativize(b.event, session?.cwd ?? '')}
                            taskId={session?.taskId}
                            sessionId={view.sessionId}
                            live={live}
                            generating={
                              working &&
                              (b.event === liveText || (b.event.kind === 'thinking' && b === turn.items.at(-1)))
                            }
                            outcomes={outcomes}
                            questionStates={questionStates}
                            actions={actions}
                            latest={latest}
                            editor={
                              editing && eventSequences.get(b.event) === editing.seq ? (
                                <InlineMessageEdit
                                  key={editing.seq}
                                  original={editing.text}
                                  files={editing.files}
                                  sessionId={view.sessionId}
                                  seq={editing.seq}
                                  busy={configuring}
                                  offlineHost={hostOffline ? hostName : undefined}
                                  onCancel={cancelEdit}
                                  onSubmit={submitEdit}
                                />
                              ) : undefined
                            }
                            onEdit={
                              eventSequences.has(b.event)
                                ? (text, files) => editMessage(text, files, eventSequences.get(b.event))
                                : undefined
                            }
                            onOpenAgent={setOpenAgent}
                            onOpenQuestion={openQuestion}
                          />
                        )}
                      </div>
                    )
                  }
                  // Several sub-agents in a row read as one line with a summary, expanding to their cards.
                  const renderList = (list: Block[]) =>
                    groupAgentRuns(list).map((item) =>
                      Array.isArray(item) ? (
                        <div key={blockIndex(item[0]!, blocks)} data-block-index={blockIndex(item[0]!, blocks)}>
                          <AgentGroup tasks={item.map(agentOf)} live={live} onOpen={setOpenAgent} onStop={stopTask} />
                        </div>
                      ) : (
                        render(item)
                      ),
                    )
                  const startedAt = turn.startedAt ?? (folded[0] ? blockAt(folded[0]) : undefined)
                  const endedAt =
                    turn.endedAt ??
                    (finished || session?.state === 'needs-input'
                      ? turn.items.map(blockAt).findLast((at) => at !== undefined)
                      : undefined)
                  const duration =
                    startedAt !== undefined && endedAt !== undefined ? Math.max(0, endedAt - startedAt) : undefined
                  return (
                    <div
                      key={turn.key}
                      className="turn [&_>_[data-block-index]:has(.msg.user)]:flex [&_>_[data-block-index]:has(.msg.user)]:justify-end flex flex-col gap-3.5 min-w-0"
                    >
                      {turnDates[ti] !== undefined && (
                        <time
                          className="chat-date [.turn:first-child_&]:mt-1 block self-center w-full m-[18px_0_24px] text-center text-muted-foreground text-control font-normal leading-[1.5]"
                          dateTime={new Date(turnDates[ti]!).toISOString()}
                          title={new Date(turnDates[ti]!).toLocaleString(formatLocale())}
                        >
                          {formatChatDate(turnDates[ti]!, dateNow, currentLanguage())}
                        </time>
                      )}
                      {turn.user &&
                        render(turn.user, false, isLast && !answer.length && !kept.length && !folded.length)}
                      {((!finished && isLast && (working || session?.state === 'needs-input')) ||
                        (finished && (!turn.ended || turn.interrupted) && !folded.length)) && (
                        <div className="turn-working text-muted-foreground tabular-nums" role="status">
                          <span>
                            {(elapsed ?? duration) !== null && (elapsed ?? duration) !== undefined
                              ? translate('Working for {0}', { '0': formatDuration((elapsed ?? duration)!) })
                              : translate('Working')}
                          </span>
                        </div>
                      )}
                      {folded.length > 0 && (
                        <TurnSummary
                          label={
                            duration !== undefined
                              ? translate(
                                  turn.ended && !turn.interrupted && !(isLast && stopped)
                                    ? 'Worked for {0}'
                                    : 'Working for {0}',
                                  { '0': formatDuration(duration) },
                                )
                              : translate(
                                  turn.ended && !turn.interrupted && !(isLast && stopped) ? 'Worked' : 'Working',
                                )
                          }
                          sourceIndex={view.sourceSeq ? blockIndex(folded[0]!, blocks) : undefined}
                        >
                          {renderList(folded)}
                        </TurnSummary>
                      )}
                      {renderList(kept)}
                      {answer.map((b) => render(b, finished && b === latestAssistant, b === latestAssistant))}
                      {turnReviews.get(turn.key)?.map((review) => (
                        <TurnChanges key={review.id} review={review} />
                      ))}
                      {completedGoals.get(turn.user?.kind === 'event' ? turn.user.event : null)?.map((done) => (
                        <GoalDone key={done.id} goal={done} />
                      ))}
                    </div>
                  )
                })}
                {activityLabel && !statusGroup && (
                  <div
                    className="working [&_.shimmer]:text-chat [&_.shimmer]:leading-[inherit] text-chat leading-[inherit] p-[4px_0] min-h-6 flex items-center"
                    role="status"
                  >
                    <WorkingText>{translate(activityLabel)}</WorkingText>
                  </div>
                )}
              </div>
            </OverlayScrollArea>
            {edges.bottom && (
              <Button
                variant="outline"
                size="icon-sm"
                type="button"
                className={`jump-bottom absolute left-1/2 z-4 [transform:translateX(-50%)] grid place-items-center p-0 rounded-full backdrop-blur-sm bottom-2.5 shadow-sm motion-safe:[animation:fade-only_0.14s_ease-out] ${working ? 'working' : ''}`}
                aria-label={working ? translate('Agent is working. Scroll to latest') : translate('Scroll to latest')}
                title={translate('Scroll to latest')}
                onClick={scrollToLatest}
              >
                {working ? <LoadingDots /> : <ArrowDown size={14} />}
              </Button>
            )}
            <SelectionActions
              scroller={scroller}
              onQuote={quoteIntoDraft}
              onQuoteNew={quoteIntoNewChat}
              onAside={(quote, from) => setOpenAside({ id: null, quote, from })}
            />
          </div>
          <div className="composer-dock [&_>_*]:w-full [&_>_*]:max-w-[var(--chat-column-width)] [&_>_*]:ml-auto [&_>_*]:mr-auto [&_.error]:mb-1.5 [&_.error]:text-control [&_.composer]:relative [&_.composer]:z-1 flex-none p-[0_calc(24px_+_var(--chat-scrollbar-width,_0px))_14px_24px]">
            {error && <div className="error text-bad">{error}</div>}
            {(hostOffline ||
              providerWait ||
              liveGoal ||
              queued.length > 0 ||
              pending.length > 0 ||
              dockQuestions.length > 0) && (
              <ComposerTray className="chat-tray [&_.question-dock_+_*]:mt-0.5 [&_.question-dock_+_*]:pt-0.5 [&_.question-dock_+_*]:[border-top:1px_solid_var(--line)] [&_.provider-wait_+_*]:mt-0.5 [&_.provider-wait_+_*]:pt-0.5 [&_.provider-wait_+_*]:[border-top:1px_solid_var(--line)] [&_.message-queue]:gap-0 [&_.message-queue]:p-0 [&_.message-queue]:m-0 [&_.message-queue]:[border:0] [&_.message-queue]:[border-radius:0] [&_.message-queue]:bg-transparent [&_.message-queue]:max-h-[136px] [&_.goal-bar_+_.message-queue]:mt-0.5 [&_.goal-bar_+_.message-queue]:pt-0.5 [&_.goal-bar_+_.message-queue]:[border-top:1px_solid_var(--line)] flex-col max-w-[calc(var(--chat-column-width)_-_24px)]!">
                {dockQuestions.length > 0 && (
                  <QuestionDock
                    sessionId={view.sessionId}
                    requests={dockQuestions}
                    states={questionStates}
                    open={questionDockOpen}
                    onOpenChange={setQuestionDockOpen}
                    focus={questionFocus}
                  />
                )}
                {hostOffline && <HostWaitNote name={hostName} />}
                {providerWait && <ProviderWaitNote retryAt={providerWait.retryAt} />}
                {liveGoal && (
                  <GoalBar
                    goal={liveGoal}
                    onControl={(action) => {
                      void act(() => invoke('agent.goal.control', view.sessionId, action))
                    }}
                  />
                )}
                {(queued.length > 0 || pending.length > 0) && (
                  <div
                    className="message-queue flex flex-col gap-1.5 p-[8px_12px] mb-2 max-h-[180px] overflow-auto [border:1px_solid_transparent] rounded-(--radius-s) bg-raised"
                    aria-label={translate('Queued messages')}
                  >
                    {queuePaused && (
                      <div className="message-queue-heading flex items-center justify-between gap-2">
                        <span className="muted text-muted-foreground small text-caption">{translate('Paused')}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover small text-caption"
                          onClick={() => void act(() => invoke('agent.resumeQueue', view.sessionId))}
                        >
                          {translate('Resume messages')}
                        </Button>
                      </div>
                    )}
                    {queued.map((message) => {
                      const relay = parseTaskMessage(message.text)
                      const text = relay
                        ? `To ${relay.name}: ${relay.body}`
                        : message.text.split('\n\n<ramu-context>\n')[0] || 'Attachments'
                      const recall = () =>
                        void act(async () => {
                          await invoke('agent.removeQueued', view.sessionId, message.id)
                          setAttachments((current) => [
                            ...current,
                            ...(message.attachments ?? []).filter(
                              (file) => !current.some((entry) => entry.id === file.id),
                            ),
                          ])
                          setDraft((current) => (current ? `${current}\n${message.text}` : message.text))
                        })
                      // Steering keeps the row until the active tools finish; an idle chat sends it straight away, even with the queue paused.
                      const sendNow = () => void act(() => invoke('agent.sendQueuedNow', view.sessionId, message.id))
                      // Steering stays visible but disabled while it waits; the hover tip says why.
                      const steering = message.mode === 'steer'
                      const sendTip = steering
                        ? translate('Steering pending until active tools finish')
                        : !busyAgent
                          ? translate('Send now')
                          : supportsSteering
                            ? translate('Send after active tools finish')
                            : translate("This provider can't steer a running turn")
                      return (
                        <div
                          className="queued-message [&_>_span]:flex-1 [&_>_span]:min-w-0 [&_>_span]:whitespace-pre-wrap [&_>_span]:[overflow-wrap:anywhere] [&_button]:flex-none [&_.queued-text]:flex-1 [&_.queued-text]:min-w-0 [&_.queued-text]:whitespace-nowrap [&_.queued-text]:overflow-hidden [&_.queued-text]:text-ellipsis [&_.queued-text]:text-foreground flex items-center text-control gap-2 min-h-8"
                          key={message.id}
                        >
                          <ListEnd
                            size={15}
                            className="queued-icon flex-none text-muted-foreground"
                            aria-hidden="true"
                          />
                          <span className="queued-text" title={text}>
                            {text}
                            {message.attachments?.length ? (
                              <Attachments files={message.attachments} size="small" />
                            ) : null}
                          </span>
                          <div className="inline-flex flex-none" title={sendTip}>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact) queued-steer gap-[5px] text-soft disabled:pointer-events-none"
                              aria-label={busyAgent ? translate('Steer') : translate('Send now')}
                              disabled={configuring || steering || (busyAgent && !supportsSteering)}
                              onClick={sendNow}
                            >
                              {busyAgent ? <CornerDownRight size={14} /> : <Send size={14} />}
                            </Button>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)"
                            disabled={configuring}
                            aria-label={translate('Remove queued message')}
                            title={translate('Remove')}
                            onClick={() => void act(() => invoke('agent.removeQueued', view.sessionId, message.id))}
                          >
                            <Trash2 size={14} />
                          </Button>
                          <Menu
                            label={translate('Queued message actions')}
                            icon={<MoreHorizontal size={14} />}
                            className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)"
                            align="end"
                            items={[
                              {
                                key: 'edit',
                                label: (
                                  <>
                                    <Pencil size={14} /> {translate(' Edit message')}
                                  </>
                                ),
                                onSelect: recall,
                              },
                            ]}
                          />
                        </div>
                      )
                    })}
                    {/* Outbox messages wait on this device, after everything the host already queued. Same row, but the host can't send them early. */}
                    {pending.map((item) => {
                      const text = item.text.split('\n\n<ramu-context>\n')[0] || translate('Attachments')
                      const recall = () => {
                        const taken = outbox().remove(item.id)
                        if (!taken) return
                        setAttachments((current) => [
                          ...current,
                          ...taken.attachments.filter((file) => !current.some((entry) => entry.id === file.id)),
                        ])
                        setDraft((current) => (current ? `${current}\n${text}` : text))
                      }
                      const sending = item.state === 'sending',
                        failed = item.state === 'failed'
                      const status = sending
                        ? translate('Sending…')
                        : failed
                          ? translate('Not sent: {0}', { 0: item.error ?? '' })
                          : translate('Sends when {0} is back', { 0: hostName })
                      return (
                        <div
                          className="queued-message [&_>_span]:flex-1 [&_>_span]:min-w-0 [&_>_span]:whitespace-pre-wrap [&_>_span]:[overflow-wrap:anywhere] [&_button]:flex-none [&_.queued-text]:flex-1 [&_.queued-text]:min-w-0 [&_.queued-text]:whitespace-nowrap [&_.queued-text]:overflow-hidden [&_.queued-text]:text-ellipsis [&_.queued-text]:text-foreground flex items-center text-control gap-2 min-h-8"
                          key={item.id}
                        >
                          {sending ? (
                            <LoaderCircle
                              size={15}
                              className="queued-icon flex-none text-muted-foreground spin [animation:spin_0.9s_linear_infinite]"
                              aria-hidden="true"
                            />
                          ) : failed ? (
                            <CircleAlert size={15} className="queued-icon flex-none text-bad" aria-hidden="true" />
                          ) : (
                            <ListEnd
                              size={15}
                              className="queued-icon flex-none text-muted-foreground"
                              aria-hidden="true"
                            />
                          )}
                          <span className="queued-text" title={`${text}\n\n${status}`}>
                            {text}
                            {item.attachments.length ? <Attachments files={item.attachments} size="small" /> : null}
                            <span className="sr-only">{status}</span>
                          </span>
                          {failed && (
                            <div className="inline-flex flex-none" title={hostOffline ? status : translate('Retry')}>
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact) queued-steer gap-[5px] text-soft disabled:pointer-events-none"
                                aria-label={translate('Retry')}
                                disabled={hostOffline}
                                onClick={() => outbox().retry(item.id)}
                              >
                                <RotateCcw size={14} />
                              </Button>
                            </div>
                          )}
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)"
                            disabled={sending}
                            aria-label={translate('Remove queued message')}
                            title={translate('Remove')}
                            onClick={() => outbox().remove(item.id)}
                          >
                            <Trash2 size={14} />
                          </Button>
                          <Menu
                            label={translate('Queued message actions')}
                            icon={<MoreHorizontal size={14} />}
                            className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)"
                            align="end"
                            items={[
                              {
                                key: 'edit',
                                label: (
                                  <>
                                    <Pencil size={14} /> {translate(' Edit message')}
                                  </>
                                ),
                                disabled: sending,
                                onSelect: recall,
                              },
                            ]}
                          />
                        </div>
                      )
                    })}
                  </div>
                )}
              </ComposerTray>
            )}
            <Composer
              persistentDraft
              attachments={attachments}
              onAttachmentsChange={setAttachments}
              stop={{
                active: live && busyAgent,
                onStop: () => {
                  setInterrupted(true)
                  void act(() => invoke('agent.interrupt', view.sessionId))
                },
              }}
              resume={{
                active: !busyAgent && !!session && stopped,
                onResume: () => {
                  setInterrupted(false)
                  stick.current = true
                  void act(() => invoke('agent.submit', view.sessionId, RESUME_PROMPT, 'steer', [], []))
                },
              }}
              value={draft}
              allowEmpty={attached.length > 0}
              chips={
                <>
                  {session && (
                    <ProviderRouteChip sessionId={view.sessionId} settings={pendingSettings ?? session.settings} />
                  )}
                  {attached.length > 0 && (
                    <CommentsChip
                      groups={attached}
                      onRemove={() =>
                        void act(async () => {
                          for (const group of attached)
                            await invoke('reviews.select', group.review.id, group.ids, false)
                        })
                      }
                    />
                  )}
                </>
              }
              disabled={configuring || !session}
              controls={
                session && (
                  <>
                    <AgentControls
                      settings={pendingSettings ?? session.settings}
                      current={session.settings}
                      onChange={changeSettings}
                      disabled={false}
                      running={working}
                      trailing={
                        <>
                          <ContextMeter sessionId={view.sessionId} />
                          <CompressionMeter sessionId={view.sessionId} />
                        </>
                      }
                    />
                  </>
                )
              }
              onChange={setDraft}
              onArrowUpEmpty={editing ? undefined : editLast}
              chat
              onSubmit={(context) => send(action, context)}
              onAlternateSubmit={
                busyAgent && supportsSteering && !hostOffline ? (context) => send(opposite, context) : undefined
              }
              alternateDisabled={configuring || !session}
              alternateLabel={opposite === 'queue' ? 'Queue' : 'Steer'}
              placeholder={
                hostOffline
                  ? translate('Message · sends when {0} is back', { 0: hostName })
                  : live || busyAgent
                    ? translate('Reply to the agent')
                    : translate('Message the agent')
              }
              submitLabel={hostOffline ? 'Queue' : busyAgent ? (action === 'queue' ? 'Queue' : 'Steer') : 'Send'}
            />
          </div>
        </div>
        <div
          ref={dock}
          className={`agent-dock [&.open]:w-[min(440px,_45cqw)] [&_>_.agent-panel]:relative [&_>_.agent-panel]:inset-auto [&_>_.agent-panel]:w-[min(440px,_45cqw)] [&_>_.agent-panel]:h-full [&_>_.agent-panel]:[box-shadow:none] [&_>_.agent-panel]:[animation:none] [&_>_.agent-panel]:[border-left:var(--pane-border-width)_solid_var(--pane-border-color)] flex-none w-0 min-h-0 overflow-hidden ${panelOpen ? ' open' : ''}`}
          inert={!panelOpen}
          aria-hidden={!panelOpen}
        >
          {openAside && (
            <AsidePanel
              sessionId={view.sessionId}
              asides={asides}
              open={openAside}
              taskId={session?.taskId}
              onOpen={setOpenAside}
              onClose={() => setOpenAside(null)}
              onQuote={quoteIntoDraft}
            />
          )}
          {openAgent && (
            <AgentTaskPanel
              tasks={tasks}
              openId={openAgent}
              events={events}
              results={results}
              cwd={session?.cwd ?? ''}
              live={live}
              taskId={session?.taskId}
              onSelect={setOpenAgent}
              onClose={() => setOpenAgent(null)}
              onStop={stopTask}
              onMessage={(task, text) => act(() => invoke('agent.messageTask', view.sessionId, task.agentId, text))}
            />
          )}
        </div>
      </div>
    </div>
  )
})

/** Shows paths inside the agent's directory relative to it; the header carries the full path. */
function relativize(e: AgentEvent, cwd: string): AgentEvent {
  if (!cwd) return e
  const strip = (s: string) => s.split(`${cwd}/`).join('')
  if (e.kind === 'permission-request') return { ...e, detail: strip(e.detail) }
  return e
}

/** "Worked for 35s": the run's steps fold into one line once it is done; the answer stays visible. */
/** Sent when you resume a stopped turn. The visible part is empty, so it never shows as a chat message. */
/** Turns drawn at a time; a chat can have hundreds. */
const TURN_PAGE = 20
const RESUME_PROMPT = '\n\n<ramu-context>\nContinue where you left off.\n</ramu-context>'

function TurnSummary({ label, children }: { label: string; children: React.ReactNode; sourceIndex?: number }) {
  useLanguage()
  const [open, setOpen] = useState(false)
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={open ? 'turn-summary flex flex-col open' : 'turn-summary flex flex-col'}
    >
      <CollapsibleTrigger
        render={<Button variant="ghost" className="turn-summary-toggle w-full justify-start text-muted-foreground" />}
      >
        <span>{label}</span>
        {open ? (
          <ChevronDown
            size={14}
            className="caret [&.open]:[transform:rotate(90deg)] [:is(.tool-group,_.tool)_>_[data-slot='collapsible-trigger']:is(:hover,_:focus-visible)_&]:opacity-100 [:is(.tool-group,_.tool)[data-open]_>_[data-slot='collapsible-trigger']_>_&]:[transform:rotate(90deg)] text-muted-foreground flex-none [transition:transform_0.15s_var(--ease)]"
          />
        ) : (
          <ChevronRight
            size={14}
            className="caret [&.open]:[transform:rotate(90deg)] [:is(.tool-group,_.tool)_>_[data-slot='collapsible-trigger']:is(:hover,_:focus-visible)_&]:opacity-100 [:is(.tool-group,_.tool)[data-open]_>_[data-slot='collapsible-trigger']_>_&]:[transform:rotate(90deg)] text-muted-foreground flex-none [transition:transform_0.15s_var(--ease)]"
          />
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="turn-summary-panel [&[data-starting-style]]:h-0 [&[data-ending-style]]:h-0 h-[var(--collapsible-panel-height)] overflow-hidden [transition:none]">
        <div className="turn-summary-body flex flex-col gap-3 pt-3">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}

/** A settings change in the transcript: "model effort → model effort", then any other part that changed as "old → new". */
/** What the button does, not just "Undo": "Switch back to Opus Medium". */
function SwitchBackLabel({ previous }: { previous: AgentSettings }) {
  const { catalogs } = useModelSets()
  const { model, effort } = settingsNames(previous, catalogs)
  return <>{translate('Switch back to {0}', { '0': effort ? `${model} ${effort}` : model })}</>
}

function SettingsChange({ next, previous }: { next: AgentSettings; previous?: AgentSettings }) {
  const { catalogs } = useModelSets()
  const label = (s: AgentSettings) => {
    const { model, effort } = settingsNames(s, catalogs)
    return effort ? `${model} ${effort}` : model
  }
  const tier = (s: AgentSettings) => (s.provider === 'codex' ? (s.serviceTier === 'fast' ? 'Fast' : 'Standard') : null)
  const style = (s: AgentSettings) =>
    translate(
      s.responseStyle && s.responseStyle !== 'inherit' ? RESPONSE_STYLE_LABELS[s.responseStyle] : 'Use global style',
    )
  if (!previous)
    return <>{[label(next), accessName(next.access), tier(next), style(next)].filter(Boolean).join(' · ')}</>
  const changed = [
    [label(previous), label(next)],
    [accessName(previous.access), accessName(next.access)],
    [tier(previous), tier(next)],
    [style(previous), style(next)],
  ]
    .filter(([before, now]) => before && now && before !== now)
    .map(([before, now]) => `${before} → ${now}`)
  return <>{changed.length ? changed.join(' · ') : label(next)}</>
}

const TOOL_VERB: Record<string, string> = {
  Bash: 'Ran',
  Edit: 'Edited',
  MultiEdit: 'Edited',
  Write: 'Wrote',
  NotebookEdit: 'Edited',
  Read: 'Read',
  Grep: 'Searched',
  Glob: 'Listed',
  WebFetch: 'Fetched',
  WebSearch: 'Searched',
}

/**
 * Fades the edges of a scroll area that still has content beyond them, instead of cutting it off.
 * It writes data attributes straight to the element, so scrolling never re-renders React; the CSS
 * mask (`.fade-scroll`) animates the fade in and out.
 */
function useScrollFade<T extends HTMLElement>() {
  useLanguage()
  const ref = useRef<T>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    let frame = 0
    const update = () => {
      frame = 0
      if (el.getAnimations().length) {
        schedule()
        return
      }
      el.toggleAttribute('data-fade-top', el.scrollTop > 2)
      el.toggleAttribute('data-fade-bottom', el.scrollTop + el.clientHeight < el.scrollHeight - 2)
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    el.addEventListener('scroll', schedule, { passive: true })
    const observer = new ResizeObserver(schedule)
    observer.observe(el)
    for (const child of el.children) observer.observe(child)
    return () => {
      el.removeEventListener('scroll', schedule)
      observer.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
  })
  return ref
}

function ShadowPre({ children }: { children: React.ReactNode }) {
  useLanguage()
  const ref = useScrollFade<HTMLPreElement>()
  return (
    <pre
      ref={ref}
      className="tool-output p-[8px_10px] rounded-(--radius-s) text-soft max-h-[260px] overflow-auto m-[2px_0_6px_26px] [background:rgba(255,_255,_255,_0.03)] [border:1px_solid_transparent] fade-scroll [--fade-top:0px] [--fade-bottom:0px] [mask-image:linear-gradient(to_bottom,_transparent_0,_#000_var(--fade-top),_#000_calc(100%_-_var(--fade-bottom)),_transparent_100%)] [transition:--fade-top_0.14s_ease-out,_--fade-bottom_0.14s_ease-out] overflow-y-auto"
    >
      {children}
    </pre>
  )
}

/** Keep the moving text highlight without a background shorthand resetting text clipping. */
function WorkingText({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="shimmer bg-clip-text text-transparent motion-reduce:animate-none!"
      style={{
        backgroundImage: 'linear-gradient(90deg, var(--muted) 30%, var(--text) 50%, var(--muted) 70%)',
        backgroundSize: '200% 100%',
        animation: 'shimmer 1.8s linear infinite',
      }}
    >
      {children}
    </span>
  )
}

const RAMU_ICONS: Record<RamuToolIcon, typeof Wrench> = {
  brain: Brain,
  book: BookOpen,
  search: Search,
  sparkles: Sparkles,
  calendar: CalendarClock,
  message: MessageSquareText,
  review: ListChecks,
  terminal: SquareTerminal,
  wrench: Wrench,
}

function ToolIcon({
  tool,
  content,
  className,
}: {
  tool: ToolUse
  content?: ToolResult['content']
  className?: string
}) {
  const kind = toolKind(tool)
  const ramu = ramuTool(tool)
  const Icon = ramu
    ? RAMU_ICONS[describeRamuTool(ramu).icon]
    : content?.some((c) => c.type === 'image') || /image/i.test(tool.name)
      ? ImageIcon
      : {
          read: BookOpen,
          edit: FilePenLine,
          delete: FileMinus2,
          move: ArrowRightLeft,
          search: Search,
          execute: SquareTerminal,
          think: Brain,
          fetch: Globe,
          switch_mode: Settings2,
          other: Wrench,
        }[kind]
  return <Icon size={14} className={className} aria-hidden="true" />
}

/** A Ramu tool opens to the few facts that matter. The raw request and response stay a click away. */
function RamuToolBody({
  row,
  tool,
  result,
}: {
  row: ReturnType<typeof describeRamuTool>
  tool: ToolUse
  result: ToolResult | undefined
}) {
  useLanguage()
  const output = result?.summary?.trim()
  const failed = !!result && (result.isError || result.status === 'failed')
  const shell = row.icon === 'terminal'
  return (
    <div className="tool-ramu p-[8px_12px] space-y-2">
      {row.facts.length > 0 && (
        <dl className="m-0 space-y-1 text-caption">
          {row.facts.map((fact) => (
            <div key={fact.label} className="flex gap-3">
              <dt className="flex-none w-16 text-muted-foreground">{translate(fact.label)}</dt>
              <dd className="m-0 min-w-0 max-h-24 overflow-auto whitespace-pre-wrap break-words text-soft">
                {fact.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {failed && output && <p className="m-0 text-caption text-bad whitespace-pre-wrap break-words">{output}</p>}
      {shell && !failed && output && (
        <pre className="m-0 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-caption text-muted-foreground">
          {output}
        </pre>
      )}
      {!shell && (tool.input || output) && (
        <details className="tool-raw text-caption text-muted-foreground">
          <summary className="w-fit cursor-pointer select-none hover:text-soft">{translate('Details')}</summary>
          <pre className="m-0 mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-muted-foreground">
            {[tool.input, output].filter(Boolean).join('\n\n')}
          </pre>
        </details>
      )}
    </div>
  )
}

function ToolGroup({
  tools,
  results,
  cwd,
  active,
  activity,
  onBackground,
  taskId,
}: {
  tools: ToolUse[]
  results: Map<string, ToolResult>
  cwd: string
  active: boolean
  activity?: string
  taskId?: string
  onBackground?: (toolUseId: string) => void
}) {
  useLanguage()
  const bodyRef = useScrollFade<HTMLDivElement>()
  const running = tools.some((t) => toolIsRunning(results.get(t.toolUseId), active))
  const primaryTool = tools.find((t) => toolIsRunning(results.get(t.toolUseId), active)) ?? tools[0]!
  return (
    <Collapsible
      defaultOpen={
        running || tools.length === 1 || tools.some((tool) => toolNeedsAttention(results.get(tool.toolUseId)))
      }
      className="tool-group text-sm text-muted-foreground"
    >
      {tools.length > 1 && (
        <CollapsibleTrigger
          render={
            <Button variant="ghost" className="h-auto w-full justify-start gap-2 px-2 py-1 text-sm font-normal" />
          }
        >
          <ToolIcon
            tool={primaryTool}
            content={results.get(primaryTool.toolUseId)?.content}
            className={
              running
                ? 'tool-icon [&.running]:text-brand [&.running]:[animation:pulse_1.6s_ease-in-out_infinite] flex-none text-muted-foreground running'
                : 'tool-icon [&.running]:text-brand [&.running]:[animation:pulse_1.6s_ease-in-out_infinite] flex-none text-muted-foreground'
            }
          />
          <span className="tool-group-label">
            {activity ? (
              <WorkingText>{running ? describeTools(tools, results, active) : activity}</WorkingText>
            ) : (
              describeTools(tools, results, active)
            )}
          </span>
          <ChevronRight
            size={13}
            className="caret [&.open]:[transform:rotate(90deg)] [:is(.tool-group,_.tool)_>_[data-slot='collapsible-trigger']:is(:hover,_:focus-visible)_&]:opacity-100 [:is(.tool-group,_.tool)[data-open]_>_[data-slot='collapsible-trigger']_>_&]:[transform:rotate(90deg)] text-muted-foreground flex-none [transition:transform_0.15s_var(--ease)]"
          />
        </CollapsibleTrigger>
      )}
      <CollapsibleContent className="tool-disclosure-panel [&[data-starting-style]]:h-0 [&[data-ending-style]]:h-0 h-[var(--collapsible-panel-height)] overflow-hidden [transition:none]">
        <div
          ref={bodyRef}
          className="tool-group-body [&.fade-scroll]:max-h-[320px] [&.fade-scroll]:overflow-x-hidden [&.fade-scroll_>_*]:flex-none [&_.tool]:min-w-0 [&_.tool_>_[data-slot='collapsible-trigger']]:flex [&_.tool_>_[data-slot='collapsible-trigger']]:w-full [&_.tool_>_[data-slot='collapsible-trigger']]:max-w-full [&_.tool_>_[data-slot='collapsible-trigger']]:min-w-0 [&_.tool_>_[data-slot='collapsible-trigger']]:h-auto [&_.tool_>_[data-slot='collapsible-trigger']]:justify-start [&_.tool_>_[data-slot='collapsible-trigger']]:[border:0] [&_.tool_>_[data-slot='collapsible-trigger']]:bg-transparent [&_.tool_>_[data-slot='collapsible-trigger']]:[box-shadow:none] [&_.tool_>_[data-slot='collapsible-trigger']]:whitespace-nowrap [&_.tool_>_[data-slot='collapsible-trigger']:hover]:flex [&_.tool_>_[data-slot='collapsible-trigger']:hover]:w-full [&_.tool_>_[data-slot='collapsible-trigger']:hover]:max-w-full [&_.tool_>_[data-slot='collapsible-trigger']:hover]:min-w-0 [&_.tool_>_[data-slot='collapsible-trigger']:hover]:h-auto [&_.tool_>_[data-slot='collapsible-trigger']:hover]:justify-start [&_.tool_>_[data-slot='collapsible-trigger']:hover]:[border:0] [&_.tool_>_[data-slot='collapsible-trigger']:hover]:bg-transparent [&_.tool_>_[data-slot='collapsible-trigger']:hover]:[box-shadow:none] [&_.tool_>_[data-slot='collapsible-trigger']:hover]:whitespace-nowrap [&_.tool-summary]:flex-initial [&_.tool-summary]:min-w-0 [&_.tool-summary]:overflow-hidden [&_.tool-summary]:text-ellipsis [&_.tool-summary]:whitespace-nowrap [&_.tool_>_[data-slot='collapsible-trigger']_>_.tool-icon]:flex-none [&_.tool_>_[data-slot='collapsible-trigger']_>_.caret]:flex-none pl-3 [border-left:1px_solid_var(--line-strong)] flex flex-col m-[2px_0_0] p-0 [border:0] bg-transparent gap-0 [border-radius:0] fade-scroll [--fade-top:0px] [--fade-bottom:0px] [mask-image:linear-gradient(to_bottom,_transparent_0,_#000_var(--fade-top),_#000_calc(100%_-_var(--fade-bottom)),_transparent_100%)] [transition:--fade-top_0.14s_ease-out,_--fade-bottom_0.14s_ease-out] overflow-y-auto"
        >
          {tools.map((t) => {
            const r = results.get(t.toolUseId)
            const toolRunning = toolIsRunning(r, active)
            const summary = t.summary.split(`${cwd}/`).join('')
            const category = toolKind(t)
            const bash = category === 'execute'
            const call = ramuTool(t)
            const row = call ? describeRamuTool(call, r?.summary) : undefined
            const humanTitle = row
              ? `${translate(toolRunning ? row.running : row.done)}${row.subject ? ` ${row.subject}` : ''}`
              : t.title?.trim()
            const inputText = t.input ?? (humanTitle === summary ? undefined : summary)
            const failed = r ? r.isError || r.status === 'failed' : t.status === 'failed'
            const state = failed
              ? 'Failed'
              : t.status === 'pending' && active
                ? 'Pending'
                : toolRunning
                  ? 'Running'
                  : !r || r.running
                    ? 'Stopped'
                    : 'Completed'
            const movable = !!onBackground && t.name === 'Bash' && toolRunning
            return (
              <Collapsible
                key={t.toolUseId}
                data-tool-use-id={t.toolUseId}
                className="tool [&_[data-slot='collapsible-trigger']]:flex [&_[data-slot='collapsible-trigger']]:items-center [&_[data-slot='collapsible-trigger']]:cursor-pointer [&_[data-slot='collapsible-trigger']]:[list-style:none] [&_[data-slot='collapsible-trigger']]:min-w-0 [&_[data-slot='collapsible-trigger']]:m-0 [&_[data-slot='collapsible-trigger']]:p-[4px_6px] [&_[data-slot='collapsible-trigger']]:rounded-(--radius-s) [&_[data-slot='collapsible-trigger']]:gap-2 [&_[data-slot='collapsible-trigger']::-webkit-details-marker]:hidden [&_[data-slot='collapsible-trigger']:hover]:bg-hover [&_.caret]:text-muted-foreground [&_.caret]:flex-none [&_.caret]:[transition:transform_0.15s_var(--ease)] [&[data-open]_.caret]:[transform:rotate(90deg)] [&_>_[data-slot='collapsible-trigger']_.caret]:m-0 [&_>_[data-slot='collapsible-trigger']_.caret]:opacity-0 [&_>_[data-slot='collapsible-trigger']_.caret]:[transition:opacity_0.15s_var(--ease),_transform_0.15s_var(--ease)] [&_>_[data-slot='collapsible-trigger']]:m-0 [&_>_[data-slot='collapsible-trigger']]:p-[3px_0] [&_>_[data-slot='collapsible-trigger']]:[border-radius:0] [&_>_[data-slot='collapsible-trigger']]:gap-2 [&_>_[data-slot='collapsible-trigger']]:text-muted-foreground [&_>_[data-slot='collapsible-trigger']]:text-chat [&_>_[data-slot='collapsible-trigger']:hover]:bg-transparent [&_>_[data-slot='collapsible-trigger']:hover]:text-soft text-control text-soft rounded-(--radius-s)"
                defaultOpen={movable}
              >
                <CollapsibleTrigger render={<Button variant="ghost" />}>
                  <ToolIcon
                    tool={t}
                    content={r?.content ?? t.content}
                    className={`tool-icon flex-none ${failed ? 'text-bad' : 'text-muted-foreground'}${toolRunning ? ' running text-brand motion-safe:[animation:pulse_1.6s_ease-in-out_infinite]' : ''}`}
                  />
                  <span className="tool-summary overflow-hidden text-ellipsis whitespace-nowrap min-w-0 font-sans text-chat text-inherit flex-initial">
                    {humanTitle ??
                      `${translate(toolVerb(TOOL_VERB[t.name] ?? KIND_VERB[category], toolRunning))} ${summary}`}
                  </span>
                  {(state === 'Failed' || state === 'Pending' || state === 'Stopped') && (
                    <span
                      className={`tool-state text-caption flex-none ${state === 'Failed' ? 'text-bad' : 'text-muted-foreground'}`}
                    >
                      {translate(state)}
                    </span>
                  )}
                  <ChevronRight
                    size={12}
                    className="caret [&.open]:[transform:rotate(90deg)] [:is(.tool-group,_.tool)_>_[data-slot='collapsible-trigger']:is(:hover,_:focus-visible)_&]:opacity-100 [:is(.tool-group,_.tool)[data-open]_>_[data-slot='collapsible-trigger']_>_&]:[transform:rotate(90deg)] text-muted-foreground flex-none [transition:transform_0.15s_var(--ease)]"
                  />
                </CollapsibleTrigger>
                <CollapsibleContent className="tool-disclosure-panel [&[data-starting-style]]:h-0 [&[data-ending-style]]:h-0 h-[var(--collapsible-panel-height)] overflow-hidden [transition:none]">
                  <div className="tool-card [&_.tool-output]:m-0 [&_.tool-output]:[border:0] [&_.tool-output]:[border-radius:0] [&_.tool-output]:bg-transparent [&_.tool-output]:p-[8px_12px_10px] [&_.tool-output]:max-h-[260px] [&_.tool-output]:text-caption [&_.tool-output]:whitespace-pre-wrap [&_.tool-output]:[overflow-wrap:anywhere] [&_.tool-output]:text-muted-foreground m-[6px_0_8px] [border:1px_solid_transparent] rounded-(--radius-m) [background:rgba(255,_255,_255,_0.035)] overflow-hidden">
                    {!row && (
                      <div
                        className={
                          movable
                            ? 'tool-card-title [&.with-action]:flex [&.with-action]:items-center [&.with-action]:justify-between [&.with-action]:gap-2 [&.with-action]:pr-2 p-[8px_12px_0] text-control text-soft with-action'
                            : 'tool-card-title [&.with-action]:flex [&.with-action]:items-center [&.with-action]:justify-between [&.with-action]:gap-2 [&.with-action]:pr-2 p-[8px_12px_0] text-control text-soft'
                        }
                      >
                        <span>
                          {humanTitle ?? (category === 'other' ? toolLabel(t.name) : translate(KIND_LABEL[category]))}
                        </span>
                        {movable && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover small text-caption"
                            title={translate('Let the agent carry on while this keeps running')}
                            onClick={() => onBackground(t.toolUseId)}
                          >
                            {translate('Run in background')}
                          </Button>
                        )}
                      </div>
                    )}
                    {row ? (
                      <RamuToolBody row={row} tool={t} result={r} />
                    ) : (
                      <>
                        {inputText && (
                          <div className="tool-input p-[8px_12px] space-y-1">
                            <span className="text-caption font-medium text-muted-foreground">{translate('Input')}</span>
                            <pre className="m-0 whitespace-pre-wrap break-words max-h-48 overflow-auto font-mono text-caption text-soft">
                              {t.input ?? (bash ? `$ ${inputText}` : inputText)}
                            </pre>
                          </div>
                        )}
                        {(r?.content ?? t.content)?.length ? (
                          <div className="tool-rich-content p-[8px_12px]">
                            <AgentContentView content={(r?.content ?? t.content)!} taskId={taskId} plainText={bash} />
                          </div>
                        ) : (
                          <ShadowPre>
                            {r
                              ? r.summary || translate('No output')
                              : toolRunning
                                ? translate('Running…')
                                : translate('No output')}
                          </ShadowPre>
                        )}
                        {t.locations?.length ? (
                          <div className="tool-locations px-3 pb-2 text-caption text-muted-foreground">
                            {t.locations.map((location, i) => (
                              <div key={i}>
                                {location.path}
                                {location.line !== undefined ? `:${location.line}` : ''}
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </>
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

/** Words that arrive while the agent is writing fade in, so the newest few read dimmer. */
function fadeIn(children: React.ReactNode): React.ReactNode {
  return Children.map(children, (child) =>
    typeof child === 'string'
      ? child.split(/(\s+)/).map((part, i) =>
          part === '' || /^\s+$/.test(part) ? (
            part
          ) : (
            <span key={i} className="stream-word [animation:stream-in_1.1s_ease-out_both]">
              {part}
            </span>
          ),
        )
      : child,
  )
}
const STREAMING: Components = {
  p: ({ children }) => <p>{fadeIn(children)}</p>,
  li: ({ children }) => <li>{fadeIn(children)}</li>,
  strong: ({ children }) => <strong>{fadeIn(children)}</strong>,
  em: ({ children }) => <em>{fadeIn(children)}</em>,
  h1: ({ children }) => <h1>{fadeIn(children)}</h1>,
  h2: ({ children }) => <h2>{fadeIn(children)}</h2>,
  h3: ({ children }) => <h3>{fadeIn(children)}</h3>,
}

/** Reveals streamed text at a steady pace instead of in the bursts the provider sends it, catching up faster the further behind it is. */
function useTypewriter(text: string, active: boolean): string {
  useLanguage()
  const { preferences } = useAppSettings()
  active = active && !preferences.reduceMotion && !reducedMotion()
  const [shown, setShown] = useState(active ? 0 : text.length)
  const target = useRef(text.length)
  target.current = text.length
  useEffect(() => {
    if (!active) {
      setShown(text.length)
      return
    }
    const timer = setInterval(
      () =>
        setShown((current) => {
          const remaining = target.current - current
          if (remaining <= 0) return Math.min(current, target.current)
          return current + Math.max(2, Math.ceil(remaining * 0.12))
        }),
      32,
    )
    return () => clearInterval(timer)
  }, [active])
  if (!active || shown >= text.length) return text
  // Words appear whole: extend the cut to the next space.
  const next = text.slice(shown).search(/\s/)
  return text.slice(0, next === -1 ? text.length : shown + next)
}

/** Memoized: the markdown parse is the costliest part of a transcript, and layout changes re-render the chat without changing a message. */
const AssistantText = memo(function AssistantText({
  event: e,
  generating,
  actions,
  latest = false,
  taskId,
  sessionId,
}: {
  event: Extract<AgentEvent, { kind: 'text' }>
  generating: boolean
  actions: boolean
  latest?: boolean
  taskId?: string
  sessionId?: string
}) {
  useLanguage()
  const text = useTypewriter(e.text, generating)
  // Stable component identities: a fresh `a` function every tick would remount every link (and replay its fade) on each typewriter step.
  const components = useMemo<Components>(
    () => ({
      ...chatCodeComponents,
      ...(generating ? STREAMING : {}),
      a: ({ href, children }) => (
        <ChatLink href={href} taskId={taskId}>
          {children}
        </ChatLink>
      ),
    }),
    [generating, taskId],
  )
  return (
    <div
      className={`msg [&.user]:self-end [&.user]:whitespace-pre-wrap [&.user]:max-w-[78%] [&.user]:mt-[18px] [&.user]:w-[fit-content] [&.user]:[background:var(--bubble)] [&.user]:[border:0] [&.user]:[box-shadow:none] [&.user]:text-chat [&.user]:leading-[1.55] [&.user]:p-[10px_16px_11px] [&.user]:rounded-(--radius-l) [&.user]:tracking-[-0.006em] [&.user]:[color:var(--text-body)] [&.assistant]:relative [&.assistant]:tracking-[-0.008em] [&.assistant]:text-chat [&.assistant]:leading-[1.65] [&.assistant]:[color:var(--text-body)] [&.assistant_>_:first-child]:mt-0 [&.assistant_>_:last-child]:mb-0 [&.assistant_p]:m-[0_0_10px] [&.assistant_ul]:pl-5 [&.assistant_ul]:m-[0_0_10px] [&.assistant_ol]:pl-5 [&.assistant_ol]:m-[0_0_10px] [&.assistant_code]:[background:rgba(255,_255,_255,_0.075)] [&.assistant_code]:[border:0] [&.assistant_code]:rounded-(--radius-xs) [&.assistant_code]:p-[0_5px] [&.assistant_code]:[color:var(--text-body)] [&.assistant_code]:text-[length:0.88em] [&.assistant_pre]:overflow-x-auto [&.assistant_pre]:[white-space:pre] [&.assistant_pre]:[background:var(--code-bg)] [&.assistant_pre]:[border:1px_solid_transparent] [&.assistant_pre]:rounded-(--radius-m) [&.assistant_pre]:p-[12px_14px] [&.assistant_pre]:m-[4px_0_12px] [&.assistant_pre]:leading-[1.6] [&.assistant_pre]:[box-shadow:inset_0_1px_0_rgba(255,_255,_255,_0.02)] [&.assistant_pre]:text-[length:0.88em] [&.assistant_pre_code]:bg-transparent [&.assistant_pre_code]:p-0 [&.assistant_pre_code]:[border:none] [&.assistant_pre_code]:text-[length:inherit] [&.assistant_pre_code]:[color:#dcdce2] [&.assistant_a]:text-brand [&.assistant_a]:[text-decoration:none] [&.assistant_table]:[border-collapse:collapse] [&.assistant_table]:m-[6px_0] [&.assistant_th]:[border:1px_solid_var(--line-strong)] [&.assistant_th]:p-[3px_8px] [&.assistant_td]:[border:1px_solid_var(--line-strong)] [&.assistant_td]:p-[3px_8px] [&.meta]:text-caption [&.meta]:text-muted-foreground [&.error]:text-bad [&.assistant:hover_.msg-actions]:opacity-100 [&.assistant.generating]:[animation:arrive_100ms_var(--ease)] [&.user_.muted.small.block]:mt-0.5 [&.user_.muted.small.block]:[color:rgba(255,_255,_255,_0.7)] [&.assistant_li]:m-[3px_0] [&.assistant_li::marker]:text-muted-foreground [&.assistant_strong]:font-semibold [&.assistant_strong]:[color:#fff] [&.assistant_h1]:text-[length:1em] [&.assistant_h1]:font-semibold [&.assistant_h1]:m-[16px_0_6px] [&.assistant_h1]:tracking-[-0.012em] [&.assistant_h2]:text-[length:1em] [&.assistant_h2]:font-semibold [&.assistant_h2]:m-[16px_0_6px] [&.assistant_h2]:tracking-[-0.012em] [&.assistant_h3]:text-[length:1em] [&.assistant_h3]:font-semibold [&.assistant_h3]:m-[16px_0_6px] [&.assistant_h3]:tracking-[-0.012em] [&.assistant_a:hover]:[text-decoration:underline] [.msg-wrap.user_&.user]:max-w-full [.msg-wrap.user_&.user]:mt-3.5 [&.assistant_.msg-actions]:mt-2 [&.assistant_:is(h1,_h2,_h3,_h4,_strong)]:text-foreground break-words assistant${generating ? ' generating' : ''}`}
    >
      <Markdown
        remarkPlugins={[remarkGfm, remarkChatReferences]}
        urlTransform={(url) =>
          url.startsWith(SKILL_REFERENCE_PREFIX) || localFileLink(url) ? url : defaultUrlTransform(url)
        }
        components={components}
      >
        {text}
      </Markdown>
      {actions && !generating && (
        <div
          className={`msg-actions [&:focus-within]:opacity-100 [.msg-wrap:hover_&]:opacity-100 [.msg-wrap.user_&]:mr-1 [.msg-wrap.user_&]:mt-2 [&_.copy-btn]:w-6 [&_.copy-btn]:h-6 [&_.copy-btn]:p-0 [&_.copy-btn_svg]:w-3.5 [&_.copy-btn_svg]:h-3.5 [&.always]:opacity-100 flex items-center mt-0.5 opacity-0 [transition:opacity_0.12s_var(--ease)] gap-0.5 h-6${latest ? ' always' : ''}`}
        >
          <MessageTime at={e.at} />
          <CopyButton text={e.text} />
        </div>
      )}
    </div>
  )
})

// Building an Intl formatter costs far more than using one, so each locale keeps its own.
const timeFormats = new Map<string, { time: Intl.DateTimeFormat; full: Intl.DateTimeFormat }>()
function timeFormat(locale: string) {
  let formats = timeFormats.get(locale)
  if (!formats)
    timeFormats.set(
      locale,
      (formats = {
        time: new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }),
        full: new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'medium' }),
      }),
    )
  return formats
}

const MessageTime = memo(function MessageTime({ at }: { at?: number }) {
  useLanguage()
  if (!at) return null
  const date = new Date(at),
    formats = timeFormat(formatLocale())
  return (
    <time
      className="msg-time text-muted-foreground tabular-nums text-caption leading-[24px] p-[0_4px]"
      dateTime={date.toISOString()}
      title={formats.full.format(date)}
    >
      {formats.time.format(date)}
    </time>
  )
})

function CopyButton({ text }: { text: string }) {
  useLanguage()
  const [done, setDone] = useState(false)
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact) copy-btn"
      aria-label={translate('Copy')}
      title={translate('Copy')}
      onClick={() => {
        void copyText(text).then(
          () => {
            setDone(true)
            setTimeout(() => setDone(false), 1200)
          },
          (error) => notifyError(errorText(error), 'Copy message'),
        )
      }}
    >
      {done ? <Check size={14} /> : <Copy size={14} />}
    </Button>
  )
}

function Outcome({ outcome }: { outcome: string | undefined }) {
  useLanguage()
  if (!outcome) return null
  const text =
    outcome === 'allowed'
      ? 'Allowed'
      : outcome === 'denied'
        ? 'Denied'
        : outcome === 'answered'
          ? 'Answered'
          : 'Cancelled'
  return <div className="outcome text-caption text-muted-foreground mt-1.5">{translate(text)}</div>
}

function TurnDiff({ diff }: { diff: string }) {
  useLanguage()
  return (
    <Collapsible className="tool-group [&_>_[data-slot='collapsible-trigger']]:cursor-pointer [&_>_[data-slot='collapsible-trigger']]:[list-style:none] [&_>_[data-slot='collapsible-trigger']]:font-normal [&_>_[data-slot='collapsible-trigger']]:[transition:background_0.12s_var(--ease),_border-color_0.12s_var(--ease)] [&_>_[data-slot='collapsible-trigger']]:flex [&_>_[data-slot='collapsible-trigger']]:items-center [&_>_[data-slot='collapsible-trigger']]:justify-start [&_>_[data-slot='collapsible-trigger']]:gap-2 [&_>_[data-slot='collapsible-trigger']]:h-auto [&_>_[data-slot='collapsible-trigger']]:min-h-0 [&_>_[data-slot='collapsible-trigger']]:p-[3px_0] [&_>_[data-slot='collapsible-trigger']]:[border:0] [&_>_[data-slot='collapsible-trigger']]:[border-radius:0] [&_>_[data-slot='collapsible-trigger']]:bg-transparent [&_>_[data-slot='collapsible-trigger']]:text-muted-foreground [&_>_[data-slot='collapsible-trigger']]:text-chat [&_>_[data-slot='collapsible-trigger']::-webkit-details-marker]:hidden [&_>_[data-slot='collapsible-trigger']:hover]:bg-transparent [&_>_[data-slot='collapsible-trigger']:hover]:[border:0] [&_>_[data-slot='collapsible-trigger']:hover]:text-soft [&[data-open]_>_summary_.caret]:[transform:rotate(90deg)] [&[data-open]_>_summary]:bg-transparent [&[data-open]_>_summary]:[border:0] [&[data-open]_>_summary]:text-soft [&_>_[data-slot='collapsible-trigger']_.caret]:m-0 [&_>_[data-slot='collapsible-trigger']_.caret]:opacity-0 [&_>_[data-slot='collapsible-trigger']_.caret]:[transition:opacity_0.15s_var(--ease),_transform_0.15s_var(--ease)] text-control text-muted-foreground">
      <CollapsibleTrigger render={<Button variant="ghost" />}>
        <BookOpen size={14} />
        <span className="tool-group-label text-[length:inherit]">{translate('Changes in this turn')}</span>
        <ChevronRight
          size={13}
          className="caret [&.open]:[transform:rotate(90deg)] [:is(.tool-group,_.tool)_>_[data-slot='collapsible-trigger']:is(:hover,_:focus-visible)_&]:opacity-100 [:is(.tool-group,_.tool)[data-open]_>_[data-slot='collapsible-trigger']_>_&]:[transform:rotate(90deg)] text-muted-foreground flex-none [transition:transform_0.15s_var(--ease)]"
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="tool-disclosure-panel [&[data-starting-style]]:h-0 [&[data-ending-style]]:h-0 h-[var(--collapsible-panel-height)] overflow-hidden [transition:none]">
        <div className="tool-card [&_.tool-output]:m-0 [&_.tool-output]:[border:0] [&_.tool-output]:[border-radius:0] [&_.tool-output]:bg-transparent [&_.tool-output]:p-[8px_12px_10px] [&_.tool-output]:max-h-[260px] [&_.tool-output]:text-caption [&_.tool-output]:whitespace-pre-wrap [&_.tool-output]:[overflow-wrap:anywhere] [&_.tool-output]:text-muted-foreground m-[6px_0_8px] [border:1px_solid_transparent] rounded-(--radius-m) [background:rgba(255,_255,_255,_0.035)] overflow-hidden">
          <ShadowPre>{diff}</ShadowPre>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function EventRow({
  event: e,
  sessionId,
  taskId,
  live,
  generating = false,
  outcomes,
  questionStates,
  actions = false,
  latest = false,
  editor,
  onEdit,
  onOpenAgent,
  onOpenQuestion,
}: {
  event: AgentEvent
  sessionId: string
  taskId?: string
  live: boolean
  generating?: boolean
  outcomes: Map<string, string>
  questionStates: Map<string, QuestionState>
  actions?: boolean
  latest?: boolean
  editor?: React.ReactNode
  onEdit?: (text: string, attachments: Attachment[]) => void
  onOpenAgent?: (agentId: string) => void
  onOpenQuestion?: (requestId: string) => void
}) {
  useLanguage()
  switch (e.kind) {
    case 'recovery':
      return (
        <div
          className="conversation-separator [&::before]:[content:''] [&::before]:h-px [&::before]:flex-1 [&::before]:min-w-4 [&::before]:[background:var(--line-strong)] [&::after]:[content:''] [&::after]:h-px [&::after]:flex-1 [&::after]:min-w-4 [&::after]:[background:var(--line-strong)] [&_small]:block [&_small]:text-muted-foreground [&_small]:text-caption [&_small]:mt-[3px] flex items-center gap-3 m-[20px_0] text-caption text-center text-muted-foreground"
          role="status"
        >
          <span>{translate('Continued after restart')}</span>
        </div>
      )
    case 'compaction':
      return e.state === 'started' ? null : (
        <div
          className={`compaction-separator [&::before]:[content:''] [&::before]:h-[var(--pane-border-width)] [&::before]:[background:var(--pane-border-color)] [&::before]:flex-1 [&::after]:[content:''] [&::after]:h-[var(--pane-border-width)] [&::after]:[background:var(--pane-border-color)] [&::after]:flex-1 [&_>_span]:inline-flex [&_>_span]:items-center [&_>_span]:justify-center [&_>_span]:gap-2 [&_>_span]:text-center [&.error]:text-muted-foreground flex items-center gap-3.5 m-[18px_0] text-muted-foreground text-control${e.state === 'failed' ? ' error text-bad' : ''}`}
          role="status"
        >
          <span>
            <Minimize2 size={14} />
            {compactionLabel(e)}
          </span>
        </div>
      )
    case 'schedule':
      return <ScheduleChatCard schedule={e.schedule} />
    case 'settings':
      return (
        <div className="conversation-separator [&::before]:[content:''] [&::before]:h-px [&::before]:flex-1 [&::before]:min-w-4 [&::before]:[background:var(--line-strong)] [&::after]:[content:''] [&::after]:h-px [&::after]:flex-1 [&::after]:min-w-4 [&::after]:[background:var(--line-strong)] [&_small]:block [&_small]:text-muted-foreground [&_small]:text-caption [&_small]:mt-[3px] flex items-center gap-3 m-[20px_0] text-caption text-center text-muted-foreground">
          <span>
            <SettingsChange next={e.settings} previous={e.previous} />
            <small>
              {e.reason}
              {e.handoff ? ' · Conversation context handed over' : ''}
            </small>
            {e.previous && live && (
              <Button
                variant="ghost"
                size="sm"
                className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover small text-caption separator-action ml-2 h-[22px] min-h-[22px] p-[0_8px] text-soft"
                title={translate('Go back to the previous model and settings')}
                onClick={() =>
                  void invoke('agent.configure', sessionId, e.previous!).catch((error) =>
                    notifyError(errorText(error), 'Model'),
                  )
                }
              >
                <SwitchBackLabel previous={e.previous} />
              </Button>
            )}
          </span>
        </div>
      )
    case 'user': {
      if (!e.text.split('\n\n<ramu-context>\n')[0] && !e.attachments?.length && !sentComments(e.text).length)
        return null
      // A sub-agent's report comes back as a message, shown as a report and not as something you typed.
      const report = parseTaskReport(e.text)
      // Advice delivered after the advisor answered: the card holds the advice, this marks where the agent received it.
      const advice = parseAdvice(e.text)
      if (advice)
        return (
          <ChatActivityButton
            type="button"
            className={`advice-delivered${advice.failed ? ' failed' : ''}`}
            onClick={() => onOpenAgent?.(advisorAgentId(advice.requestId))}
            title={translate("Open the advisor's answer")}
          >
            <Lightbulb size={13} />
            <span>
              {advice.failed
                ? translate('The advisor could not answer: {0}', { '0': advice.body })
                : translate('Advice delivered to the agent')}
            </span>
            {advice.advisor && <span className="chat-activity-meta">{advice.advisor}</span>}
            <ChevronRight
              size={13}
              className="caret [&.open]:[transform:rotate(90deg)] [:is(.tool-group,_.tool)_>_[data-slot='collapsible-trigger']:is(:hover,_:focus-visible)_&]:opacity-100 [:is(.tool-group,_.tool)[data-open]_>_[data-slot='collapsible-trigger']_>_&]:[transform:rotate(90deg)] text-muted-foreground flex-none [transition:transform_0.15s_var(--ease)]"
            />
          </ChatActivityButton>
        )
      if (report)
        return (
          <div className="task-report [&_.msg.assistant]:p-0 m-[8px_0] p-[10px_14px] [border:1px_solid_transparent] rounded-(--radius-m) bg-raised">
            <div className="task-report-title flex items-center gap-1.5 mb-1 font-semibold text-control">
              <Bot size={13} />
              {report.name} <span className="muted text-muted-foreground">{report.verb}</span>
            </div>
            <div className="msg [&.user]:self-end [&.user]:whitespace-pre-wrap [&.user]:max-w-[78%] [&.user]:mt-[18px] [&.user]:w-[fit-content] [&.user]:[background:var(--bubble)] [&.user]:[border:0] [&.user]:[box-shadow:none] [&.user]:text-chat [&.user]:leading-[1.55] [&.user]:p-[10px_16px_11px] [&.user]:rounded-(--radius-l) [&.user]:tracking-[-0.006em] [&.user]:[color:var(--text-body)] [&.assistant]:relative [&.assistant]:tracking-[-0.008em] [&.assistant]:text-chat [&.assistant]:leading-[1.65] [&.assistant]:[color:var(--text-body)] [&.assistant_>_:first-child]:mt-0 [&.assistant_>_:last-child]:mb-0 [&.assistant_p]:m-[0_0_10px] [&.assistant_ul]:pl-5 [&.assistant_ul]:m-[0_0_10px] [&.assistant_ol]:pl-5 [&.assistant_ol]:m-[0_0_10px] [&.assistant_code]:[background:rgba(255,_255,_255,_0.075)] [&.assistant_code]:[border:0] [&.assistant_code]:rounded-(--radius-xs) [&.assistant_code]:p-[0_5px] [&.assistant_code]:[color:var(--text-body)] [&.assistant_code]:text-[length:0.88em] [&.assistant_pre]:overflow-x-auto [&.assistant_pre]:[white-space:pre] [&.assistant_pre]:[background:var(--code-bg)] [&.assistant_pre]:[border:1px_solid_transparent] [&.assistant_pre]:rounded-(--radius-m) [&.assistant_pre]:p-[12px_14px] [&.assistant_pre]:m-[4px_0_12px] [&.assistant_pre]:leading-[1.6] [&.assistant_pre]:[box-shadow:inset_0_1px_0_rgba(255,_255,_255,_0.02)] [&.assistant_pre]:text-[length:0.88em] [&.assistant_pre_code]:bg-transparent [&.assistant_pre_code]:p-0 [&.assistant_pre_code]:[border:none] [&.assistant_pre_code]:text-[length:inherit] [&.assistant_pre_code]:[color:#dcdce2] [&.assistant_a]:text-brand [&.assistant_a]:[text-decoration:none] [&.assistant_table]:[border-collapse:collapse] [&.assistant_table]:m-[6px_0] [&.assistant_th]:[border:1px_solid_var(--line-strong)] [&.assistant_th]:p-[3px_8px] [&.assistant_td]:[border:1px_solid_var(--line-strong)] [&.assistant_td]:p-[3px_8px] [&.meta]:text-caption [&.meta]:text-muted-foreground [&.error]:text-bad [&.assistant:hover_.msg-actions]:opacity-100 [&.assistant.generating]:[animation:arrive_100ms_var(--ease)] [&.user_.muted.small.block]:mt-0.5 [&.user_.muted.small.block]:[color:rgba(255,_255,_255,_0.7)] [&.assistant_li]:m-[3px_0] [&.assistant_li::marker]:text-muted-foreground [&.assistant_strong]:font-semibold [&.assistant_strong]:[color:#fff] [&.assistant_h1]:text-[length:1em] [&.assistant_h1]:font-semibold [&.assistant_h1]:m-[16px_0_6px] [&.assistant_h1]:tracking-[-0.012em] [&.assistant_h2]:text-[length:1em] [&.assistant_h2]:font-semibold [&.assistant_h2]:m-[16px_0_6px] [&.assistant_h2]:tracking-[-0.012em] [&.assistant_h3]:text-[length:1em] [&.assistant_h3]:font-semibold [&.assistant_h3]:m-[16px_0_6px] [&.assistant_h3]:tracking-[-0.012em] [&.assistant_a:hover]:[text-decoration:underline] [.msg-wrap.user_&.user]:max-w-full [.msg-wrap.user_&.user]:mt-3.5 [&.assistant_.msg-actions]:mt-2 [&.assistant_:is(h1,_h2,_h3,_h4,_strong)]:text-foreground break-words assistant">
              <Markdown remarkPlugins={[remarkGfm]}>{report.body}</Markdown>
            </div>
          </div>
        )
      // Stopping a Codex sub-agent goes through the main agent; the chat shows it as a note.
      const stop = parseTaskStop(e.text)
      if (stop)
        return (
          <div className="chat-activity-row chat-note" role="status">
            <Square size={11} />
            {translate('Asked the agent to stop {0}', { '0': stop.name })}
          </div>
        )
      // Late answers are yours, so they stay on the right, without the delivery note the agent reads.
      const answers = parseAnswerMessage(e.text)
      if (answers)
        return (
          <div className="msg-wrap user">
            <span className="msg-to [&_+_.msg.user]:mt-1 [.msg-wrap.user_&_+_.msg.user]:mt-1 inline-flex items-center gap-1 mt-3.5 text-muted-foreground text-caption">
              <ShieldQuestion size={12} />
              {translate("Answers to the agent's questions")}
            </span>
            <div className="msg [&.user]:self-end [&.user]:whitespace-pre-wrap [&.user]:max-w-[78%] [&.user]:mt-[18px] [&.user]:w-[fit-content] [&.user]:[background:var(--bubble)] [&.user]:[border:0] [&.user]:[box-shadow:none] [&.user]:text-chat [&.user]:leading-[1.55] [&.user]:p-[10px_16px_11px] [&.user]:rounded-(--radius-l) [&.user]:tracking-[-0.006em] [&.user]:[color:var(--text-body)] [&.assistant]:relative [&.assistant]:tracking-[-0.008em] [&.assistant]:text-chat [&.assistant]:leading-[1.65] [&.assistant]:[color:var(--text-body)] [&.assistant_>_:first-child]:mt-0 [&.assistant_>_:last-child]:mb-0 [&.assistant_p]:m-[0_0_10px] [&.assistant_ul]:pl-5 [&.assistant_ul]:m-[0_0_10px] [&.assistant_ol]:pl-5 [&.assistant_ol]:m-[0_0_10px] [&.assistant_code]:[background:rgba(255,_255,_255,_0.075)] [&.assistant_code]:[border:0] [&.assistant_code]:rounded-(--radius-xs) [&.assistant_code]:p-[0_5px] [&.assistant_code]:[color:var(--text-body)] [&.assistant_code]:text-[length:0.88em] [&.assistant_pre]:overflow-x-auto [&.assistant_pre]:[white-space:pre] [&.assistant_pre]:[background:var(--code-bg)] [&.assistant_pre]:[border:1px_solid_transparent] [&.assistant_pre]:rounded-(--radius-m) [&.assistant_pre]:p-[12px_14px] [&.assistant_pre]:m-[4px_0_12px] [&.assistant_pre]:leading-[1.6] [&.assistant_pre]:[box-shadow:inset_0_1px_0_rgba(255,_255,_255,_0.02)] [&.assistant_pre]:text-[length:0.88em] [&.assistant_pre_code]:bg-transparent [&.assistant_pre_code]:p-0 [&.assistant_pre_code]:[border:none] [&.assistant_pre_code]:text-[length:inherit] [&.assistant_pre_code]:[color:#dcdce2] [&.assistant_a]:text-brand [&.assistant_a]:[text-decoration:none] [&.assistant_table]:[border-collapse:collapse] [&.assistant_table]:m-[6px_0] [&.assistant_th]:[border:1px_solid_var(--line-strong)] [&.assistant_th]:p-[3px_8px] [&.assistant_td]:[border:1px_solid_var(--line-strong)] [&.assistant_td]:p-[3px_8px] [&.meta]:text-caption [&.meta]:text-muted-foreground [&.error]:text-bad [&.assistant:hover_.msg-actions]:opacity-100 [&.assistant.generating]:[animation:arrive_100ms_var(--ease)] [&.user_.muted.small.block]:mt-0.5 [&.user_.muted.small.block]:[color:rgba(255,_255,_255,_0.7)] [&.assistant_li]:m-[3px_0] [&.assistant_li::marker]:text-muted-foreground [&.assistant_strong]:font-semibold [&.assistant_strong]:[color:#fff] [&.assistant_h1]:text-[length:1em] [&.assistant_h1]:font-semibold [&.assistant_h1]:m-[16px_0_6px] [&.assistant_h1]:tracking-[-0.012em] [&.assistant_h2]:text-[length:1em] [&.assistant_h2]:font-semibold [&.assistant_h2]:m-[16px_0_6px] [&.assistant_h2]:tracking-[-0.012em] [&.assistant_h3]:text-[length:1em] [&.assistant_h3]:font-semibold [&.assistant_h3]:m-[16px_0_6px] [&.assistant_h3]:tracking-[-0.012em] [&.assistant_a:hover]:[text-decoration:underline] [.msg-wrap.user_&.user]:max-w-full [.msg-wrap.user_&.user]:mt-3.5 [&.assistant_.msg-actions]:mt-2 [&.assistant_:is(h1,_h2,_h3,_h4,_strong)]:text-foreground break-words user">
              {answers.body}
            </div>
            <div
              className={`msg-actions [&:focus-within]:opacity-100 [.msg-wrap:hover_&]:opacity-100 [.msg-wrap.user_&]:mr-1 [.msg-wrap.user_&]:mt-2 [&_.copy-btn]:w-6 [&_.copy-btn]:h-6 [&_.copy-btn]:p-0 [&_.copy-btn_svg]:w-3.5 [&_.copy-btn_svg]:h-3.5 [&.always]:opacity-100 flex items-center mt-0.5 opacity-0 [transition:opacity_0.12s_var(--ease)] gap-0.5 h-6${latest ? ' always' : ''}`}
            >
              <MessageTime at={e.at} />
              <CopyButton text={answers.body} />
            </div>
          </div>
        )
      // A message relayed to a sub-agent shows who it is for, not the relay instructions.
      const relay = parseTaskMessage(e.text)
      if (editor)
        return (
          <div className="msg-wrap user" aria-current>
            {e.attachments?.length ? <Attachments files={e.attachments} /> : null}
            {editor}
          </div>
        )
      return (
        <div className="msg-wrap user">
          {relay && (
            <span className="msg-to [&_+_.msg.user]:mt-1 [.msg-wrap.user_&_+_.msg.user]:mt-1 inline-flex items-center gap-1 mt-3.5 text-muted-foreground text-caption">
              <Bot size={12} />
              {translate('To ')}
              {relay.name}
            </span>
          )}
          {e.attachments?.length ? <Attachments files={e.attachments} /> : null}
          {relay ? (
            <div className="msg [&.user]:self-end [&.user]:whitespace-pre-wrap [&.user]:max-w-[78%] [&.user]:mt-[18px] [&.user]:w-[fit-content] [&.user]:[background:var(--bubble)] [&.user]:[border:0] [&.user]:[box-shadow:none] [&.user]:text-chat [&.user]:leading-[1.55] [&.user]:p-[10px_16px_11px] [&.user]:rounded-(--radius-l) [&.user]:tracking-[-0.006em] [&.user]:[color:var(--text-body)] [&.assistant]:relative [&.assistant]:tracking-[-0.008em] [&.assistant]:text-chat [&.assistant]:leading-[1.65] [&.assistant]:[color:var(--text-body)] [&.assistant_>_:first-child]:mt-0 [&.assistant_>_:last-child]:mb-0 [&.assistant_p]:m-[0_0_10px] [&.assistant_ul]:pl-5 [&.assistant_ul]:m-[0_0_10px] [&.assistant_ol]:pl-5 [&.assistant_ol]:m-[0_0_10px] [&.assistant_code]:[background:rgba(255,_255,_255,_0.075)] [&.assistant_code]:[border:0] [&.assistant_code]:rounded-(--radius-xs) [&.assistant_code]:p-[0_5px] [&.assistant_code]:[color:var(--text-body)] [&.assistant_code]:text-[length:0.88em] [&.assistant_pre]:overflow-x-auto [&.assistant_pre]:[white-space:pre] [&.assistant_pre]:[background:var(--code-bg)] [&.assistant_pre]:[border:1px_solid_transparent] [&.assistant_pre]:rounded-(--radius-m) [&.assistant_pre]:p-[12px_14px] [&.assistant_pre]:m-[4px_0_12px] [&.assistant_pre]:leading-[1.6] [&.assistant_pre]:[box-shadow:inset_0_1px_0_rgba(255,_255,_255,_0.02)] [&.assistant_pre]:text-[length:0.88em] [&.assistant_pre_code]:bg-transparent [&.assistant_pre_code]:p-0 [&.assistant_pre_code]:[border:none] [&.assistant_pre_code]:text-[length:inherit] [&.assistant_pre_code]:[color:#dcdce2] [&.assistant_a]:text-brand [&.assistant_a]:[text-decoration:none] [&.assistant_table]:[border-collapse:collapse] [&.assistant_table]:m-[6px_0] [&.assistant_th]:[border:1px_solid_var(--line-strong)] [&.assistant_th]:p-[3px_8px] [&.assistant_td]:[border:1px_solid_var(--line-strong)] [&.assistant_td]:p-[3px_8px] [&.meta]:text-caption [&.meta]:text-muted-foreground [&.error]:text-bad [&.assistant:hover_.msg-actions]:opacity-100 [&.assistant.generating]:[animation:arrive_100ms_var(--ease)] [&.user_.muted.small.block]:mt-0.5 [&.user_.muted.small.block]:[color:rgba(255,_255,_255,_0.7)] [&.assistant_li]:m-[3px_0] [&.assistant_li::marker]:text-muted-foreground [&.assistant_strong]:font-semibold [&.assistant_strong]:[color:#fff] [&.assistant_h1]:text-[length:1em] [&.assistant_h1]:font-semibold [&.assistant_h1]:m-[16px_0_6px] [&.assistant_h1]:tracking-[-0.012em] [&.assistant_h2]:text-[length:1em] [&.assistant_h2]:font-semibold [&.assistant_h2]:m-[16px_0_6px] [&.assistant_h2]:tracking-[-0.012em] [&.assistant_h3]:text-[length:1em] [&.assistant_h3]:font-semibold [&.assistant_h3]:m-[16px_0_6px] [&.assistant_h3]:tracking-[-0.012em] [&.assistant_a:hover]:[text-decoration:underline] [.msg-wrap.user_&.user]:max-w-full [.msg-wrap.user_&.user]:mt-3.5 [&.assistant_.msg-actions]:mt-2 [&.assistant_:is(h1,_h2,_h3,_h4,_strong)]:text-foreground break-words user">
              <ReferenceText text={relay.body} taskId={taskId} />
            </div>
          ) : e.text.split('\n\n<ramu-context>\n')[0] ? (
            <div className="msg [&.user]:self-end [&.user]:whitespace-pre-wrap [&.user]:max-w-[78%] [&.user]:mt-[18px] [&.user]:w-[fit-content] [&.user]:[background:var(--bubble)] [&.user]:[border:0] [&.user]:[box-shadow:none] [&.user]:text-chat [&.user]:leading-[1.55] [&.user]:p-[10px_16px_11px] [&.user]:rounded-(--radius-l) [&.user]:tracking-[-0.006em] [&.user]:[color:var(--text-body)] [&.assistant]:relative [&.assistant]:tracking-[-0.008em] [&.assistant]:text-chat [&.assistant]:leading-[1.65] [&.assistant]:[color:var(--text-body)] [&.assistant_>_:first-child]:mt-0 [&.assistant_>_:last-child]:mb-0 [&.assistant_p]:m-[0_0_10px] [&.assistant_ul]:pl-5 [&.assistant_ul]:m-[0_0_10px] [&.assistant_ol]:pl-5 [&.assistant_ol]:m-[0_0_10px] [&.assistant_code]:[background:rgba(255,_255,_255,_0.075)] [&.assistant_code]:[border:0] [&.assistant_code]:rounded-(--radius-xs) [&.assistant_code]:p-[0_5px] [&.assistant_code]:[color:var(--text-body)] [&.assistant_code]:text-[length:0.88em] [&.assistant_pre]:overflow-x-auto [&.assistant_pre]:[white-space:pre] [&.assistant_pre]:[background:var(--code-bg)] [&.assistant_pre]:[border:1px_solid_transparent] [&.assistant_pre]:rounded-(--radius-m) [&.assistant_pre]:p-[12px_14px] [&.assistant_pre]:m-[4px_0_12px] [&.assistant_pre]:leading-[1.6] [&.assistant_pre]:[box-shadow:inset_0_1px_0_rgba(255,_255,_255,_0.02)] [&.assistant_pre]:text-[length:0.88em] [&.assistant_pre_code]:bg-transparent [&.assistant_pre_code]:p-0 [&.assistant_pre_code]:[border:none] [&.assistant_pre_code]:text-[length:inherit] [&.assistant_pre_code]:[color:#dcdce2] [&.assistant_a]:text-brand [&.assistant_a]:[text-decoration:none] [&.assistant_table]:[border-collapse:collapse] [&.assistant_table]:m-[6px_0] [&.assistant_th]:[border:1px_solid_var(--line-strong)] [&.assistant_th]:p-[3px_8px] [&.assistant_td]:[border:1px_solid_var(--line-strong)] [&.assistant_td]:p-[3px_8px] [&.meta]:text-caption [&.meta]:text-muted-foreground [&.error]:text-bad [&.assistant:hover_.msg-actions]:opacity-100 [&.assistant.generating]:[animation:arrive_100ms_var(--ease)] [&.user_.muted.small.block]:mt-0.5 [&.user_.muted.small.block]:[color:rgba(255,_255,_255,_0.7)] [&.assistant_li]:m-[3px_0] [&.assistant_li::marker]:text-muted-foreground [&.assistant_strong]:font-semibold [&.assistant_strong]:[color:#fff] [&.assistant_h1]:text-[length:1em] [&.assistant_h1]:font-semibold [&.assistant_h1]:m-[16px_0_6px] [&.assistant_h1]:tracking-[-0.012em] [&.assistant_h2]:text-[length:1em] [&.assistant_h2]:font-semibold [&.assistant_h2]:m-[16px_0_6px] [&.assistant_h2]:tracking-[-0.012em] [&.assistant_h3]:text-[length:1em] [&.assistant_h3]:font-semibold [&.assistant_h3]:m-[16px_0_6px] [&.assistant_h3]:tracking-[-0.012em] [&.assistant_a:hover]:[text-decoration:underline] [.msg-wrap.user_&.user]:max-w-full [.msg-wrap.user_&.user]:mt-3.5 [&.assistant_.msg-actions]:mt-2 [&.assistant_:is(h1,_h2,_h3,_h4,_strong)]:text-foreground break-words user">
              <ReferenceText text={e.text.split('\n\n<ramu-context>\n')[0] ?? ''} taskId={taskId} />
            </div>
          ) : null}
          {sentComments(e.text).length > 0 && (
            <div className="sent-comments flex flex-col gap-1.5 self-end w-[min(420px,_100%)] mt-1.5">
              {sentComments(e.text).map((c, i) => (
                <div
                  key={i}
                  className="sent-comment [&_p]:m-[4px_0_0] [&_p]:text-control [&_p]:leading-[1.45] [&_p]:whitespace-pre-wrap [&_p]:[overflow-wrap:anywhere] [&_.comments-popover-file]:text-muted-foreground p-[8px_12px] [border:1px_solid_transparent] rounded-(--radius-m) bg-raised"
                >
                  <div className="comments-popover-where [&_.review-note-where]:flex-none [&_.review-note-where]:cursor-default flex items-center gap-2 text-caption min-w-0">
                    <span className="review-note-where [&:hover:not(:disabled)]:[background:color-mix(in_srgb,_var(--accent)_28%,_transparent)] [&:is(span)]:cursor-default p-[1px_7px] [border:0] rounded-(--radius-s) bg-brand-wash text-brand font-mono text-caption leading-[18px] cursor-pointer">
                      {c.label}
                    </span>
                    <span
                      className="comments-popover-file overflow-hidden text-ellipsis whitespace-nowrap min-w-0 text-muted-foreground"
                      title={c.path}
                    >
                      {c.path}
                    </span>
                  </div>
                  <p>{c.text}</p>
                </div>
              ))}
            </div>
          )}
          <div
            className={`msg-actions [&:focus-within]:opacity-100 [.msg-wrap:hover_&]:opacity-100 [.msg-wrap.user_&]:mr-1 [.msg-wrap.user_&]:mt-2 [&_.copy-btn]:w-6 [&_.copy-btn]:h-6 [&_.copy-btn]:p-0 [&_.copy-btn_svg]:w-3.5 [&_.copy-btn_svg]:h-3.5 [&.always]:opacity-100 flex items-center mt-0.5 opacity-0 [transition:opacity_0.12s_var(--ease)] gap-0.5 h-6${latest ? ' always' : ''}`}
          >
            <MessageTime at={e.at} />
            <CopyButton text={e.text.split('\n\n<ramu-context>\n')[0] ?? ''} />
            {onEdit && (
              <Button
                variant="ghost"
                size="icon-xs"
                className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact) copy-btn"
                aria-label={translate('Edit message')}
                title={translate('Edit and send again')}
                onClick={() => onEdit(e.text.split('\n\n<ramu-context>\n')[0] ?? '', e.attachments ?? [])}
              >
                <Pencil size={14} />
              </Button>
            )}
          </div>
        </div>
      )
    }
    case 'text':
      return (
        <AssistantText
          event={e}
          generating={generating}
          actions={actions}
          latest={latest}
          taskId={taskId}
          sessionId={sessionId}
        />
      )
    case 'turn-diff':
      return <TurnDiff diff={e.diff} />
    case 'thinking':
      return <ThinkingRow text={e.text} active={generating} />
    case 'content':
      return <AgentContentView content={e.content} taskId={taskId} />
    case 'plan':
      return (
        <div className="agent-plan space-y-2 text-control">
          <span className="inline-flex gap-2 items-center font-medium text-soft">
            <BookOpen size={14} />
            {translate('Plan')}
          </span>
          <ol className="m-0 pl-5 space-y-2">
            {e.entries.map((entry, i) => (
              <li key={i} className={entry.status === 'completed' ? 'text-muted-foreground line-through' : 'text-soft'}>
                <span>{entry.content}</span>
                <span className="ml-2 text-caption text-muted-foreground">
                  {translate(
                    entry.status === 'in_progress'
                      ? 'In progress'
                      : entry.status === 'completed'
                        ? 'Completed'
                        : 'Pending',
                  )}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )
    case 'elicitation':
      return (
        <ElicitationCard
          sessionId={sessionId}
          request={e}
          status={questionStates.get(e.requestId) ?? questionState([], e.requestId)}
          pending={live && !outcomes.has(e.requestId)}
        />
      )
    case 'permission-request': {
      const pending = live && !outcomes.has(e.requestId)
      return (
        <div
          className={
            pending
              ? 'card [&.pending]:[border-color:color-mix(in_srgb,_var(--warn)_50%,_transparent)] [&.pending]:[box-shadow:0_0_0_3px_var(--warn-wash)] [&_pre]:text-soft [border:1px_solid_transparent] rounded-(--radius-m) bg-card [border-color:var(--line-strong)] p-[12px_14px] pending'
              : 'card [&.pending]:[border-color:color-mix(in_srgb,_var(--warn)_50%,_transparent)] [&.pending]:[box-shadow:0_0_0_3px_var(--warn-wash)] [&_pre]:text-soft [border:1px_solid_transparent] rounded-(--radius-m) bg-card [border-color:var(--line-strong)] p-[12px_14px]'
          }
        >
          <div className="card-title flex items-center gap-[7px] font-semibold">
            <ShieldQuestion size={15} /> {e.title}
          </div>
          {e.detail && <pre>{e.detail}</pre>}
          {pending ? (
            <div className="row flex gap-1.5 mt-2">
              <Button
                variant="default"
                className="primary bg-primary text-primary-foreground border-transparent font-semibold justify-center hover:bg-primary-hover disabled:bg-raised disabled:text-muted-foreground disabled:opacity-100"
                onClick={() => void invoke('agent.replyPermission', sessionId, e.requestId, true)}
              >
                {translate('Allow')}
              </Button>
              <Button
                variant="secondary"
                className="bg-fill hover:bg-fill-hover"
                onClick={() => void invoke('agent.replyPermission', sessionId, e.requestId, false)}
              >
                {translate('Deny')}
              </Button>
            </div>
          ) : (
            <Outcome outcome={outcomes.get(e.requestId)} />
          )}
        </div>
      )
    }
    case 'question':
      return (
        <QuestionRow
          request={e}
          status={questionStates.get(e.requestId) ?? { answers: {}, drafts: {}, waiting: false }}
          showAnswers={e.responseMode !== 'message' || questionStates.get(e.requestId)?.outcome !== 'answered'}
          pending={(e.responseMode === 'message' || live) && !outcomes.has(e.requestId)}
          onOpen={onOpenQuestion}
        />
      )
    case 'result':
      return e.isError ? (
        <div className="turn-end [&_svg]:text-ok [&_svg]:flex-none [&_svg]:w-3.5 [&_svg]:h-3.5 [&_svg]:p-0.5 [&_svg]:rounded-full [&_svg]:[background:var(--ok-wash)] [&.error_svg]:text-bad [&.error_svg]:[background:var(--bad-wash)] [&.chat-note]:m-[8px_0] [&.chat-note_svg]:text-muted-foreground [&_.muted]:ml-auto [&_.muted]:tabular-nums [&.error]:[border-top:none] [&.error]:text-bad flex items-center text-caption text-muted-foreground gap-2 p-[6px_0_2px] [border-top:1px_solid_var(--line)] mt-1 error text-bad">
          <CircleAlert size={13} />
          {translate('The agent reported a failure.')}
        </div>
      ) : null
    case 'file-restore':
      return (
        <div
          className="turn-end [&_svg]:text-ok [&_svg]:flex-none [&_svg]:w-3.5 [&_svg]:h-3.5 [&_svg]:p-0.5 [&_svg]:rounded-full [&_svg]:[background:var(--ok-wash)] [&.error_svg]:text-bad [&.error_svg]:[background:var(--bad-wash)] [&.chat-note]:m-[8px_0] [&.chat-note_svg]:text-muted-foreground [&_.muted]:ml-auto [&_.muted]:tabular-nums [&.error]:[border-top:none] [&.error]:text-bad flex items-center text-caption text-muted-foreground gap-2 p-[6px_0_2px] [border-top:1px_solid_var(--line)] mt-1"
          role="status"
        >
          {translate('Restored {0} files from message {1} and later captured runs.', {
            '0': e.fileCount,
            '1': e.userSeq,
          })}
        </div>
      )
    case 'error':
      return (
        <div className="msg [&.user]:self-end [&.user]:whitespace-pre-wrap [&.user]:max-w-[78%] [&.user]:mt-[18px] [&.user]:w-[fit-content] [&.user]:[background:var(--bubble)] [&.user]:[border:0] [&.user]:[box-shadow:none] [&.user]:text-chat [&.user]:leading-[1.55] [&.user]:p-[10px_16px_11px] [&.user]:rounded-(--radius-l) [&.user]:tracking-[-0.006em] [&.user]:[color:var(--text-body)] [&.assistant]:relative [&.assistant]:tracking-[-0.008em] [&.assistant]:text-chat [&.assistant]:leading-[1.65] [&.assistant]:[color:var(--text-body)] [&.assistant_>_:first-child]:mt-0 [&.assistant_>_:last-child]:mb-0 [&.assistant_p]:m-[0_0_10px] [&.assistant_ul]:pl-5 [&.assistant_ul]:m-[0_0_10px] [&.assistant_ol]:pl-5 [&.assistant_ol]:m-[0_0_10px] [&.assistant_code]:[background:rgba(255,_255,_255,_0.075)] [&.assistant_code]:[border:0] [&.assistant_code]:rounded-(--radius-xs) [&.assistant_code]:p-[0_5px] [&.assistant_code]:[color:var(--text-body)] [&.assistant_code]:text-[length:0.88em] [&.assistant_pre]:overflow-x-auto [&.assistant_pre]:[white-space:pre] [&.assistant_pre]:[background:var(--code-bg)] [&.assistant_pre]:[border:1px_solid_transparent] [&.assistant_pre]:rounded-(--radius-m) [&.assistant_pre]:p-[12px_14px] [&.assistant_pre]:m-[4px_0_12px] [&.assistant_pre]:leading-[1.6] [&.assistant_pre]:[box-shadow:inset_0_1px_0_rgba(255,_255,_255,_0.02)] [&.assistant_pre]:text-[length:0.88em] [&.assistant_pre_code]:bg-transparent [&.assistant_pre_code]:p-0 [&.assistant_pre_code]:[border:none] [&.assistant_pre_code]:text-[length:inherit] [&.assistant_pre_code]:[color:#dcdce2] [&.assistant_a]:text-brand [&.assistant_a]:[text-decoration:none] [&.assistant_table]:[border-collapse:collapse] [&.assistant_table]:m-[6px_0] [&.assistant_th]:[border:1px_solid_var(--line-strong)] [&.assistant_th]:p-[3px_8px] [&.assistant_td]:[border:1px_solid_var(--line-strong)] [&.assistant_td]:p-[3px_8px] [&.meta]:text-caption [&.meta]:text-muted-foreground [&.error]:text-bad [&.assistant:hover_.msg-actions]:opacity-100 [&.assistant.generating]:[animation:arrive_100ms_var(--ease)] [&.user_.muted.small.block]:mt-0.5 [&.user_.muted.small.block]:[color:rgba(255,_255,_255,_0.7)] [&.assistant_li]:m-[3px_0] [&.assistant_li::marker]:text-muted-foreground [&.assistant_strong]:font-semibold [&.assistant_strong]:[color:#fff] [&.assistant_h1]:text-[length:1em] [&.assistant_h1]:font-semibold [&.assistant_h1]:m-[16px_0_6px] [&.assistant_h1]:tracking-[-0.012em] [&.assistant_h2]:text-[length:1em] [&.assistant_h2]:font-semibold [&.assistant_h2]:m-[16px_0_6px] [&.assistant_h2]:tracking-[-0.012em] [&.assistant_h3]:text-[length:1em] [&.assistant_h3]:font-semibold [&.assistant_h3]:m-[16px_0_6px] [&.assistant_h3]:tracking-[-0.012em] [&.assistant_a:hover]:[text-decoration:underline] [.msg-wrap.user_&.user]:max-w-full [.msg-wrap.user_&.user]:mt-3.5 [&.assistant_.msg-actions]:mt-2 [&.assistant_:is(h1,_h2,_h3,_h4,_strong)]:text-foreground break-words error text-bad">
          {e.message}
        </div>
      )
    default:
      return null
  }
}

const agentOf = (block: Block): AgentTask => (block as { event: AgentTask }).event
const isAgentCard = (block: Block) =>
  block.kind === 'event' && block.event.kind === 'agent' && block.event.taskType !== 'advisor'

/** Runs of two or more sub-agent cards, as arrays; everything else passes through. */
function groupAgentRuns(blocks: Block[]): (Block | Block[])[] {
  const out: (Block | Block[])[] = []
  let run: Block[] = []
  const flush = () => {
    if (run.length > 1) out.push(run)
    else out.push(...run)
    run = []
  }
  for (const block of blocks) {
    if (isAgentCard(block)) run.push(block)
    else {
      flush()
      out.push(block)
    }
  }
  flush()
  return out
}

const TASK_STATUS: Record<AgentTask['status'], string> = {
  running: 'Running',
  completed: 'Done',
  failed: 'Failed',
  stopped: 'Stopped',
}

function TaskStatusIcon({ status }: { status: AgentTask['status'] }) {
  useLanguage()
  if (status === 'running') return <Spinner className="size-3.5 task-status running" aria-hidden="true" />
  if (status === 'completed') return <CircleCheck size={14} className="task-status completed" aria-hidden="true" />
  if (status === 'failed') return <CircleX size={14} className="task-status failed" aria-hidden="true" />
  return <CircleSlash size={14} className="task-status stopped" aria-hidden="true" />
}

/** Tool uses, time and tokens, as far as the provider reports them. */
function taskMeta(task: AgentTask, status: AgentTask['status']): string {
  const duration =
    task.durationMs ??
    (task.startedAt && (task.endedAt ?? (status === 'running' ? Date.now() : undefined))
      ? (task.endedAt ?? Date.now()) - task.startedAt
      : undefined)
  return [
    task.provider
      ? `${providerName(task.provider)}${task.model ? ` · ${modelDisplayName(task.model)}` : ''}`
      : undefined,
    task.agentType,
    task.taskType === 'local_bash' ? 'Command' : undefined,
    task.isolated ? 'Own copy' : undefined,
    task.background ? 'Background' : undefined,
    task.toolUses ? `${task.toolUses} ${task.toolUses === 1 ? 'tool use' : 'tool uses'}` : undefined,
    duration ? formatDuration(duration) : undefined,
    task.tokens ? `${Math.round(task.tokens / 100) / 10}k tokens` : undefined,
  ]
    .filter(Boolean)
    .join(' · ')
}

/** A sub-agent in the main transcript, where the main agent started it. */
/** A consultation remains visible in the main chat even with Agents closed. */
function AdvisorActivity({ task, live, onOpen }: { task: AgentTask; live: boolean; onOpen: () => void }) {
  useLanguage()
  const status = effectiveStatus(task, live)
  const elapsed = useElapsed(task.startedAt, status === 'running')
  const label =
    status === 'running'
      ? 'Consulting advisor…'
      : status === 'completed'
        ? 'Advisor finished'
        : status === 'failed'
          ? 'Advisor failed'
          : 'Advisor stopped'
  const duration = elapsed ?? (task.endedAt && task.startedAt ? task.endedAt - task.startedAt : null)
  return (
    <ChatActivityButton
      type="button"
      className={`advisor-activity ${status}`}
      onClick={onOpen}
      title={task.error ?? translate("Open the advisor's answer")}
    >
      {status === 'running' ? <Spinner className="size-3.5 flex-none" /> : <TaskStatusIcon status={status} />}
      <span role="status">{translate(label)}</span>
      {(task.model || task.provider) && (
        <span className="chat-activity-meta truncate">
          {task.model ? modelDisplayName(task.model) : providerName(task.provider!)}
        </span>
      )}
      {duration !== null && (
        <span className="chat-activity-meta flex-none tabular-nums">{formatDuration(duration)}</span>
      )}
      <ChevronRight className="size-3.5 flex-none" />
    </ChatActivityButton>
  )
}

/** Many sub-agents at once: stacked avatars and one status line that opens into each agent's card. */
function AgentGroup({
  tasks,
  live,
  onOpen,
  onStop,
}: {
  tasks: AgentTask[]
  live: boolean
  onOpen: (agentId: string) => void
  onStop: (task: AgentTask) => void
}) {
  useLanguage()
  const statuses = tasks.map((task) => effectiveStatus(task, live))
  const running = statuses.includes('running')
  const failed = statuses.includes('failed')
  return (
    <Collapsible className="agent-group text-sm">
      <CollapsibleTrigger
        render={
          <Button
            variant="ghost"
            className="h-auto w-full justify-start gap-3 rounded-(--radius-m) bg-raised px-3 py-2 text-sm font-normal hover:bg-fill"
          />
        }
      >
        <span className="flex flex-none items-center" aria-hidden="true">
          {tasks.slice(0, 3).map((task, index) => (
            <span
              key={task.agentId}
              className="grid size-6 place-items-center rounded-full bg-accent text-soft [box-shadow:0_0_0_2px_var(--raised)]"
              style={{ marginLeft: index === 0 ? 0 : -8 }}
            >
              {task.provider ? <ProviderIcon provider={task.provider} size={13} /> : <Bot size={13} />}
            </span>
          ))}
          {tasks.length > 3 && (
            <span
              className="grid size-6 place-items-center rounded-full bg-accent text-caption text-muted-foreground [box-shadow:0_0_0_2px_var(--raised)]"
              style={{ marginLeft: -8 }}
            >
              +{tasks.length - 3}
            </span>
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left">
          <span className="font-semibold text-foreground">{translate('{0} agents', { 0: tasks.length })}</span>
          <span className={`text-caption ${failed ? 'text-bad' : running ? 'text-brand' : 'text-muted-foreground'}`}>
            {summarizeAgentStatuses(statuses, (status) => translate(TASK_STATUS[status]).toLowerCase())}
          </span>
        </span>
        {running && <Spinner className="size-3.5 flex-none" aria-hidden="true" />}
        <ChevronRight
          size={14}
          className="caret flex-none text-muted-foreground [transition:transform_0.15s_var(--ease)] [[data-open]>_[data-slot='collapsible-trigger']_&]:[transform:rotate(90deg)]"
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="tool-disclosure-panel [&[data-starting-style]]:h-0 [&[data-ending-style]]:h-0 h-[var(--collapsible-panel-height)] overflow-hidden [transition:none]">
        <div className="flex flex-col gap-1.5 pt-1.5">
          {tasks.map((task) => (
            <AgentTaskCard
              key={task.agentId}
              task={task}
              live={live}
              onOpen={() => onOpen(task.agentId)}
              onStop={onStop}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function AgentTaskCard({
  task,
  live,
  onOpen,
  onStop,
}: {
  task: AgentTask
  live: boolean
  onOpen: () => void
  onStop: (task: AgentTask) => void
}) {
  useLanguage()
  const status = effectiveStatus(task, live)
  useElapsed(task.startedAt, status === 'running')
  const final = task.error ?? task.summary
  const detail =
    status === 'running'
      ? (task.summary ?? (task.lastTool ? `Using ${toolLabel(task.lastTool)}` : 'Starting…'))
      : final && final.toLowerCase() !== TASK_STATUS[status].toLowerCase()
        ? final
        : undefined
  return (
    <div
      className={`agent-task-card [&.running]:[border-color:var(--line-strong)] [&:has(.agent-task-stop)_.agent-task-open]:pr-[44px] relative flex items-stretch [border:1px_solid_transparent] rounded-(--radius-m) bg-raised ${status}`}
    >
      <Button
        variant="secondary"
        type="button"
        className="bg-fill hover:bg-fill-hover agent-task-open [&:hover:not(:disabled)]:bg-hover [&:hover:not(:disabled)]:[border:0] [&_.caret]:flex-none [&_.caret]:text-muted-foreground flex-1 min-w-0 flex items-center justify-start gap-2.5 h-auto min-h-[52px] p-[8px_12px] [border:0] [border-radius:inherit] bg-transparent text-left whitespace-normal"
        aria-label={translate('Open agent {0}', { '0': task.name })}
        onClick={onOpen}
      >
        <span className="agent-task-icon flex-none grid place-items-center w-7 h-7 rounded-(--radius-s) bg-accent text-soft">
          {task.taskType === 'local_bash' ? (
            <SquareTerminal size={15} />
          ) : task.provider ? (
            <ProviderIcon provider={task.provider} size={14} />
          ) : (
            <Bot size={15} />
          )}
        </span>
        <span className="agent-task-text flex-1 min-w-0 flex flex-col gap-0.5">
          <span className="agent-task-title flex items-center gap-2 min-w-0">
            <span className="agent-task-name min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-semibold text-foreground">
              {task.name}
            </span>
            <span
              className={`agent-task-state flex-none inline-flex items-center gap-1 text-muted-foreground text-caption ${status}`}
            >
              <TaskStatusIcon status={status} />
              {translate(TASK_STATUS[status])}
            </span>
          </span>
          {detail && (
            <span className="agent-task-detail text-soft text-control overflow-hidden text-ellipsis whitespace-nowrap">
              {detail}
            </span>
          )}
          {taskMeta(task, status) && (
            <span className="agent-task-meta text-muted-foreground text-caption overflow-hidden text-ellipsis whitespace-nowrap">
              {taskMeta(task, status)}
            </span>
          )}
          {!!task.steps?.length && (
            <span className="agent-task-steps text-muted-foreground text-caption overflow-hidden text-ellipsis whitespace-nowrap">
              {task.steps.map((step, index) => (
                <span key={index}>
                  {index > 0 && ' → '}
                  {providerName(step.provider)}
                  {step.model ? ` ${modelDisplayName(step.model)}` : ''}
                </span>
              ))}{' '}
              · {task.steps.at(-1)!.reason}
            </span>
          )}
        </span>
        <ChevronRight
          size={14}
          className="caret [&.open]:[transform:rotate(90deg)] [:is(.tool-group,_.tool)_>_[data-slot='collapsible-trigger']:is(:hover,_:focus-visible)_&]:opacity-100 [:is(.tool-group,_.tool)[data-open]_>_[data-slot='collapsible-trigger']_>_&]:[transform:rotate(90deg)] text-muted-foreground flex-none [transition:transform_0.15s_var(--ease)]"
        />
      </Button>
      {status === 'running' && live && task.canStop && (
        <Button
          variant="ghost"
          size="icon-xs"
          className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact) agent-task-stop absolute top-[50%] right-8 [translate:0_-50%] text-muted-foreground"
          aria-label={translate('Stop agent {0}', { '0': task.name })}
          title={translate('Stop this agent')}
          onClick={() => onStop(task)}
        >
          <Square size={12} />
        </Button>
      )}
    </div>
  )
}

/** One sub-agent's own conversation beside the chat, or the list of all of them. */
function AgentTaskPanel({
  tasks,
  openId,
  events,
  results,
  cwd,
  live,
  taskId,
  onSelect,
  onClose,
  onStop,
  onMessage,
}: {
  tasks: AgentTask[]
  openId: string
  events: AgentEvent[]
  results: Map<string, ToolResult>
  cwd: string
  live: boolean
  taskId?: string
  onSelect: (id: string | null) => void
  onClose: () => void
  onStop: (task: AgentTask) => void
  onMessage: (task: AgentTask, text: string) => Promise<void>
}) {
  useLanguage()
  const task = openId === '*' ? undefined : tasks.find((entry) => entry.agentId === openId)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const body = useRef<HTMLDivElement>(null)
  useEffect(() => {
    setDraft('')
  }, [openId])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  // Its own output, plus what you sent it through the main agent.
  const own = useMemo(() => {
    if (!task) return []
    const address = task.address ?? task.agentId
    // A background command has no conversation; its transcript is the Bash call that started it and that call's output.
    if (task.taskType === 'local_bash')
      return toBlocks(events.filter((event) => event.kind === 'tool-use' && event.toolUseId === task.toolUseId))
    return toBlocks(
      (task.taskType === 'advisor' ? advisorTranscript(events, task.agentId) : events).flatMap(
        (event): AgentEvent[] => {
          if (event.kind === 'user' && event.agentId === task.agentId) {
            const { agentId: _, ...rest } = event
            return [rest as AgentEvent]
          }
          if (event.kind === 'user') {
            const relay = parseTaskMessage(event.text)
            return relay?.address === address ? [{ ...event, text: relay.body }] : []
          }
          if (event.kind === 'agent' || event.agentId !== task.agentId) return []
          const { agentId: _, ...rest } = event
          return [rest as AgentEvent]
        },
      ),
    )
  }, [events, task?.agentId, task?.address, task?.taskType, task?.toolUseId])
  useEffect(() => {
    const el = body.current
    if (el) el.scrollTop = el.scrollHeight
  }, [own.length])
  const status = task ? effectiveStatus(task, live) : 'stopped'
  const send = async () => {
    if (!task || !draft.trim() || sending) return
    setSending(true)
    try {
      await onMessage(task, draft.trim())
      setDraft('')
    } finally {
      setSending(false)
    }
  }
  return (
    <aside
      className="agent-panel absolute inset-[0_0_0_auto] z-6 w-[min(440px,_100%)] flex flex-col bg-canvas [box-shadow:-16px_0_32px_rgba(0,_0,_0,_0.28)] [animation:fade_0.12s_var(--ease)] [box-sizing:border-box] min-w-0 max-w-full overflow-hidden [border-left:var(--pane-border-width)_solid_var(--pane-border-color)]"
      aria-label={task ? translate('Agent {0}', { '0': task.name }) : translate('Agents')}
    >
      <header className="agent-panel-header [&_>_.small-icon]:flex-none flex items-center gap-1.5 min-h-10 p-[4px_8px_4px_12px] flex-none pr-2 [border-bottom:0]">
        {task && tasks.length > 1 && (
          <Button
            variant="ghost"
            size="icon-xs"
            className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)"
            aria-label={translate('All agents')}
            title={translate('All agents')}
            onClick={() => onSelect('*')}
          >
            <ArrowLeft size={14} />
          </Button>
        )}
        {task ? (
          <>
            <TaskStatusIcon status={status} />
            <span
              className="agent-panel-title [.aside-panel_&]:flex-none min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-semibold"
              title={task.name}
            >
              {task.name}
            </span>
          </>
        ) : (
          <>
            <Bot size={15} />
            <span className="agent-panel-title [.aside-panel_&]:flex-none min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-semibold">
              {translate('Agents')}
            </span>
          </>
        )}
        <span className="grow flex-1 min-w-0 text-left" />
        {task && status === 'running' && live && task.canStop && (
          <Button
            variant="ghost"
            size="sm"
            className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover small text-caption"
            onClick={() => onStop(task)}
          >
            <Square size={11} />
            {translate('Stop')}
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-xs"
          className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)"
          aria-label={translate('Close agent panel')}
          title={translate('Close (Esc)')}
          onClick={onClose}
        >
          <X size={14} />
        </Button>
      </header>
      {!task ? (
        <div className="agent-panel-body [&_.msg-wrap.user]:self-end [&_.msg-wrap.user]:max-w-[90%] [&_.msg-wrap.user_.msg.user]:mt-0 [&_>_*]:min-w-0 [&_>_*]:max-w-full [&_>_*]:flex-none [&_>_*]:[overflow-wrap:anywhere] flex-1 min-h-0 overflow-auto flex flex-col gap-2.5 p-[10px_14px_16px] agent-panel-list gap-2 pt-3">
          {tasks.map((entry) => (
            <AgentTaskCard
              key={entry.agentId}
              task={entry}
              live={live}
              onOpen={() => onSelect(entry.agentId)}
              onStop={onStop}
            />
          ))}
        </div>
      ) : (
        <>
          <div className="agent-panel-meta p-[8px_14px_0] flex-none muted text-muted-foreground small text-caption">
            {[translate(TASK_STATUS[status]), taskMeta(task, status)].filter(Boolean).join(' · ')}
          </div>
          <div
            ref={body}
            className="agent-panel-body [&_.msg-wrap.user]:self-end [&_.msg-wrap.user]:max-w-[90%] [&_.msg-wrap.user_.msg.user]:mt-0 [&_>_*]:min-w-0 [&_>_*]:max-w-full [&_>_*]:flex-none [&_>_*]:[overflow-wrap:anywhere] flex-1 min-h-0 overflow-auto flex flex-col gap-2.5 p-[10px_14px_16px]"
          >
            {task.recoveryError && (
              <p className="muted text-muted-foreground small text-caption" role="status">
                {translate(
                  'Saved provider history could not be fully recovered. Previously received output is still shown.',
                )}{' '}
                {task.recoveryError}
              </p>
            )}
            {task.prompt && (
              <div className="agent-panel-prompt p-[10px_12px] [border:1px_solid_transparent] rounded-(--radius-m) bg-raised">
                <span className="agent-panel-label block mb-1 text-muted-foreground text-caption font-semibold tracking-[0.02em] [text-transform:uppercase]">
                  {translate('Task')}
                </span>
                <div className="agent-panel-prompt-text whitespace-pre-wrap [overflow-wrap:anywhere] text-soft text-control leading-[1.5]">
                  {task.prompt}
                </div>
              </div>
            )}
            {own.map((block, index) => (
              <div key={index}>
                {block.kind === 'tools' ? (
                  <ToolGroup
                    tools={block.tools}
                    results={results}
                    cwd={cwd}
                    active={status === 'running' && live}
                    taskId={taskId}
                  />
                ) : block.event.kind === 'text' ? (
                  <AssistantText event={block.event} generating={false} actions={false} taskId={taskId} />
                ) : block.event.kind === 'content' ? (
                  <AgentContentView content={block.event.content} taskId={taskId} />
                ) : block.event.kind === 'turn-diff' ? (
                  <TurnDiff diff={block.event.diff} />
                ) : block.event.kind === 'user' ? (
                  <div className="msg-wrap user">
                    <div className="msg [&.user]:self-end [&.user]:whitespace-pre-wrap [&.user]:max-w-[78%] [&.user]:mt-[18px] [&.user]:w-[fit-content] [&.user]:[background:var(--bubble)] [&.user]:[border:0] [&.user]:[box-shadow:none] [&.user]:text-chat [&.user]:leading-[1.55] [&.user]:p-[10px_16px_11px] [&.user]:rounded-(--radius-l) [&.user]:tracking-[-0.006em] [&.user]:[color:var(--text-body)] [&.assistant]:relative [&.assistant]:tracking-[-0.008em] [&.assistant]:text-chat [&.assistant]:leading-[1.65] [&.assistant]:[color:var(--text-body)] [&.assistant_>_:first-child]:mt-0 [&.assistant_>_:last-child]:mb-0 [&.assistant_p]:m-[0_0_10px] [&.assistant_ul]:pl-5 [&.assistant_ul]:m-[0_0_10px] [&.assistant_ol]:pl-5 [&.assistant_ol]:m-[0_0_10px] [&.assistant_code]:[background:rgba(255,_255,_255,_0.075)] [&.assistant_code]:[border:0] [&.assistant_code]:rounded-(--radius-xs) [&.assistant_code]:p-[0_5px] [&.assistant_code]:[color:var(--text-body)] [&.assistant_code]:text-[length:0.88em] [&.assistant_pre]:overflow-x-auto [&.assistant_pre]:[white-space:pre] [&.assistant_pre]:[background:var(--code-bg)] [&.assistant_pre]:[border:1px_solid_transparent] [&.assistant_pre]:rounded-(--radius-m) [&.assistant_pre]:p-[12px_14px] [&.assistant_pre]:m-[4px_0_12px] [&.assistant_pre]:leading-[1.6] [&.assistant_pre]:[box-shadow:inset_0_1px_0_rgba(255,_255,_255,_0.02)] [&.assistant_pre]:text-[length:0.88em] [&.assistant_pre_code]:bg-transparent [&.assistant_pre_code]:p-0 [&.assistant_pre_code]:[border:none] [&.assistant_pre_code]:text-[length:inherit] [&.assistant_pre_code]:[color:#dcdce2] [&.assistant_a]:text-brand [&.assistant_a]:[text-decoration:none] [&.assistant_table]:[border-collapse:collapse] [&.assistant_table]:m-[6px_0] [&.assistant_th]:[border:1px_solid_var(--line-strong)] [&.assistant_th]:p-[3px_8px] [&.assistant_td]:[border:1px_solid_var(--line-strong)] [&.assistant_td]:p-[3px_8px] [&.meta]:text-caption [&.meta]:text-muted-foreground [&.error]:text-bad [&.assistant:hover_.msg-actions]:opacity-100 [&.assistant.generating]:[animation:arrive_100ms_var(--ease)] [&.user_.muted.small.block]:mt-0.5 [&.user_.muted.small.block]:[color:rgba(255,_255,_255,_0.7)] [&.assistant_li]:m-[3px_0] [&.assistant_li::marker]:text-muted-foreground [&.assistant_strong]:font-semibold [&.assistant_strong]:[color:#fff] [&.assistant_h1]:text-[length:1em] [&.assistant_h1]:font-semibold [&.assistant_h1]:m-[16px_0_6px] [&.assistant_h1]:tracking-[-0.012em] [&.assistant_h2]:text-[length:1em] [&.assistant_h2]:font-semibold [&.assistant_h2]:m-[16px_0_6px] [&.assistant_h2]:tracking-[-0.012em] [&.assistant_h3]:text-[length:1em] [&.assistant_h3]:font-semibold [&.assistant_h3]:m-[16px_0_6px] [&.assistant_h3]:tracking-[-0.012em] [&.assistant_a:hover]:[text-decoration:underline] [.msg-wrap.user_&.user]:max-w-full [.msg-wrap.user_&.user]:mt-3.5 [&.assistant_.msg-actions]:mt-2 [&.assistant_:is(h1,_h2,_h3,_h4,_strong)]:text-foreground break-words user">
                      {block.event.text}
                    </div>
                  </div>
                ) : block.event.kind === 'thinking' ? (
                  <ThinkingRow text={block.event.text} active={status === 'running' && live && block === own.at(-1)} />
                ) : block.event.kind === 'error' ? (
                  <div className="msg [&.user]:self-end [&.user]:whitespace-pre-wrap [&.user]:max-w-[78%] [&.user]:mt-[18px] [&.user]:w-[fit-content] [&.user]:[background:var(--bubble)] [&.user]:[border:0] [&.user]:[box-shadow:none] [&.user]:text-chat [&.user]:leading-[1.55] [&.user]:p-[10px_16px_11px] [&.user]:rounded-(--radius-l) [&.user]:tracking-[-0.006em] [&.user]:[color:var(--text-body)] [&.assistant]:relative [&.assistant]:tracking-[-0.008em] [&.assistant]:text-chat [&.assistant]:leading-[1.65] [&.assistant]:[color:var(--text-body)] [&.assistant_>_:first-child]:mt-0 [&.assistant_>_:last-child]:mb-0 [&.assistant_p]:m-[0_0_10px] [&.assistant_ul]:pl-5 [&.assistant_ul]:m-[0_0_10px] [&.assistant_ol]:pl-5 [&.assistant_ol]:m-[0_0_10px] [&.assistant_code]:[background:rgba(255,_255,_255,_0.075)] [&.assistant_code]:[border:0] [&.assistant_code]:rounded-(--radius-xs) [&.assistant_code]:p-[0_5px] [&.assistant_code]:[color:var(--text-body)] [&.assistant_code]:text-[length:0.88em] [&.assistant_pre]:overflow-x-auto [&.assistant_pre]:[white-space:pre] [&.assistant_pre]:[background:var(--code-bg)] [&.assistant_pre]:[border:1px_solid_transparent] [&.assistant_pre]:rounded-(--radius-m) [&.assistant_pre]:p-[12px_14px] [&.assistant_pre]:m-[4px_0_12px] [&.assistant_pre]:leading-[1.6] [&.assistant_pre]:[box-shadow:inset_0_1px_0_rgba(255,_255,_255,_0.02)] [&.assistant_pre]:text-[length:0.88em] [&.assistant_pre_code]:bg-transparent [&.assistant_pre_code]:p-0 [&.assistant_pre_code]:[border:none] [&.assistant_pre_code]:text-[length:inherit] [&.assistant_pre_code]:[color:#dcdce2] [&.assistant_a]:text-brand [&.assistant_a]:[text-decoration:none] [&.assistant_table]:[border-collapse:collapse] [&.assistant_table]:m-[6px_0] [&.assistant_th]:[border:1px_solid_var(--line-strong)] [&.assistant_th]:p-[3px_8px] [&.assistant_td]:[border:1px_solid_var(--line-strong)] [&.assistant_td]:p-[3px_8px] [&.meta]:text-caption [&.meta]:text-muted-foreground [&.error]:text-bad [&.assistant:hover_.msg-actions]:opacity-100 [&.assistant.generating]:[animation:arrive_100ms_var(--ease)] [&.user_.muted.small.block]:mt-0.5 [&.user_.muted.small.block]:[color:rgba(255,_255,_255,_0.7)] [&.assistant_li]:m-[3px_0] [&.assistant_li::marker]:text-muted-foreground [&.assistant_strong]:font-semibold [&.assistant_strong]:[color:#fff] [&.assistant_h1]:text-[length:1em] [&.assistant_h1]:font-semibold [&.assistant_h1]:m-[16px_0_6px] [&.assistant_h1]:tracking-[-0.012em] [&.assistant_h2]:text-[length:1em] [&.assistant_h2]:font-semibold [&.assistant_h2]:m-[16px_0_6px] [&.assistant_h2]:tracking-[-0.012em] [&.assistant_h3]:text-[length:1em] [&.assistant_h3]:font-semibold [&.assistant_h3]:m-[16px_0_6px] [&.assistant_h3]:tracking-[-0.012em] [&.assistant_a:hover]:[text-decoration:underline] [.msg-wrap.user_&.user]:max-w-full [.msg-wrap.user_&.user]:mt-3.5 [&.assistant_.msg-actions]:mt-2 [&.assistant_:is(h1,_h2,_h3,_h4,_strong)]:text-foreground break-words error text-bad">
                    {block.event.message}
                  </div>
                ) : null}
              </div>
            ))}
            {!own.length && (
              <p className="muted text-muted-foreground small text-caption">
                {status === 'running'
                  ? translate('Working… its messages and tool calls appear here.')
                  : task.taskType === 'local_bash'
                    ? translate('This command left no output.')
                    : translate('This agent left no transcript.')}
              </p>
            )}
            {status !== 'running' &&
              (task.error ||
                (task.summary &&
                  task.summary.toLowerCase() !== TASK_STATUS[status].toLowerCase() &&
                  !own.some(
                    (block) =>
                      block.kind === 'event' &&
                      block.event.kind === 'text' &&
                      block.event.text.trim() === task.summary!.trim(),
                  ))) && (
                <div
                  className={`agent-panel-report [&.error]:[border-color:color-mix(in_srgb,_var(--bad)_40%,_transparent)] [&_p]:m-0 p-[10px_12px] [border:1px_solid_transparent] rounded-(--radius-m) bg-raised${task.error ? ' error text-bad' : ''}`}
                >
                  <span className="agent-panel-label block mb-1 text-muted-foreground text-caption font-semibold tracking-[0.02em] [text-transform:uppercase]">
                    {task.error ? translate('Error') : translate('Report')}
                  </span>
                  <Markdown remarkPlugins={[remarkGfm]}>{task.error ?? task.summary ?? ''}</Markdown>
                </div>
              )}
          </div>
          {task.canMessage && live ? (
            <form
              className="agent-panel-compose [&_textarea]:min-h-[56px] [&_textarea]:max-h-[160px] [&_textarea]:p-[8px_44px_8px_12px] [&_textarea]:[border:1px_solid_transparent] [&_textarea]:rounded-(--radius-m) [&_textarea]:[background:var(--field)] [&_textarea]:resize-none [&_textarea]:text-control relative flex-none m-[0_10px_10px] min-w-0"
              onSubmit={(event) => {
                event.preventDefault()
                void send()
              }}
            >
              <Textarea
                aria-label={translate('Message {0}', { '0': task.name })}
                placeholder={translate('Message {0}…', { '0': task.name })}
                value={draft}
                rows={2}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault()
                    void send()
                  }
                }}
              />
              <Button
                variant="secondary"
                size="icon-sm"
                type="submit"
                className="bg-fill hover:bg-fill-hover icon p-0 size-(--action-size) flex-none justify-center agent-panel-send [&:hover:not(:disabled)]:[background:var(--soft)] [&:hover:not(:disabled)]:[border:0] absolute right-2 bottom-2 w-7 h-7 rounded-full [background:var(--text)] [color:var(--canvas)] [border:0]"
                aria-label={translate('Send to agent')}
                title={translate('Send through the main agent')}
                disabled={!draft.trim() || sending}
              >
                <Send size={14} />
              </Button>
            </form>
          ) : (
            <p className="agent-panel-hint flex-none m-0 p-[10px_14px_14px] min-w-0 muted text-muted-foreground small text-caption">
              {task.taskType === 'advisor'
                ? translate("The advisor answers the chat's agent and does not take messages.")
                : task.recovered
                  ? translate('This helper’s previous process ended. Continue through the main chat.')
                  : task.canMessage
                    ? translate('Resume the chat to message this agent.')
                    : translate('Background commands do not take messages.')}
            </p>
          )}
        </>
      )}
    </aside>
  )
}

/** Selected chat text gets a split button: Quote into the message box, or Ask aside without touching the chat. */
function SelectionActions({
  scroller,
  onQuote,
  onQuoteNew,
  onAside,
}: {
  scroller: React.RefObject<HTMLDivElement | null>
  onQuote: (text: string) => void
  onQuoteNew: (text: string) => void
  onAside: (text: string, from: 'assistant' | 'user') => void
}) {
  useLanguage()
  const [pick, setPick] = useState<{ text: string; from: 'assistant' | 'user'; top: number; left: number } | null>(null)
  useEffect(() => {
    let pressing = false
    const read = () => {
      const selection = document.getSelection(),
        el = scroller.current
      if (!selection || selection.isCollapsed || !selection.rangeCount || !el?.checkVisibility()) return setPick(null)
      const range = selection.getRangeAt(0)
      if (!el.contains(range.commonAncestorContainer)) return setPick(null)
      const text = selection.toString().trim()
      const start = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement
      if (!text || !start?.closest('.msg')) return setPick(null)
      const rect = range.getBoundingClientRect(),
        frame = el.getBoundingClientRect()
      // Above the selection, or below it when there is no room under the header.
      const top = rect.top - 40 < frame.top ? rect.bottom + 8 : rect.top - 40
      const left = Math.min(Math.max(rect.left + rect.width / 2, frame.left + 110), frame.right - 110)
      setPick({ text: text.slice(0, 20_000), from: start.closest('.msg.user') ? 'user' : 'assistant', top, left })
    }
    const change = () => {
      if (!pressing) read()
    }
    const down = (event: MouseEvent) => {
      if (!(event.target as Element).closest?.('.selection-actions')) {
        pressing = true
        setPick(null)
      }
    }
    const up = () => {
      if (pressing) {
        pressing = false
        requestAnimationFrame(read)
      }
    }
    const hide = () => setPick(null)
    const el = scroller.current
    document.addEventListener('selectionchange', change)
    document.addEventListener('mousedown', down)
    document.addEventListener('mouseup', up)
    el?.addEventListener('scroll', hide)
    window.addEventListener('resize', hide)
    return () => {
      document.removeEventListener('selectionchange', change)
      document.removeEventListener('mousedown', down)
      document.removeEventListener('mouseup', up)
      el?.removeEventListener('scroll', hide)
      window.removeEventListener('resize', hide)
    }
  }, [scroller])
  const quote = () => {
    if (pick) {
      onQuote(pick.text)
      document.getSelection()?.removeAllRanges()
      setPick(null)
    }
  }
  const quoteNew = () => {
    if (pick) {
      onQuoteNew(pick.text)
      document.getSelection()?.removeAllRanges()
      setPick(null)
    }
  }
  const aside = () => {
    if (pick) {
      onAside(pick.text, pick.from)
      document.getSelection()?.removeAllRanges()
      setPick(null)
    }
  }
  useEffect(() => {
    if (!pick) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPick(null)
        return
      }
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey) return
      if (event.code === 'KeyQ') {
        event.preventDefault()
        event.stopPropagation()
        quote()
      }
      if (event.code === 'KeyA') {
        event.preventDefault()
        event.stopPropagation()
        aside()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [pick])
  if (!pick) return null
  // Pressing a half must not clear the selection it acts on.
  return createPortal(
    <div
      className="selection-actions fixed z-1150 [translate:-50%_0] inline-flex items-center h-[30px] p-[0_2px] [border:1px_solid_var(--edge)] rounded-full [background:color-mix(in_srgb,_var(--raised-2)_92%,_transparent)] [-webkit-backdrop-filter:blur(16px)] [backdrop-filter:blur(16px)] [box-shadow:0_8px_24px_rgba(0,_0,_0,_0.4)] [animation:pop_0.1s_var(--ease)]"
      role="toolbar"
      aria-label={translate('Selected text')}
      style={{ top: pick.top, left: pick.left }}
      onMouseDown={(event) => event.preventDefault()}
    >
      <Button
        variant="secondary"
        type="button"
        className="bg-fill hover:bg-fill-hover selection-action [&:hover:not(:disabled)]:bg-hover [&:hover:not(:disabled)]:[border:0] [&_svg]:text-soft h-[26px] min-h-[26px] gap-1.5 p-[0_10px] [border:0] rounded-full bg-transparent text-foreground text-control whitespace-nowrap"
        title={translate('Quote in your message ({0})', { '0': formatKeys('mod+shift+q') })}
        onClick={quote}
      >
        <Quote size={13} />
        {translate('Quote')}
      </Button>
      <Button
        variant="secondary"
        type="button"
        className="bg-fill hover:bg-fill-hover selection-action [&:hover:not(:disabled)]:bg-hover [&:hover:not(:disabled)]:[border:0] [&_svg]:text-soft h-[26px] min-h-[26px] gap-1.5 p-[0_10px] [border:0] rounded-full bg-transparent text-foreground text-control whitespace-nowrap"
        title={translate('Start a new chat with this quoted')}
        onClick={quoteNew}
      >
        <SquarePen size={13} />
        {translate('Quote in new chat')}
      </Button>
      <span className="selection-divider w-px h-4 [background:var(--line-strong)] flex-none" aria-hidden="true" />
      <Button
        variant="secondary"
        type="button"
        className="bg-fill hover:bg-fill-hover selection-action [&:hover:not(:disabled)]:bg-hover [&:hover:not(:disabled)]:[border:0] [&_svg]:text-soft h-[26px] min-h-[26px] gap-1.5 p-[0_10px] [border:0] rounded-full bg-transparent text-foreground text-control whitespace-nowrap"
        title={translate('Ask a side question about this, without interrupting the chat ({0})', {
          '0': formatKeys('mod+shift+a'),
        })}
        onClick={aside}
      >
        <MessageCircle size={13} />
        {translate('Ask aside')}
      </Button>
    </div>,
    document.body,
  )
}

/** Side questions about the chat. Answers come from the chat's model, read-only, and never join the conversation. */
/** An open aside: an existing one, or a new one carrying its quote. keepFocus leaves the caret in the chat's composer. */
type AsideTarget = { id: string | null; quote: string; from: 'assistant' | 'user'; keepFocus?: boolean }
function AsidePanel({
  sessionId,
  asides,
  open,
  taskId,
  onOpen,
  onClose,
  onQuote,
}: {
  sessionId: string
  asides: Aside[]
  open: AsideTarget | '*'
  taskId?: string
  onOpen: (value: AsideTarget | '*' | null) => void
  onClose: () => void
  onQuote: (text: string) => void
}) {
  useLanguage()
  const aside = open === '*' ? undefined : open.id ? asides.find((entry) => entry.id === open.id) : undefined
  const quote = aside?.quote ?? (open === '*' ? '' : open.quote)
  const from = aside?.quoteFrom ?? (open === '*' ? 'assistant' : open.from)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null),
    body = useRef<HTMLDivElement>(null)
  const openKey = open === '*' ? '*' : (open.id ?? `new:${open.quote}`)
  useEffect(() => {
    setDraft('')
    setError(null)
    if (open === '*' || !open.keepFocus) requestAnimationFrame(() => input.current?.focus())
  }, [openKey])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  useEffect(() => {
    const el = body.current
    if (el) el.scrollTop = el.scrollHeight
  }, [aside?.messages.length])
  const waiting = aside?.messages.at(-1)?.role === 'user'
  const send = async () => {
    const question = draft.trim()
    if (!question || sending || waiting) return
    setSending(true)
    setError(null)
    try {
      const next = await invoke('aside.ask', sessionId, aside?.id ?? null, quote, from, question)
      setDraft('')
      if (!aside) onOpen({ id: next.id, quote: next.quote, from: next.quoteFrom })
    } catch (e) {
      setError(errorText(e))
    } finally {
      setSending(false)
    }
  }
  const remove = (id: string) =>
    void invoke('aside.delete', sessionId, id).then(
      () => {
        if (aside?.id === id) onOpen(asides.length > 1 ? '*' : null)
      },
      (e) => setError(errorText(e)),
    )
  const firstLine = (text: string) =>
    text
      .split('\n')
      .find((line) => line.trim())
      ?.trim() ?? ''
  return (
    <aside
      className="agent-panel absolute inset-[0_0_0_auto] z-6 w-[min(440px,_100%)] flex flex-col bg-canvas [box-shadow:-16px_0_32px_rgba(0,_0,_0,_0.28)] [animation:fade_0.12s_var(--ease)] [box-sizing:border-box] min-w-0 max-w-full overflow-hidden [border-left:var(--pane-border-width)_solid_var(--pane-border-color)] aside-panel"
      aria-label={translate('Aside')}
    >
      <header className="agent-panel-header [&_>_.small-icon]:flex-none flex items-center gap-1.5 min-h-10 p-[4px_8px_4px_12px] flex-none pr-2 [border-bottom:0]">
        {open !== '*' && asides.length > 1 && (
          <Button
            variant="ghost"
            size="icon-xs"
            className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)"
            aria-label={translate('All asides')}
            title={translate('All asides')}
            onClick={() => onOpen('*')}
          >
            <ArrowLeft size={14} />
          </Button>
        )}
        <MessageCircle size={14} />
        <span className="agent-panel-title [.aside-panel_&]:flex-none min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-semibold">
          {open === '*' ? translate('Asides') : translate('Aside')}
        </span>
        {open !== '*' && quote && (
          <span
            className="aside-title-quote min-w-0 flex-initial overflow-hidden text-ellipsis whitespace-nowrap text-caption muted text-muted-foreground"
            title={quote}
          >
            {firstLine(quote)}
          </span>
        )}
        <span className="grow flex-1 min-w-0 text-left" />
        {aside && (
          <Button
            variant="ghost"
            size="icon-xs"
            className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)"
            aria-label={translate('New aside')}
            title={translate('New aside')}
            onClick={() => onOpen({ id: null, quote: '', from: 'assistant' })}
          >
            <Plus size={14} />
          </Button>
        )}
        {aside && (
          <Button
            variant="ghost"
            size="icon-xs"
            className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)"
            aria-label={translate('Delete aside')}
            title={translate('Delete aside')}
            onClick={() => remove(aside.id)}
          >
            <Trash2 size={13} />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-xs"
          className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)"
          aria-label={translate('Close aside')}
          title={translate('Close (Esc)')}
          onClick={onClose}
        >
          <X size={14} />
        </Button>
      </header>
      {open === '*' ? (
        <div className="agent-panel-body [&_.msg-wrap.user]:self-end [&_.msg-wrap.user]:max-w-[90%] [&_.msg-wrap.user_.msg.user]:mt-0 [&_>_*]:min-w-0 [&_>_*]:max-w-full [&_>_*]:flex-none [&_>_*]:[overflow-wrap:anywhere] flex-1 min-h-0 overflow-auto flex flex-col gap-2.5 p-[10px_14px_16px] agent-panel-list gap-2 pt-3">
          <Button
            variant="secondary"
            type="button"
            className="bg-fill hover:bg-fill-hover aside-row [&:hover:not(:disabled)]:bg-hover [&:hover:not(:disabled)]:[border-color:var(--line)] flex flex-col items-start justify-start gap-0.5 h-auto p-[8px_10px] [border:1px_solid_transparent] rounded-(--radius-m) bg-raised text-left whitespace-normal aside-new"
            onClick={() => onOpen({ id: null, quote: '', from: 'assistant' })}
          >
            <span className="aside-row-quote [.aside-new_&]:flex [.aside-new_&]:items-center [.aside-new_&]:gap-1.5 font-semibold overflow-hidden text-ellipsis whitespace-nowrap max-w-full">
              <Plus size={13} />
              {translate('New aside')}
            </span>
            <span className="muted text-muted-foreground small text-caption">
              {translate('Ask about the whole chat without interrupting it.')}
            </span>
          </Button>
          {asides.map((entry) => (
            <Button
              variant="secondary"
              key={entry.id}
              type="button"
              className="bg-fill hover:bg-fill-hover aside-row [&:hover:not(:disabled)]:bg-hover [&:hover:not(:disabled)]:[border-color:var(--line)] flex flex-col items-start justify-start gap-0.5 h-auto p-[8px_10px] [border:1px_solid_transparent] rounded-(--radius-m) bg-raised text-left whitespace-normal"
              onClick={() => onOpen({ id: entry.id, quote: entry.quote, from: entry.quoteFrom })}
            >
              <span className="aside-row-quote [.aside-new_&]:flex [.aside-new_&]:items-center [.aside-new_&]:gap-1.5 font-semibold overflow-hidden text-ellipsis whitespace-nowrap max-w-full">
                {firstLine(entry.quote) || translate('Whole chat')}
              </span>
              <span className="muted text-muted-foreground small text-caption">
                {firstLine(entry.messages[0]?.text ?? '')}
              </span>
            </Button>
          ))}
        </div>
      ) : (
        <>
          <div
            ref={body}
            className="agent-panel-body [&_.msg-wrap.user]:self-end [&_.msg-wrap.user]:max-w-[90%] [&_.msg-wrap.user_.msg.user]:mt-0 [&_>_*]:min-w-0 [&_>_*]:max-w-full [&_>_*]:flex-none [&_>_*]:[overflow-wrap:anywhere] flex-1 min-h-0 overflow-auto flex flex-col gap-2.5 p-[10px_14px_16px]"
          >
            {quote && (
              <blockquote className="aside-quote m-0 p-[8px_12px] [border-left:2px_solid_var(--line-strong)] text-soft text-control leading-[1.5] whitespace-pre-wrap [overflow-wrap:anywhere] max-h-[160px] overflow-auto">
                <span className="agent-panel-label block mb-1 text-muted-foreground text-caption font-semibold tracking-[0.02em] [text-transform:uppercase]">
                  {from === 'user' ? translate('You wrote') : translate('From the chat')}
                </span>
                {quote}
              </blockquote>
            )}
            {aside?.messages.map((message) =>
              message.role === 'user' ? (
                <div key={message.id} className="msg-wrap user">
                  <div className="msg [&.user]:self-end [&.user]:whitespace-pre-wrap [&.user]:max-w-[78%] [&.user]:mt-[18px] [&.user]:w-[fit-content] [&.user]:[background:var(--bubble)] [&.user]:[border:0] [&.user]:[box-shadow:none] [&.user]:text-chat [&.user]:leading-[1.55] [&.user]:p-[10px_16px_11px] [&.user]:rounded-(--radius-l) [&.user]:tracking-[-0.006em] [&.user]:[color:var(--text-body)] [&.assistant]:relative [&.assistant]:tracking-[-0.008em] [&.assistant]:text-chat [&.assistant]:leading-[1.65] [&.assistant]:[color:var(--text-body)] [&.assistant_>_:first-child]:mt-0 [&.assistant_>_:last-child]:mb-0 [&.assistant_p]:m-[0_0_10px] [&.assistant_ul]:pl-5 [&.assistant_ul]:m-[0_0_10px] [&.assistant_ol]:pl-5 [&.assistant_ol]:m-[0_0_10px] [&.assistant_code]:[background:rgba(255,_255,_255,_0.075)] [&.assistant_code]:[border:0] [&.assistant_code]:rounded-(--radius-xs) [&.assistant_code]:p-[0_5px] [&.assistant_code]:[color:var(--text-body)] [&.assistant_code]:text-[length:0.88em] [&.assistant_pre]:overflow-x-auto [&.assistant_pre]:[white-space:pre] [&.assistant_pre]:[background:var(--code-bg)] [&.assistant_pre]:[border:1px_solid_transparent] [&.assistant_pre]:rounded-(--radius-m) [&.assistant_pre]:p-[12px_14px] [&.assistant_pre]:m-[4px_0_12px] [&.assistant_pre]:leading-[1.6] [&.assistant_pre]:[box-shadow:inset_0_1px_0_rgba(255,_255,_255,_0.02)] [&.assistant_pre]:text-[length:0.88em] [&.assistant_pre_code]:bg-transparent [&.assistant_pre_code]:p-0 [&.assistant_pre_code]:[border:none] [&.assistant_pre_code]:text-[length:inherit] [&.assistant_pre_code]:[color:#dcdce2] [&.assistant_a]:text-brand [&.assistant_a]:[text-decoration:none] [&.assistant_table]:[border-collapse:collapse] [&.assistant_table]:m-[6px_0] [&.assistant_th]:[border:1px_solid_var(--line-strong)] [&.assistant_th]:p-[3px_8px] [&.assistant_td]:[border:1px_solid_var(--line-strong)] [&.assistant_td]:p-[3px_8px] [&.meta]:text-caption [&.meta]:text-muted-foreground [&.error]:text-bad [&.assistant:hover_.msg-actions]:opacity-100 [&.assistant.generating]:[animation:arrive_100ms_var(--ease)] [&.user_.muted.small.block]:mt-0.5 [&.user_.muted.small.block]:[color:rgba(255,_255,_255,_0.7)] [&.assistant_li]:m-[3px_0] [&.assistant_li::marker]:text-muted-foreground [&.assistant_strong]:font-semibold [&.assistant_strong]:[color:#fff] [&.assistant_h1]:text-[length:1em] [&.assistant_h1]:font-semibold [&.assistant_h1]:m-[16px_0_6px] [&.assistant_h1]:tracking-[-0.012em] [&.assistant_h2]:text-[length:1em] [&.assistant_h2]:font-semibold [&.assistant_h2]:m-[16px_0_6px] [&.assistant_h2]:tracking-[-0.012em] [&.assistant_h3]:text-[length:1em] [&.assistant_h3]:font-semibold [&.assistant_h3]:m-[16px_0_6px] [&.assistant_h3]:tracking-[-0.012em] [&.assistant_a:hover]:[text-decoration:underline] [.msg-wrap.user_&.user]:max-w-full [.msg-wrap.user_&.user]:mt-3.5 [&.assistant_.msg-actions]:mt-2 [&.assistant_:is(h1,_h2,_h3,_h4,_strong)]:text-foreground break-words user">
                    {message.text}
                  </div>
                </div>
              ) : (
                <div
                  key={message.id}
                  className={`aside-answer flex flex-col gap-0.5${message.error ? ' error text-bad' : ''}`}
                >
                  {message.error ? (
                    <p className="error text-bad small text-caption">{message.text}</p>
                  ) : (
                    <AssistantText
                      event={{ kind: 'text', text: message.text, at: message.at }}
                      generating={false}
                      actions={false}
                      taskId={taskId}
                    />
                  )}
                  {!message.error && (
                    <div className="aside-answer-actions [&_.ghost.small]:text-muted-foreground [&_.ghost.small]:gap-[5px] flex items-center gap-0.5 ml-[-8px]">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover small text-caption"
                        onClick={() => onQuote(message.text)}
                      >
                        <Quote size={12} />
                        {translate('Quote in message')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover small text-caption"
                        onClick={() =>
                          onQuote(
                            `${aside.messages[aside.messages.indexOf(message) - 1]?.text ?? ''}\n\n${message.text}`,
                          )
                        }
                      >
                        {translate('Add Q&A to message')}
                      </Button>
                      <CopyButton text={message.text} />
                    </div>
                  )}
                </div>
              ),
            )}
            {waiting && (
              <div
                className="working [&_.shimmer]:text-chat [&_.shimmer]:leading-[inherit] text-chat leading-[inherit] p-[4px_0] min-h-6 flex items-center"
                role="status"
              >
                <WorkingText>{translate('Thinking aside')}</WorkingText>
              </div>
            )}
            {!aside && (
              <p className="muted text-muted-foreground small text-caption">
                {translate('Ask without interrupting the chat. Replies stay in this aside.')}
              </p>
            )}
          </div>
          {error && <p className="error text-bad small text-caption aside-error m-[0_14px_6px]">{error}</p>}
          <form
            className="agent-panel-compose [&_textarea]:min-h-[56px] [&_textarea]:max-h-[160px] [&_textarea]:p-[10px_48px_10px_14px] [&_textarea]:border [&_textarea]:border-line [&_textarea]:rounded-(--radius-l) [&_textarea]:bg-fill [&_textarea]:resize-none [&_textarea]:text-control [&_textarea]:leading-[1.5] [&_textarea]:shadow-none [&_textarea]:ring-0 [&_textarea]:[transition:border-color_140ms_ease] [&_textarea:focus-visible]:border-line-strong [&_textarea:focus-visible]:ring-0 relative flex-none m-[0_10px_10px] min-w-0"
            onSubmit={(event) => {
              event.preventDefault()
              void send()
            }}
          >
            <Textarea
              ref={input}
              aria-label={translate('Ask aside')}
              placeholder={aside ? translate('Follow up…') : translate('Ask about this…')}
              value={draft}
              rows={2}
              maxLength={20000}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  void send()
                }
              }}
            />
            <Button
              variant="secondary"
              size="icon-sm"
              type="submit"
              className="icon p-0 size-(--action-size) flex-none justify-center agent-panel-send [&:hover:not(:disabled)]:[border:0] absolute right-2 bottom-2 w-7 h-7 rounded-full bg-primary text-primary-foreground [border:0] [transition:background-color_140ms_ease,opacity_140ms_ease] hover:bg-primary-hover disabled:bg-raised disabled:text-muted-foreground disabled:opacity-100"
              aria-label={translate('Ask')}
              title={translate('Ask aside')}
              disabled={!draft.trim() || sending || waiting}
            >
              <Send size={14} />
            </Button>
          </form>
        </>
      )}
    </aside>
  )
}

/** Reasoning the provider shared; folded into the turn's work and open on demand. */
function ThinkingRow({ text, active = false }: { text: string; active?: boolean }) {
  useLanguage()
  return (
    <Collapsible
      defaultOpen={active}
      className="thinking tool-group [&_>_[data-slot='collapsible-trigger']]:cursor-pointer [&_>_[data-slot='collapsible-trigger']]:[list-style:none] [&_>_[data-slot='collapsible-trigger']]:font-normal [&_>_[data-slot='collapsible-trigger']]:[transition:background_0.12s_var(--ease),_border-color_0.12s_var(--ease)] [&_>_[data-slot='collapsible-trigger']]:flex [&_>_[data-slot='collapsible-trigger']]:items-center [&_>_[data-slot='collapsible-trigger']]:justify-start [&_>_[data-slot='collapsible-trigger']]:gap-2 [&_>_[data-slot='collapsible-trigger']]:h-auto [&_>_[data-slot='collapsible-trigger']]:min-h-0 [&_>_[data-slot='collapsible-trigger']]:p-[3px_0] [&_>_[data-slot='collapsible-trigger']]:[border:0] [&_>_[data-slot='collapsible-trigger']]:[border-radius:0] [&_>_[data-slot='collapsible-trigger']]:bg-transparent [&_>_[data-slot='collapsible-trigger']]:text-muted-foreground [&_>_[data-slot='collapsible-trigger']]:text-chat [&_>_[data-slot='collapsible-trigger']::-webkit-details-marker]:hidden [&_>_[data-slot='collapsible-trigger']:hover]:bg-transparent [&_>_[data-slot='collapsible-trigger']:hover]:[border:0] [&_>_[data-slot='collapsible-trigger']:hover]:text-soft [&[data-open]_>_summary_.caret]:[transform:rotate(90deg)] [&[data-open]_>_summary]:bg-transparent [&[data-open]_>_summary]:[border:0] [&[data-open]_>_summary]:text-soft [&_>_[data-slot='collapsible-trigger']_.caret]:m-0 [&_>_[data-slot='collapsible-trigger']_.caret]:opacity-0 [&_>_[data-slot='collapsible-trigger']_.caret]:[transition:opacity_0.15s_var(--ease),_transform_0.15s_var(--ease)] text-control text-muted-foreground"
    >
      <CollapsibleTrigger render={<Button variant="ghost" />}>
        <Brain
          size={14}
          className="tool-icon [&.running]:text-brand [&.running]:[animation:pulse_1.6s_ease-in-out_infinite] flex-none text-muted-foreground"
        />
        <span className="tool-summary overflow-hidden text-ellipsis whitespace-nowrap min-w-0 font-sans text-chat text-inherit flex-initial">
          {translate(active ? 'Thinking' : 'Thought')}
        </span>
        <ChevronRight
          size={12}
          className="caret [&.open]:[transform:rotate(90deg)] [:is(.tool-group,_.tool)_>_[data-slot='collapsible-trigger']:is(:hover,_:focus-visible)_&]:opacity-100 [:is(.tool-group,_.tool)[data-open]_>_[data-slot='collapsible-trigger']_>_&]:[transform:rotate(90deg)] text-muted-foreground flex-none [transition:transform_0.15s_var(--ease)]"
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="tool-disclosure-panel [&[data-starting-style]]:h-0 [&[data-ending-style]]:h-0 h-[var(--collapsible-panel-height)] overflow-hidden [transition:none]">
        <div className="thinking-body m-[2px_0_4px_20px] pl-2.5 [border-left:2px_solid_var(--line-strong)] text-muted-foreground text-control leading-[1.55] whitespace-pre-wrap [overflow-wrap:anywhere] max-h-[260px] overflow-auto">
          {text}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

/** Edits a sent message inside its bubble. Enter sends, Shift+Enter adds a line, Esc cancels. */
/** `offlineHost` names the unreachable computer: the revision goes to the outbox and file restore is unavailable until it is back. */
function InlineMessageEdit({
  original,
  files,
  sessionId,
  seq,
  busy,
  offlineHost,
  onCancel,
  onSubmit,
}: {
  original: string
  files: Attachment[]
  sessionId: string
  seq: number
  busy: boolean
  offlineHost?: string
  onCancel: () => void
  onSubmit: (text: string, restored: boolean) => void
}) {
  useLanguage()
  const [text, setText] = useState(original)
  const [restored, setRestored] = useState(false)
  // Sending an unchanged message only reruns it, so the first press asks.
  const [confirmSame, setConfirmSame] = useState(false)
  const empty = !text.trim() && !files.length
  const submit = () => {
    if (busy || empty) return
    if (text.trim() === original.trim() && !restored && !confirmSame) {
      setConfirmSame(true)
      return
    }
    onSubmit(text, restored)
  }
  return (
    <div
      className="inline-edit self-end mt-[18px] flex w-[min(640px,_100%)] flex-col gap-2 rounded-(--radius-l) [background:var(--bubble)] p-[8px_10px_10px] [box-shadow:0_0_0_1.5px_var(--accent)]"
      role="region"
      aria-label={translate('Editing message')}
    >
      <Textarea
        autoFocus
        value={text}
        aria-label={translate('Edit your message')}
        disabled={busy}
        className="min-h-[44px] max-h-[40vh] resize-none overflow-y-auto border-0 bg-transparent! p-[4px_6px] text-chat leading-[1.55] shadow-none focus-visible:border-0 focus-visible:ring-0"
        onFocus={(event) => {
          const end = event.currentTarget.value.length
          event.currentTarget.setSelectionRange(end, end)
        }}
        onChange={(event) => {
          setText(event.target.value)
          setConfirmSame(false)
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            onCancel()
          } else if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            submit()
          }
        }}
      />
      {confirmSame && (
        <p className="m-0 px-1.5 text-caption text-warn" role="status">
          {translate('Nothing changed. Send it again anyway?')}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <span className="mr-auto min-w-0 px-1.5 text-caption text-muted-foreground">
          {restored
            ? translate('Selected files restored.')
            : offlineHost
              ? translate('Replaces this request. Sends when {0} is back; restoring files needs it online.', {
                  0: offlineHost,
                })
              : translate('Replaces this request. Files stay as they are unless you restore them.')}
        </span>
        {!restored && !offlineHost && (
          <UndoRun sessionId={sessionId} userSeq={seq} onRestored={() => setRestored(true)} />
        )}
        <Button
          variant="ghost"
          size="sm"
          className="text-caption"
          disabled={busy}
          title={translate('Esc')}
          onClick={onCancel}
        >
          {translate('Cancel')}
        </Button>
        <Button
          variant="default"
          size="sm"
          className="text-caption font-semibold"
          disabled={busy || empty}
          title={translate('Enter')}
          onClick={submit}
        >
          {confirmSame ? translate('Send anyway') : offlineHost ? translate('Queue') : translate('Send')}
        </Button>
      </div>
    </div>
  )
}
