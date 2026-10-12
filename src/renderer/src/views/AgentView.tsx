import { t as translate, useLanguage, currentLanguage, formatLocale } from './../i18n'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { compactionLabel, isCompacting, isTurnFooter } from '../../../shared/compaction'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { FileContext } from '../../../shared/types'
import { ArrowDown, ArrowLeft, Bot, Brain, Circle, ListChecks, MessageCircle, Quote, BookOpen, CircleCheck, CircleSlash, CircleX, LoaderCircle, Search, Send, Square, X, Check, CornerDownRight, GitFork, ListEnd, MoreHorizontal, Pencil, Trash2, ChevronDown, ChevronRight, CircleAlert, Minimize2, Copy, ShieldQuestion, SquareTerminal, Lightbulb } from 'lucide-react'
import { Children, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Markdown, { defaultUrlTransform, type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Attachment, QueuedMessage, AgentEvent, AgentSettings, AgentSessionInfo, AgentSessionState, ViewDescriptor } from '../../../shared/types'
import { toolIsRunning, toolVerb } from '../../../shared/toolStatus'
import { GoalBar } from '../GoalBar'
import { accessName, AgentControls, providerName } from '../AgentControls'
import { useAppSettings } from '../AppSettings'
import { reviewsByTurn } from '../../../shared/reviewGroups'
import { useReviews } from '../reviews'
import { FILE_DRAG_TYPE } from '../ComposerSuggestions'
import { ChatFind } from '../ChatFind'
import { formatKeys } from '../commands'
import { advisorAgentId, effectiveStatus, latestTasks, parseAdvice, parseTaskMessage, parseTaskReport, parseTaskStop } from '../../../shared/agentTasks'
import type { AgentTask, Aside, TodoItem } from '../../../shared/types'
import { createPortal } from 'react-dom'
import { ProviderRouteChip } from '../ProviderRoute'
import { ContextMeter } from '../Usage'
import { ProviderIcon } from '../ProviderIcon'
import { modelDisplayName } from '../ModelSets'
import { Textarea } from '@/components/ui/textarea'
import { slide } from '../slide'
import { CommentsChip, pendingComments, sentComments } from '../ReviewChip'
import { SessionChangesButton, TurnChanges } from '../Changes'
import { ScheduleChatCard } from '../Automation'
import { Attachments } from '../Attachments'
import { UndoRun } from '../UndoRun'
import { Composer } from '../Composer'
import { invoke, ramu, copyText } from '../ipc'
import { errorText } from '../TaskPane'
import { Menu } from '../Menu'
import { useWorkspace } from '../workspace'
import { formatChatDate, needsChatDate } from '../../../shared/chatDates'
import { ElicitationCard } from '../ElicitationCard'
import { QuestionDock, QuestionRow } from '../QuestionCard'
import { parseAnswerMessage, questionState, type QuestionState } from '../../../shared/questions'
import { localFileLink } from '../../../shared/fileLinks'
import { notifyError } from '../Notifications'

type AgentViewDesc = Extract<ViewDescriptor, { kind: 'agent' }>
type ToolUse = Extract<AgentEvent, { kind: 'tool-use' }>
type ToolResult = Extract<AgentEvent, { kind: 'tool-result' }>

const STATE_LABEL: Partial<Record<AgentSessionState, string>> = {
  'needs-input': 'Needs your input',
  failed: 'Failed',
}

const LIVE: AgentSessionState[] = ['starting', 'running', 'needs-input', 'idle']
const NEAR_BOTTOM_PX = 80

type Block = { kind: 'event'; event: AgentEvent } | { kind: 'tools'; tools: ToolUse[] }

/** Consecutive tool calls collapse into one line, like "Ran 2 commands". */
function toBlocks(events: AgentEvent[]): Block[] {
  const blocks: Block[] = []
  for (const event of events) {
    // A sub-agent's own output lives in its panel; its card stands for it here.
    if (event.agentId && event.kind !== 'agent') continue
    if (event.kind === 'compaction' && event.state === 'started') continue
    // The advisor's card stands for its tool calls.
    if (event.kind === 'tool-use' && isAdvisorTool(event)) continue
    if (event.kind === 'goal' || event.kind === 'todos' || event.kind === 'queue' || event.kind === 'tool-result' || event.kind === 'state' || event.kind === 'request-resolved' || event.kind === 'question-state') continue
    const last = blocks.at(-1)
    if (event.kind === 'tool-use') {
      if (last?.kind === 'tools') last.tools.push(event)
      else blocks.push({ kind: 'tools', tools: [event] })
    } else blocks.push({ kind: 'event', event })
  }
  return blocks
}

type Turn = { key: number; user: Block | null; items: Block[]; ended: boolean; startedAt?: number; endedAt?: number }

const blockAt = (block: Block): number | undefined => block.kind === 'event' ? block.event.at : block.tools[0]?.at

/** One user message and everything the agent did in answer to it. */
function toTurns(blocks: Block[]): Turn[] {
  const turns: Turn[] = []
  blocks.forEach((block, index) => {
    if (block.kind === 'event' && block.event.kind === 'user') { turns.push({ key: index, user: block, items: [], ended: false, startedAt: block.event.at }); return }
    let turn = turns.at(-1)
    if (!turn) { turn = { key: -1, user: null, items: [], ended: false }; turns.push(turn) }
    turn.items.push(block)
    if (block.kind === 'event' && block.event.kind === 'result') { turn.ended = true; turn.endedAt = block.event.at }
  })
  return turns
}

/** Splits a finished turn into the work that folds away and the answer that stays. */
function foldTurn(items: Block[], outcomes: Map<string, string>): { folded: Block[]; kept: Block[]; answer: Block[] } {
  let end = items.length
  while (end > 0 && items[end - 1]!.kind === 'event' && isTurnFooter((items[end - 1] as { event: AgentEvent }).event)) end--
  let start = end
  while (start > 0 && items[start - 1]!.kind === 'event' && (items[start - 1] as { event: AgentEvent }).event.kind === 'text') start--
  const folded: Block[] = [], kept: Block[] = []
  for (const block of items.slice(0, start)) {
    const foldable = block.kind === 'tools' || block.event.kind === 'text' || block.event.kind === 'thinking' || (block.event.kind === 'permission-request' || block.event.kind === 'elicitation' || block.event.kind === 'question' && !['dismissed', 'obsolete'].includes(outcomes.get(block.event.requestId) ?? '')) && outcomes.has(block.event.requestId)
    ;(foldable ? folded : kept).push(block)
  }
  return { folded, kept, answer: items.slice(start) }
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
const isAdvisorTool = (e: { name: string; summary: string }) => /^mcp__ramu__(advisor|wait_for_advice)$/.test(e.name) || (e.name === 'advisor' || e.name === 'wait_for_advice') && e.summary === 'ramu'

/** MCP tools arrive as mcp__server__tool; show the tool name. */
const toolLabel = (name: string) => name.startsWith('mcp__') ? name.split('__').slice(2).join('__') || name : name

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
  const counts = new Map<string, number>()
  for (const t of tools) counts.set(t.name, (counts.get(t.name) ?? 0) + 1)
  const parts = [...counts].map(([name, n]) => {
    const v = VERBS[name]
    if (!v) return translate('Used {name}{count}', { name: toolLabel(name), count: n > 1 ? ` ×${n}` : '' })
    const running = tools.some(tool => tool.name === name && toolIsRunning(results.get(tool.toolUseId), active))
    const verb = translate(toolVerb(v[0], running))
    return v[1] ? translate('{verb} {count} {unit}', { verb, count: n, unit: translate(n === 1 ? v[1] : v[2]) }) : verb
  })
  return parts.join(', ')
}

export function AgentView({ view, history }: { view: AgentViewDesc; history?: React.ReactNode }) {
  useLanguage()
  const { preferences } = useAppSettings()
  const { reviews } = useReviews()
  const [eventSequences, setEventSequences] = useState<Map<AgentEvent, number>>(new Map())
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [queuePaused, setQueuePaused] = useState(false)
  const [queued, setQueued] = useState<QueuedMessage[]>([])
  const [session, setSession] = useState<AgentSessionInfo | null>(null)
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [liveText, setLiveText] = useState<AgentEvent | null>(null)
  const [draft, setDraft] = useState('')
  const [editTarget, setEditTarget] = useState<number | null>(null)
  const [editRestored, setEditRestored] = useState(false)
  const [pendingSettings, setPendingSettings] = useState<AgentSettings | null>(null)
  const [configuring, setConfiguring] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const scrollFrame = useRef(0)
  const [dropping, setDropping] = useState(false)
  const [finding, setFinding] = useState(false)
  const [findRequest, setFindRequest] = useState(0)
  // The sub-agent panel: one agent's transcript, or '*' for the list of all of them.
  const [openAgent, setOpenAgentState] = useState<string | null>(null)
  // The aside panel: one aside (a new one carries its quote), or '*' for the list.
  const [openAside, setOpenAsideState] = useState<AsideTarget | '*' | null>(null)
  // One side panel at a time.
  const setOpenAgent = (value: string | null | ((current: string | null) => string | null)) => { setOpenAsideState(null); setOpenAgentState(value) }
  const setOpenAside = (value: typeof openAside) => { setOpenAgentState(null); setOpenAsideState(value) }
  const [asides, setAsides] = useState<Aside[]>([])
  useEffect(() => {
    let cancelled = false
    setAsides([])
    void invoke('aside.list', view.sessionId).then((list) => { if (!cancelled) setAsides(list) }, () => {})
    const off = ramu.on('aside:changed', ({ sessionId, aside, asideId }) => {
      if (sessionId !== view.sessionId) return
      setAsides((current) => aside ? [...current.filter((entry) => entry.id !== aside.id), aside].sort((a, b) => a.createdAt - b.createdAt) : current.filter((entry) => entry.id !== asideId))
    })
    return () => { cancelled = true; off() }
  }, [view.sessionId])
  const root = useRef<HTMLDivElement>(null)
  const [findQuery, setFindQuery] = useState<string | undefined>()
  const openFind = (query?: string) => { setFindQuery(query); setFinding(true); setFindRequest((n) => n + 1) }
  const closeFind = () => { setFinding(false); root.current?.querySelector<HTMLTextAreaElement>('.composer textarea')?.focus() }
  // ⌘F (the chat.find command) opens find in whichever chat is on screen; hidden panes keep theirs closed.
  useEffect(() => {
    const onFind = (event: Event) => { if (root.current?.checkVisibility()) openFind((event as CustomEvent<{ query?: string } | null>).detail?.query) }
    window.addEventListener('ramu:find-in-chat', onFind)
    return () => window.removeEventListener('ramu:find-in-chat', onFind)
  }, [])
  // Eases to the bottom over a fixed, short time (the browser's own smooth scroll is slow and uneven over long distances); a wheel or touch stops it.
  const scrollToLatest = () => {
    const el = scroller.current
    if (!el) return
    cancelAnimationFrame(scrollFrame.current)
    const from = el.scrollTop, start = performance.now()
    const duration = Math.min(420, 160 + Math.abs(el.scrollHeight - el.clientHeight - from) / 12)
    const stop = () => { cancelAnimationFrame(scrollFrame.current); el.removeEventListener('wheel', stop); el.removeEventListener('touchstart', stop) }
    el.addEventListener('wheel', stop, { passive: true, once: true }); el.addEventListener('touchstart', stop, { passive: true, once: true })
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration), eased = 1 - Math.pow(1 - t, 3)
      el.scrollTop = from + (el.scrollHeight - el.clientHeight - from) * eased
      if (t < 1) scrollFrame.current = requestAnimationFrame(step)
      else { stick.current = true; el.removeEventListener('wheel', stop); el.removeEventListener('touchstart', stop) }
    }
    scrollFrame.current = requestAnimationFrame(step)
  }
  const [edges, setEdges] = useState({ top: false, bottom: false })
  const measureEdges = () => {
    const el = scroller.current
    if (!el) return
    const top = el.scrollTop > 2, bottom = el.scrollHeight - el.scrollTop - el.clientHeight > 2
    setEdges((current) => current.top === top && current.bottom === bottom ? current : { top, bottom })
  }

  useEffect(() => {
    let cancelled = false, revision = 0, latestState: AgentSessionState | undefined
    const stored = new Map<number, { event: AgentEvent; revision: number }>()
    const refreshEvents = () => { setEventSequences(new Map([...stored].map(([seq, item]) => [item.event, seq]))); const list = [...stored].sort(([a], [b]) => a - b).map(([, item]) => item.event); setEvents(list); const queue = list.findLast((e) => e.kind === 'queue'); if (queue?.kind === 'queue') { setQueued(queue.messages); setQueuePaused(!!queue.paused) } }
    const hydrate = async () => {
      const requestedAt = revision
      const [s, evs] = await Promise.all([invoke('agent.get', view.sessionId), invoke('agent.events', view.sessionId)])
      if (cancelled) return
      evs.forEach((event, index) => { if ((stored.get(index + 1)?.revision ?? -1) <= requestedAt) stored.set(index + 1, { event, revision: requestedAt }) })
      setSession({ ...s, state: latestState ?? s.state }); refreshEvents()
    }
    setEvents([]); setLiveText(null)
    void hydrate().catch((e) => { if (!cancelled) setError(errorText(e)) })
    const reconnect = ramu.on('background:connection', ({ connected }) => { if (connected) void hydrate().catch(() => {}) })
    const off = ramu.on('agent:event', ({ sessionId, event, seq }) => {
      if (sessionId !== view.sessionId) return
      revision++
      if (event.kind === 'state') { latestState = event.state; setSession((s) => s ? { ...s, state: event.state } : s); return }
      if (event.agentId && event.kind !== 'agent') { /* sub-agent output never streams into the main reply */ }
      else if (event.kind === 'text') setLiveText(event)
      else if (event.kind === 'tool-use' || event.kind === 'result') setLiveText(null)
      if (seq !== undefined) stored.set(seq, { event, revision })
      else { const sameMessage = event.kind === 'text' && event.messageId ? [...stored].find(([, i]) => i.event.kind === 'text' && i.event.messageId === event.messageId)?.[0] : undefined; stored.set(sameMessage ?? Math.max(0, ...stored.keys()) + 1, { event, revision }) }
      refreshEvents()
      if (event.kind === 'settings') setSession((s) => s ? { ...s, provider: event.settings.provider, settings: event.settings } : s)
    })
    return () => {
      cancelled = true
      off()
      reconnect()
    }
  }, [view.sessionId])

  // Follow new output only while the reader is already at the bottom.
  useEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
    measureEdges()
  }, [events, session?.state, reviews])

  const outcomes = useMemo(() => new Map(events.flatMap((e) => (e.kind === 'request-resolved' ? [[e.requestId, e.outcome] as const] : []))), [events])
  const questionStates = useMemo(() => new Map(events.flatMap((e) => (e.kind === 'question' || e.kind === 'elicitation') ? [[e.requestId, questionState(events, e.requestId)] as const] : [])), [events])
  const [showQuestions, setShowQuestions] = useState(false)
  // Questions float above the message box; the transcript row opens them.
  const [questionDockOpen, setQuestionDockOpen] = useState(true)
  const [questionFocus, setQuestionFocus] = useState<{ requestId: string; at: number } | null>(null)
  const openQuestion = (requestId: string) => setQuestionFocus({ requestId, at: Date.now() })
  const results = useMemo(() => new Map(events.flatMap((e) => (e.kind === 'tool-result' ? [[e.toolUseId, e] as const] : []))), [events])
  const blocks = useMemo(() => toBlocks(events), [events])
  useEffect(() => {
    if (!view.sourceSeq || !events.length) return
    const source = events[view.sourceSeq - 1]
    const index = blocks.findIndex((b) => b.kind === 'event' ? b.event === source : b.tools.some((t) => t === source || source?.kind === 'tool-result' && t.toolUseId === source.toolUseId))
    const node = scroller.current?.querySelector(`[data-block-index="${index}"]`)
    if (node) { stick.current = false; node.scrollIntoView({ block: 'center' }); node.classList.add('recap-source-highlight'); const timer = setTimeout(() => node.classList.remove('recap-source-highlight'), 4000); return () => clearTimeout(timer) }
  }, [view.sourceSeq, events.length])
  const live = session ? LIVE.includes(session.state) : false
  const pendingQuestions = events.filter((e): e is Extract<AgentEvent, { kind: 'question' | 'elicitation' }> => (e.kind === 'question' || e.kind === 'elicitation') && !outcomes.has(e.requestId) && (e.kind === 'elicitation' ? live : e.responseMode === 'message' || live))
  const dockQuestions = useMemo(() => pendingQuestions.filter((e): e is Extract<AgentEvent, { kind: 'question' }> => e.kind === 'question'), [events, live, outcomes])
  // A new question opens the dock, even after "Answer later".
  const dockKey = dockQuestions.map((e) => e.requestId).join(',')
  const seenQuestions = useRef(new Set<string>())
  useEffect(() => { if (dockQuestions.some((e) => !seenQuestions.current.has(e.requestId))) setQuestionDockOpen(true); dockQuestions.forEach((e) => seenQuestions.current.add(e.requestId)) }, [dockKey])
  const tasks = useMemo(() => latestTasks(events), [events])
  const goalEvent = events.findLast((event) => event.kind === 'goal')
  const goal = goalEvent?.kind === 'goal' ? goalEvent.goal : null
  const todos = useMemo(() => { const last = events.findLast((e) => e.kind === 'todos'); return last?.kind === 'todos' ? last.items : null }, [events])
  const runningTasks = tasks.filter((task) => effectiveStatus(task, live) === 'running')
  const backgroundTool = (toolUseId: string) => void act(() => invoke('agent.backgroundTool', view.sessionId, toolUseId))
  const stopTask = (task: AgentTask) => void act(() => invoke('agent.stopTask', view.sessionId, task.agentId))
  const working = session?.state === 'running' || session?.state === 'starting'
  const compacting = session?.state !== 'stopped' && session?.state !== 'failed' && isCompacting(events)
  const turns = useMemo(() => toTurns(blocks), [blocks])
  const turnReviews = useMemo(() => reviewsByTurn(reviews, view.sessionId, turns.map((turn) => ({
    key: turn.key,
    sequences: [...(turn.user ? [turn.user] : []), ...turn.items].flatMap((block) => (block.kind === 'event' ? [block.event] : block.tools).flatMap((event) => { const seq = eventSequences.get(event); return seq === undefined ? [] : [seq] })),
  }))), [reviews, turns, view.sessionId, eventSequences])
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
  const stopped = interrupted || (!!lastResult && events.lastIndexOf(lastResult) > lastUserIndex && /interrupt|abort/i.test(lastResult.kind === 'result' ? lastResult.text : ''))
  useEffect(() => { if (working) setInterrupted(false) }, [working])
  const ws = useWorkspace()
  const [continuing, setContinuing] = useState(false)
  // A fresh chat in the same checkout that opens with this one's transcript as hidden context.
  const continueInNewChat = async () => {
    const previous = session && ws.task(session.taskId)
    if (!session || !previous) return
    setContinuing(true)
    let created: string | null = null
    try {
      const prompt = await invoke('agent.continuationPrompt', session.id)
      const task = await invoke('tasks.create', { projectId: previous.projectId, title: `Continue: ${previous.title}`.slice(0, 60), mode: previous.mode, workspaceId: previous.workspaceId ?? undefined })
      created = task.id
      const next = await invoke('agent.start', task.id, prompt, pendingSettings ?? session.settings, [], [])
      created = null
      await ws.refresh()
      ws.openTask(task.id)
      ws.openView(task.id, { kind: 'agent', sessionId: next.id })
    } catch (e) {
      if (created) { await invoke('tasks.delete', created, false).catch(() => {}); await ws.refresh().catch(() => {}) }
      setError(errorText(e))
    } finally { setContinuing(false) }
  }
  const supportsSteering = session?.provider === 'claude-code' || session?.provider === 'codex'
  const action = supportsSteering ? preferences.busyMessageAction : 'queue'
  const opposite = action === 'queue' ? 'steer' : 'queue'
  // While the agent is working, a model change takes effect right away and the run continues with the new settings.
  // The model bar hands over one change when the slider is released. While the agent is working it is applied straight away.
  const changeSettings = (next: AgentSettings) => {
    setPendingSettings(next)
    if (!busyAgent) return
    void invoke('agent.configure', view.sessionId, next).then((updated) => { setSession(updated); setPendingSettings((current) => current === next ? null : current) }, (error) => { setPendingSettings(null); notifyError(errorText(error), 'Model') })
  }
  const attached = pendingComments(reviews, view.sessionId)
  // Editing keeps history and offers a provider-independent file restore before resending.
  /** Adds a Markdown quote to the message box and puts the cursor after it. */
  const quoteIntoDraft = (text: string) => {
    const quoted = text.trim().split('\n').map((line) => `> ${line}`).join('\n')
    setDraft((current) => current.trim() ? `${current.replace(/\s+$/, '')}\n\n${quoted}\n\n` : `${quoted}\n\n`)
    requestAnimationFrame(() => { const box = root.current?.querySelector<HTMLTextAreaElement>('.composer textarea'); box?.focus(); box?.setSelectionRange(box.value.length, box.value.length) })
  }
  const editMessage = (text: string, files: Attachment[], seq?: number) => {
    setEditTarget(seq ?? null); setEditRestored(false)
    setDraft(text); setAttachments(files)
    requestAnimationFrame(() => { const box = root.current?.querySelector<HTMLTextAreaElement>('.composer textarea'); box?.focus(); box?.setSelectionRange(text.length, text.length) })
  }
  /** "/aside question" (or Claude Code's "/btw") asks about the whole chat beside it: the agent keeps working and never sees it. */
  const askAside = (question: string) => act(async () => {
    const submitted = draft
    const aside = await invoke('aside.ask', view.sessionId, null, '', 'assistant', question)
    setDraft((current) => current === submitted ? '' : current)
    setOpenAside({ id: aside.id, quote: aside.quote, from: aside.quoteFrom, keepFocus: true })
  })
  const send = (mode: 'queue' | 'steer' = action, context: FileContext[] = []) => {
    const side = /^\/(?:aside|btw)\s+(\S[\s\S]*)$/.exec(draft.trim())
    return side && !attachments.length && !attached.length ? askAside(side[1]!.trim()) : sendToAgent(mode, context)
  }
  const sendToAgent = (mode: 'queue' | 'steer', context: FileContext[]) => act(async () => {
    const submitted = draft
    const submittedFiles = attachments
    const outgoing = editTarget ? `${submitted}\n\n<ramu-context>\nThis revises my earlier message ${editTarget}.${editRestored ? ' Selected file changes from that message and later captured runs were restored using Ramu. Inspect current files before acting.' : ' Files have not been restored.'} Treat this revised request as replacing the earlier request; the previous transcript remains as historical evidence.\n</ramu-context>` : submitted
    setConfiguring(true)
    try {
      if (pendingSettings) {
        setSession(await invoke('agent.configure', view.sessionId, pendingSettings))
        setPendingSettings(null)
      }
      if (attached.length) {
        // Review comments go out with this message, as one request to the agent.
        for (const [index, group] of attached.entries()) await invoke('reviews.sendComments', group.review.id, group.ids, index === 0 ? outgoing : '', index === 0 ? submittedFiles.map((file) => file.id) : [], index === 0 ? context : [])
      } else await invoke('agent.submit', view.sessionId, outgoing, mode, submittedFiles.map((file) => file.id), context)
      setEditTarget(null); setEditRestored(false)
      setDraft((current) => current === submitted ? '' : current)
      setAttachments((current) => current.filter((file) => !submittedFiles.some((sent) => sent.id === file.id)))
      stick.current = true
    } finally { setConfiguring(false) }
  })

  return (
    <div ref={root} className={`agent-view${dropping ? ' dropping' : ''}`} data-state={session?.state}
      onDragOver={(event) => { if (event.dataTransfer.types.includes(FILE_DRAG_TYPE) || event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDropping(true) } }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false) }}
      onDrop={(event) => {
        setDropping(false)
        // A drop on the message box is already handled by the box itself.
        if ((event.target as Element).closest?.('.composer')) return
        const dragged = event.dataTransfer.getData(FILE_DRAG_TYPE), files = [...event.dataTransfer.files]
        if (!dragged && !files.length) return
        event.preventDefault()
        window.dispatchEvent(new CustomEvent('ramu:chat-drop', { detail: { root: event.currentTarget, dragged, files } }))
      }}>
      <div className="agent-header">
        {history}
        <SessionChangesButton sessionId={view.sessionId} />
        {session && STATE_LABEL[session.state] && <span className={`state ${session.state}`}>{STATE_LABEL[session.state]}</span>}
        <span className="grow" />
        {pendingQuestions.length > 0 && <Button className="ghost small" aria-pressed={showQuestions} onClick={() => setShowQuestions((open) => !open)}><ShieldQuestion size={14} />{translate("Questions · ")}{pendingQuestions.length}</Button>}
        {asides.length > 0 && <Button className="ghost small asides-chip" aria-pressed={openAside !== null} title={translate("Side questions about this chat")} onClick={() => setOpenAside(openAside ? null : asides.length === 1 ? { id: asides[0]!.id, quote: '', from: 'assistant' } : '*')}><MessageCircle size={13} />{translate("Asides · ")}{asides.length}</Button>}
        {tasks.length > 0 && <Button className={`ghost small agents-chip${runningTasks.length ? ' running' : ''}`} aria-pressed={openAgent !== null} title={runningTasks.length ? translate("Sub-agents still working; they can keep going after the turn ends") : translate("Sub-agents in this chat")} onClick={() => setOpenAgent((current) => current ? null : runningTasks.length === 1 ? runningTasks[0]!.agentId : '*')}>{runningTasks.length ? <LoaderCircle size={13} className="spin" /> : <Bot size={14} />}{runningTasks.length ? translate("{0} {1} running", { "0": runningTasks.length, "1": runningTasks.length === 1 ? 'agent' : 'agents' }) : translate("Agents · {0}", { "0": tasks.length })}</Button>}
        {session && events.length > 0 && <Button className="ghost small" disabled={continuing} aria-label={translate("Continue in new chat")} title={continuing ? translate("Starting…") : translate("Continue in new chat (starts with this chat as context)")} onClick={() => void continueInNewChat()}><GitFork size={14} />{continuing ? translate("Starting…") : translate("Continue in new chat")}</Button>}
      </div>
      {goal && <GoalBar goal={goal} onControl={(action) => { void act(() => invoke('agent.goal.control', view.sessionId, action)) }} />}
      {finding && <ChatFind root={scroller} focusRequest={findRequest} initialQuery={findQuery} onClose={closeFind} />}
      {showQuestions && pendingQuestions.length > 0 && <div className="pending-questions" aria-label={translate("Pending questions")}>
        {pendingQuestions.map((question) => <Button key={question.requestId} className="ghost small" onClick={() => {
          if (question.kind === 'question') return openQuestion(question.requestId)
          const card = [...(scroller.current?.querySelectorAll<HTMLElement>('[data-question-request]') ?? [])].find((node) => node.dataset.questionRequest === question.requestId)
          card?.scrollIntoView({ block: 'center', behavior: 'smooth' })
          card?.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus({ preventScroll: true })
        }}>{question.kind === 'elicitation' || questionStates.get(question.requestId)?.waiting || question.responseMode !== 'message' ? 'Waiting: ' : 'Pending: '}{question.kind === 'elicitation' ? `${question.serverName}: ${question.message}` : question.dependsOn || question.questions[0]?.question}</Button>)}
      </div>}
      <div className={`transcript-frame${edges.top ? ' shadow-top' : ''}${edges.bottom ? ' shadow-bottom' : ''}`}>
      <div
        className="transcript"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX
          measureEdges()
        }}
      >
        <div className="transcript-col">
          {turns.map((turn, ti) => {
            const isLast = ti === turns.length - 1
            // A turn is done when the agent reported a result, a later message exists, or nothing is running any more.
            const finished = turn.ended || !isLast || (!working && session?.state !== 'needs-input')
            const { folded, kept, answer } = finished ? foldTurn(turn.items, outcomes) : { folded: [] as Block[], kept: turn.items, answer: [] as Block[] }
            const render = (b: Block, actions = false, latest = false) => {
              const index = blocks.indexOf(b)
              return <div key={index} data-block-index={index}>
                {b.kind === 'tools' ? (
                  <ToolGroup tools={b.tools} results={results} cwd={session?.cwd ?? ''} active={busyAgent && !finished} onBackground={session?.provider === 'claude-code' && live ? backgroundTool : undefined} />
                ) : b.event.kind === 'agent' ? (
                  <AgentTaskCard task={b.event} live={live} onOpen={() => setOpenAgent(b.event.kind === 'agent' ? b.event.agentId : null)} onStop={stopTask} />
                ) : (
                  <EventRow event={relativize(b.event, session?.cwd ?? '')} taskId={session?.taskId} sessionId={view.sessionId} live={live} generating={working && b.event === liveText} outcomes={outcomes} questionStates={questionStates} actions={actions} latest={latest} onEdit={(text, files) => editMessage(text, files, eventSequences.get(b.event))} onOpenAgent={setOpenAgent} onOpenQuestion={openQuestion} />
                )}</div>
            }
            const startedAt = turn.startedAt ?? (folded[0] ? blockAt(folded[0]) : undefined)
            const endedAt = turn.endedAt ?? (answer.length ? blockAt(answer.at(-1)!) : undefined)
            return <div key={turn.key} className="turn">
              {turnDates[ti] !== undefined && <time className="chat-date" dateTime={new Date(turnDates[ti]!).toISOString()} title={new Date(turnDates[ti]!).toLocaleString(formatLocale())}>{formatChatDate(turnDates[ti]!, dateNow, currentLanguage())}</time>}
              {turn.user && render(turn.user, false, isLast && !answer.length && !kept.length && !folded.length)}
              {!finished && isLast && working && <div className="turn-working" role="status"><span>{elapsed !== null ? translate("Working for {0}", { "0": formatDuration(elapsed) }) : translate("Working")}</span></div>}
              {folded.length > 0 && <TurnSummary label={startedAt && endedAt && endedAt >= startedAt ? translate("Worked for {0}", { "0": formatDuration(endedAt - startedAt) }) : translate("Worked")} sourceIndex={view.sourceSeq ? blocks.indexOf(folded[0]!) : undefined}>{folded.map((b) => render(b))}</TurnSummary>}
              {kept.map((b) => render(b))}
              {answer.map((b) => render(b, finished, isLast && b === answer.at(-1)))}
              {turnReviews.get(turn.key)?.map((review) => <TurnChanges key={review.id} review={review} />)}
            </div>
          })}
          {(working || compacting) && (
            <div className="working" role="status">
              <span className="shimmer">{compacting ? translate("Compacting context…") : translate("Thinking")}</span>
            </div>
          )}
        </div>
      </div>
      {edges.bottom && <Button type="button" className={`jump-bottom${working ? ' working' : ''}`} aria-label={working ? translate("Agent is working. Scroll to latest") : translate("Scroll to latest")} title={translate("Scroll to latest")} onClick={scrollToLatest}>
        {working ? <span className="ramu-loader" aria-hidden="true"><i /><i /><i /></span> : <ArrowDown size={14} />}
      </Button>}
      <SelectionActions scroller={scroller} onQuote={quoteIntoDraft} onAside={(quote, from) => setOpenAside({ id: null, quote, from })} />
      {openAside && <AsidePanel sessionId={view.sessionId} asides={asides} open={openAside} taskId={session?.taskId} onOpen={setOpenAside} onClose={() => setOpenAside(null)} onQuote={quoteIntoDraft} />}
      {openAgent && <AgentTaskPanel tasks={tasks} openId={openAgent} events={events} results={results} cwd={session?.cwd ?? ''} live={live} taskId={session?.taskId} onSelect={setOpenAgent} onClose={() => setOpenAgent(null)} onStop={stopTask}
        onMessage={(task, text) => act(() => invoke('agent.messageTask', view.sessionId, task.agentId, text))} />}
      </div>
      <div className="composer-dock">
        {editTarget && <div className="chat-edit" role="region" aria-label={translate("Editing message")}>
          <Pencil size={14} /><div className="chat-edit-copy"><strong>{translate("Editing message")}</strong><span>{editRestored ? translate("Selected files restored. Send your revised message.") : translate("Restore file changes before sending, if needed.")}</span></div><Button className="ghost small" disabled={configuring} onClick={() => { setEditTarget(null); setEditRestored(false) }}>{translate("Cancel edit")}</Button>
          {!editRestored && <UndoRun sessionId={view.sessionId} userSeq={editTarget} onRestored={() => setEditRestored(true)} />}
        </div>}
        {dockQuestions.length > 0 && <QuestionDock sessionId={view.sessionId} requests={dockQuestions} states={questionStates} open={questionDockOpen} onOpenChange={setQuestionDockOpen} focus={questionFocus} />}
        {todos && <TodoDock items={todos} active={busyAgent} crowded={dockQuestions.length > 0 && questionDockOpen} />}
        {error && <div className="error">{error}</div>}
        {queued.length > 0 && <div className="message-queue" aria-label={translate("Queued messages")}>
          {queuePaused && <div className="message-queue-heading"><span className="muted small">{translate("Paused")}</span><Button className="ghost small" onClick={() => void act(() => invoke('agent.resumeQueue', view.sessionId))}>{translate("Resume messages")}</Button></div>}
          {queued.map((message) => {
            const relay = parseTaskMessage(message.text)
            const text = relay ? `To ${relay.name}: ${relay.body}` : message.text.split('\n\n<ramu-context>\n')[0] || 'Attachments'
            const recall = () => void act(async () => { await invoke('agent.removeQueued', view.sessionId, message.id); setAttachments((current) => [...current, ...(message.attachments ?? []).filter((file) => !current.some((entry) => entry.id === file.id))]); setDraft((current) => current ? `${current}\n${message.text}` : message.text) })
            // Both modes use the queue row; steering waits for the active tools to finish.
            const steerNow = () => void act(async () => { await invoke('agent.removeQueued', view.sessionId, message.id); await invoke('agent.submit', view.sessionId, message.text, 'steer', (message.attachments ?? []).map((file) => file.id), []) })
            return <div className="queued-message" key={message.id}>
              <ListEnd size={15} className="queued-icon" />
              <span className="queued-text" title={text}>{text}{message.attachments?.length ? <Attachments files={message.attachments} size="small" /> : null}</span>
              <Button className="ghost icon small-icon queued-steer" aria-label={translate("Steer")} disabled={message.mode === 'steer' || configuring || !busyAgent || !supportsSteering} title={message.mode === 'steer' ? translate("Steering pending until active tools finish") : translate("Send after active tools finish")} onClick={steerNow}><CornerDownRight size={14} /></Button>
              <Button className="ghost icon small-icon" disabled={configuring} aria-label={translate("Remove queued message")} title={translate("Remove")} onClick={() => void act(() => invoke('agent.removeQueued', view.sessionId, message.id))}><Trash2 size={14} /></Button>
              <Menu label={translate("Queued message actions")} icon={<MoreHorizontal size={14} />} className="ghost icon small-icon" align="end" items={[
                { key: 'edit', label: <><Pencil size={14} /> {translate(" Edit message")}</>, onSelect: recall },
              ]} />
            </div>
          })}
        </div>}
        <Composer
          attachments={attachments}
          onAttachmentsChange={setAttachments}
          stop={{ active: live && busyAgent, onStop: () => { setInterrupted(true); void act(() => invoke('agent.interrupt', view.sessionId)) } }}
          resume={{ active: !busyAgent && !!session && stopped, onResume: () => { setInterrupted(false); stick.current = true; void act(() => invoke('agent.submit', view.sessionId, RESUME_PROMPT, 'steer', [], [])) } }}
          value={draft}
          allowEmpty={attached.length > 0}
          chips={<>{session && <ProviderRouteChip sessionId={view.sessionId} settings={pendingSettings ?? session.settings} />}{attached.length > 0 && <CommentsChip groups={attached} onRemove={() => void act(async () => { for (const group of attached) await invoke('reviews.select', group.review.id, group.ids, false) })} />}</>}
          disabled={configuring || !session}
          controls={session && <><AgentControls settings={pendingSettings ?? session.settings} onChange={changeSettings} disabled={false} trailing={<ContextMeter sessionId={view.sessionId} />} /></>}
          onChange={setDraft}
          chat
          onSubmit={(context) => void send(action, context)}
          onAlternateSubmit={busyAgent && supportsSteering ? (context) => void send(opposite, context) : undefined}
          alternateDisabled={configuring || !session}
          alternateLabel={opposite === 'queue' ? 'Queue' : 'Steer'}
          placeholder={live || busyAgent ? translate("Reply to the agent") : translate("Resume with a message")}
          submitLabel={busyAgent ? action === 'queue' ? 'Queue' : 'Steer' : 'Send'}
        />
      </div>
    </div>
  )
}

/** Shows paths inside the agent's directory relative to it; the header carries the full path. */
function relativize(e: AgentEvent, cwd: string): AgentEvent {
  if (!cwd) return e
  const strip = (s: string) => s.split(`${cwd}/`).join('')
  if (e.kind === 'permission-request') return { ...e, detail: strip(e.detail) }
  return e
}

/** "Worked for 35s": the run's steps fold into one line once it is done; the answer stays visible. */
/** Sent when you resume a stopped turn. The visible part is empty, so it never shows as a chat message. */
const RESUME_PROMPT = '\n\n<ramu-context>\nContinue where you left off.\n</ramu-context>'

function TurnSummary({ label, children }: { label: string; children: React.ReactNode; sourceIndex?: number }) {
  useLanguage()
  const [open, setOpen] = useState(false)
  return (
    <Collapsible open={open} onOpenChange={setOpen} className={open ? 'turn-summary open' : 'turn-summary'}>
      <CollapsibleTrigger render={<Button variant="ghost" className="turn-summary-toggle" />}>
        <span>{label}</span>{open ? <ChevronDown size={14} className="caret" /> : <ChevronRight size={14} className="caret" />}
      </CollapsibleTrigger>
      <CollapsibleContent className="turn-summary-panel"><div className="turn-summary-body">{children}</div></CollapsibleContent>
    </Collapsible>
  )
}

const TOOL_VERB: Record<string, string> = { Bash: 'Ran', Edit: 'Edited', MultiEdit: 'Edited', Write: 'Wrote', NotebookEdit: 'Edited', Read: 'Read', Grep: 'Searched', Glob: 'Listed', WebFetch: 'Fetched', WebSearch: 'Searched' }

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
      if (el.getAnimations().length) { schedule(); return }
      el.toggleAttribute('data-fade-top', el.scrollTop > 2)
      el.toggleAttribute('data-fade-bottom', el.scrollTop + el.clientHeight < el.scrollHeight - 2)
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update) }
    update()
    el.addEventListener('scroll', schedule, { passive: true })
    const observer = new ResizeObserver(schedule)
    observer.observe(el)
    for (const child of el.children) observer.observe(child)
    return () => { el.removeEventListener('scroll', schedule); observer.disconnect(); if (frame) cancelAnimationFrame(frame) }
  })
  return ref
}

function ShadowPre({ children }: { children: React.ReactNode }) {
  useLanguage()
  const ref = useScrollFade<HTMLPreElement>()
  return <pre ref={ref} className="tool-output fade-scroll">{children}</pre>
}

function ToolGroup({ tools, results, cwd, active, onBackground }: { tools: ToolUse[]; results: Map<string, ToolResult>; cwd: string; active: boolean; onBackground?: (toolUseId: string) => void }) {
  useLanguage()
  const bodyRef = useScrollFade<HTMLDivElement>()
  const running = tools.some((t) => toolIsRunning(results.get(t.toolUseId), active))
  const failed = tools.some((t) => results.get(t.toolUseId)?.isError)
  const Icon = tools.some((t) => t.name === 'Bash') ? SquareTerminal : BookOpen
  return (
    <Collapsible className={failed ? 'tool-group error' : 'tool-group'} defaultOpen={running}>
      <CollapsibleTrigger render={<Button variant="ghost" />}>
        <Icon size={14} className={running ? 'tool-icon running' : 'tool-icon'} />
        <span className="tool-group-label">{describeTools(tools, results, active)}</span>
        <ChevronRight size={13} className="caret" />
      </CollapsibleTrigger>
      <CollapsibleContent className="tool-disclosure-panel"><div ref={bodyRef} className="tool-group-body fade-scroll">
        {tools.map((t) => {
          const r = results.get(t.toolUseId)
          const toolRunning = toolIsRunning(r, active)
          const summary = t.summary.split(`${cwd}/`).join('')
          const bash = t.name === 'Bash'
          const movable = !!onBackground && bash && toolRunning
          return (
            <Collapsible key={t.toolUseId} className="tool" defaultOpen={movable}>
              <CollapsibleTrigger render={<Button variant="ghost" />}>
                {bash ? <SquareTerminal size={14} className={toolRunning ? 'tool-icon running' : 'tool-icon'} /> : <BookOpen size={14} className={toolRunning ? 'tool-icon running' : 'tool-icon'} />}
                <span className="tool-summary">{translate(toolVerb(TOOL_VERB[t.name] ?? toolLabel(t.name), toolRunning))} {summary}</span>
                <ChevronRight size={12} className="caret" />
              </CollapsibleTrigger>
              <CollapsibleContent className="tool-disclosure-panel"><div className="tool-card">
                <div className={movable ? 'tool-card-title with-action' : 'tool-card-title'}>
                  <span>{bash ? 'Shell' : toolLabel(t.name)}</span>
                  {movable && <Button className="ghost small" title={translate("Let the agent carry on while this keeps running")} onClick={() => onBackground(t.toolUseId)}>{translate("Run in background")}</Button>}
                </div>
                <ShadowPre>{bash ? `$ ${summary}\n` : ''}{r ? r.summary || translate("No output") : toolRunning ? translate("Running…") : translate("No output")}</ShadowPre>
              </div></CollapsibleContent>
            </Collapsible>
          )
        })}
      </div></CollapsibleContent>
    </Collapsible>
  )
}

/** Words that arrive while the agent is writing fade in, so the newest few read dimmer. */
function fadeIn(children: React.ReactNode): React.ReactNode {
  return Children.map(children, (child) => typeof child === 'string'
    ? child.split(/(\s+)/).map((part, i) => part === '' || /^\s+$/.test(part) ? part : <span key={i} className="stream-word">{part}</span>)
    : child)
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
  const [shown, setShown] = useState(active ? 0 : text.length)
  const target = useRef(text.length)
  target.current = text.length
  useEffect(() => {
    if (!active) { setShown(text.length); return }
    const timer = setInterval(() => setShown((current) => {
      const remaining = target.current - current
      if (remaining <= 0) return Math.min(current, target.current)
      return current + Math.max(2, Math.ceil(remaining * 0.12))
    }), 32)
    return () => clearInterval(timer)
  }, [active])
  if (!active || shown >= text.length) return text
  // Words appear whole: extend the cut to the next space.
  const next = text.slice(shown).search(/\s/)
  return text.slice(0, next === -1 ? text.length : shown + next)
}

function ChatLink({ href, children, taskId }: { href?: string; children: React.ReactNode; taskId?: string }) {
  useLanguage()
  const ws = useWorkspace()
  const local = href && localFileLink(href)
  const external = href && /^https?:\/\//i.test(href)
  return <a href={href} target={external ? '_blank' : undefined} rel={external ? 'noreferrer' : undefined} title={local ? translate("Open {0} in editor", { "0": href }) : undefined} onClick={local ? (event) => {
    event.preventDefault()
    if (!taskId || !href) return
    void invoke('files.resolveLink', taskId, href).then((file) => {
      if (!file) throw new Error('This file was not found in this chat’s folders, or the path matches more than one file.')
      ws.openView(taskId, { kind: 'file', repoId: file.repoId, path: file.path, ...(file.line ? { selection: { line: file.line, column: file.column ?? 1, endColumn: file.column ?? 1, requestId: crypto.randomUUID() } } : {}) })
    }).catch((error) => notifyError(errorText(error), 'Open file'))
  } : undefined}>{children}</a>
}

function AssistantText({ event: e, generating, actions, latest = false, taskId }: { event: Extract<AgentEvent, { kind: 'text' }>; generating: boolean; actions: boolean; latest?: boolean; taskId?: string }) {
  useLanguage()
  const text = useTypewriter(e.text, generating)
  return (
    <div className={`msg assistant${generating ? ' generating' : ''}`}>
      <Markdown remarkPlugins={[remarkGfm]} urlTransform={(url) => localFileLink(url) ? url : defaultUrlTransform(url)} components={{ ...(generating ? STREAMING : {}), a: ({ href, children }) => <ChatLink href={href} taskId={taskId}>{children}</ChatLink> }}>{text}</Markdown>
      {actions && !generating && <div className={`msg-actions${latest ? ' always' : ''}`}><MessageTime at={e.at} /><CopyButton text={e.text} /></div>}
    </div>
  )
}

function MessageTime({ at }: { at?: number }) {
  useLanguage()
  if (!at) return null
  const date = new Date(at)
  return <time className="msg-time" dateTime={date.toISOString()} title={date.toLocaleString(formatLocale())}>{date.toLocaleTimeString(formatLocale(), { hour: 'numeric', minute: '2-digit' })}</time>
}

function CopyButton({ text }: { text: string }) {
  useLanguage()
  const [done, setDone] = useState(false)
  return (
    <Button
      className="ghost icon small-icon copy-btn"
      aria-label={translate("Copy")}
      title={translate("Copy")}
      onClick={() => {
        void copyText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1200) }, (error) => notifyError(errorText(error), 'Copy message'))
      }}
    >
      {done ? <Check size={14} /> : <Copy size={14} />}
    </Button>
  )
}

function Outcome({ outcome }: { outcome: string | undefined }) {
  useLanguage()
  if (!outcome) return null
  const text = outcome === 'allowed' ? 'Allowed' : outcome === 'denied' ? 'Denied' : outcome === 'answered' ? 'Answered' : 'Cancelled'
  return <div className="outcome">{translate(text)}</div>
}

function TurnDiff({ diff }: { diff: string }) {
  useLanguage()
  return <Collapsible className="tool-group"><CollapsibleTrigger render={<Button variant="ghost" />}><BookOpen size={14} /><span className="tool-group-label">{translate('Changes in this turn')}</span><ChevronRight size={13} className="caret" /></CollapsibleTrigger><CollapsibleContent className="tool-disclosure-panel"><div className="tool-card"><ShadowPre>{diff}</ShadowPre></div></CollapsibleContent></Collapsible>
}

function EventRow({ event: e, sessionId, taskId, live, generating = false, outcomes, questionStates, actions = false, latest = false, onEdit, onOpenAgent, onOpenQuestion }: { event: AgentEvent; sessionId: string; taskId?: string; live: boolean; generating?: boolean; outcomes: Map<string, string>; questionStates: Map<string, QuestionState>; actions?: boolean; latest?: boolean; onEdit?: (text: string, attachments: Attachment[]) => void; onOpenAgent?: (agentId: string) => void; onOpenQuestion?: (requestId: string) => void }) {
  useLanguage()
  switch (e.kind) {
    case 'recovery':
      return <div className="conversation-separator" role="status"><span>{translate("Continued after restart")}</span></div>
    case 'compaction':
      return e.state === 'started' ? null : <div className={`compaction-separator${e.state === 'failed' ? ' error' : ''}`} role="status"><span><Minimize2 size={14} />{compactionLabel(e)}</span></div>
    case 'schedule':
      return <ScheduleChatCard schedule={e.schedule} />
    case 'settings':
      return <div className="conversation-separator"><span>{providerName(e.settings.provider)} · {e.settings.model || translate("Default model")} · {e.settings.effort || translate("Default effort")} · {accessName(e.settings.access)}{e.settings.provider === 'codex' && ` · ${e.settings.serviceTier === 'fast' ? 'Fast' : 'Standard'}`}<small>{e.reason}{e.handoff ? ' · Conversation context handed over' : ''}</small>{e.previous && live && <Button className="ghost small separator-action" title={translate("Go back to {0} for the next message", { "0": providerName(e.previous.provider) })} onClick={() => void invoke('agent.configure', sessionId, e.previous!).catch((error) => notifyError(errorText(error), 'Model'))}>{translate("Switch back to ")}{providerName(e.previous.provider)}</Button>}</span></div>
    case 'user': {
      if (!e.text.split('\n\n<ramu-context>\n')[0] && !e.attachments?.length && !sentComments(e.text).length) return null
      // A sub-agent's report comes back as a message, shown as a report and not as something you typed.
      const report = parseTaskReport(e.text)
      // Advice delivered after the advisor answered: the card holds the advice, this marks where the agent received it.
      const advice = parseAdvice(e.text)
      if (advice) return <Button type="button" className={`advice-delivered${advice.failed ? ' failed' : ''}`} onClick={() => onOpenAgent?.(advisorAgentId(advice.requestId))} title={translate("Open the advisor's answer")}>
        <Lightbulb size={13} /><span>{advice.failed ? translate("The advisor could not answer: {0}", { "0": advice.body }) : translate("Advice delivered to the agent")}</span>{advice.advisor && <span className="muted">{advice.advisor}</span>}<ChevronRight size={13} className="caret" />
      </Button>
      if (report) return <div className="task-report"><div className="task-report-title"><Bot size={13} />{report.name} <span className="muted">{report.verb}</span></div><div className="msg assistant"><Markdown remarkPlugins={[remarkGfm]}>{report.body}</Markdown></div></div>
      // Stopping a Codex sub-agent goes through the main agent; the chat shows it as a note.
      const stop = parseTaskStop(e.text)
      if (stop) return <div className="turn-end chat-note" role="status"><Square size={11} />{translate("Asked the agent to stop {0}", { "0": stop.name })}</div>
      // Late answers are yours, so they stay on the right, without the delivery note the agent reads.
      const answers = parseAnswerMessage(e.text)
      if (answers) return <div className="msg-wrap user"><span className="msg-to"><ShieldQuestion size={12} />{translate("Answers to the agent's questions")}</span><div className="msg user">{answers.body}</div><div className={`msg-actions${latest ? ' always' : ''}`}><MessageTime at={e.at} /><CopyButton text={answers.body} /></div></div>
      // A message relayed to a sub-agent shows who it is for, not the relay instructions.
      const relay = parseTaskMessage(e.text)
      return <div className="msg-wrap user">
        {relay && <span className="msg-to"><Bot size={12} />{translate("To ")}{relay.name}</span>}
        {e.attachments?.length ? <Attachments files={e.attachments} /> : null}
        {relay ? <div className="msg user">{relay.body}</div> : e.text.split('\n\n<ramu-context>\n')[0] ? <div className="msg user">{e.text.split('\n\n<ramu-context>\n')[0]}</div> : null}
        {sentComments(e.text).length > 0 && <div className="sent-comments">{sentComments(e.text).map((c, i) => <div key={i} className="sent-comment"><div className="comments-popover-where"><span className="review-note-where">{c.label}</span><span className="comments-popover-file" title={c.path}>{c.path}</span></div><p>{c.text}</p></div>)}</div>}
        <div className={`msg-actions${latest ? ' always' : ''}`}><MessageTime at={e.at} /><CopyButton text={e.text.split('\n\n<ramu-context>\n')[0] ?? ''} />{onEdit && <Button className="ghost icon small-icon copy-btn" aria-label={translate("Edit message")} title={translate("Edit and send again")} onClick={() => onEdit(e.text.split('\n\n<ramu-context>\n')[0] ?? '', e.attachments ?? [])}><Pencil size={14} /></Button>}</div>
      </div>
    }
    case 'text':
      return <AssistantText event={e} generating={generating} actions={actions} latest={latest} taskId={taskId} />
    case 'turn-diff':
      return <TurnDiff diff={e.diff} />
    case 'thinking':
      return <ThinkingRow text={e.text} />
    case 'elicitation':
      return <ElicitationCard sessionId={sessionId} request={e} status={questionStates.get(e.requestId) ?? questionState([], e.requestId)} pending={live && !outcomes.has(e.requestId)} />
    case 'permission-request': {
      const pending = live && !outcomes.has(e.requestId)
      return (
        <div className={pending ? 'card pending' : 'card'}>
          <div className="card-title">
            <ShieldQuestion size={15} /> {e.title}
          </div>
          {e.detail && <pre>{e.detail}</pre>}
          {pending ? (
            <div className="row">
              <Button className="primary" onClick={() => void invoke('agent.replyPermission', sessionId, e.requestId, true)}>
                {translate("Allow")}</Button>
              <Button onClick={() => void invoke('agent.replyPermission', sessionId, e.requestId, false)}>{translate("Deny")}</Button>
            </div>
          ) : (
            <Outcome outcome={outcomes.get(e.requestId)} />
          )}
        </div>
      )
    }
    case 'question':
      return <QuestionRow request={e} status={questionStates.get(e.requestId) ?? { answers: {}, drafts: {}, waiting: false }} pending={(e.responseMode === 'message' || live) && !outcomes.has(e.requestId)} onOpen={onOpenQuestion} />
    case 'result':
      return e.isError ? <div className="turn-end error"><CircleAlert size={13} />{translate("The agent reported a failure.")}</div> : null
    case 'file-restore':
      return <div className="turn-end" role="status">{translate("Restored {0} files from message {1} and later captured runs.", { "0": e.fileCount, "1": e.userSeq })}</div>
    case 'error':
      return <div className="msg error">{e.message}</div>
    default:
      return null
  }
}

const TASK_STATUS: Record<AgentTask['status'], string> = { running: 'Running', completed: 'Done', failed: 'Failed', stopped: 'Stopped' }

function TaskStatusIcon({ status }: { status: AgentTask['status'] }) {
  useLanguage()
  if (status === 'running') return <LoaderCircle size={14} className="spin task-status running" aria-hidden="true" />
  if (status === 'completed') return <CircleCheck size={14} className="task-status completed" aria-hidden="true" />
  if (status === 'failed') return <CircleX size={14} className="task-status failed" aria-hidden="true" />
  return <CircleSlash size={14} className="task-status stopped" aria-hidden="true" />
}

/** Tool uses, time and tokens, as far as the provider reports them. */
function taskMeta(task: AgentTask, status: AgentTask['status']): string {
  const duration = task.durationMs ?? (task.startedAt && (task.endedAt ?? (status === 'running' ? Date.now() : undefined)) ? (task.endedAt ?? Date.now()) - task.startedAt : undefined)
  return [task.provider ? `${providerName(task.provider)}${task.model ? ` · ${modelDisplayName(task.model)}` : ''}` : undefined, task.agentType, task.taskType === 'local_bash' ? 'Command' : undefined, task.isolated ? 'Own copy' : undefined, task.background ? 'Background' : undefined, task.toolUses ? `${task.toolUses} ${task.toolUses === 1 ? 'tool use' : 'tool uses'}` : undefined, duration ? formatDuration(duration) : undefined, task.tokens ? `${Math.round(task.tokens / 100) / 10}k tokens` : undefined].filter(Boolean).join(' · ')
}

/** A sub-agent in the main transcript, where the main agent started it. */
function AgentTaskCard({ task, live, onOpen, onStop }: { task: AgentTask; live: boolean; onOpen: () => void; onStop: (task: AgentTask) => void }) {
  useLanguage()
  const status = effectiveStatus(task, live)
  useElapsed(task.startedAt, status === 'running')
  const final = task.error ?? task.summary
  const detail = status === 'running' ? task.summary ?? (task.lastTool ? `Using ${toolLabel(task.lastTool)}` : 'Starting…') : final && final.toLowerCase() !== TASK_STATUS[status].toLowerCase() ? final : undefined
  return <div className={`agent-task-card ${status}`}>
    <Button type="button" className="agent-task-open" aria-label={translate("Open agent {0}", { "0": task.name })} onClick={onOpen}>
      <span className="agent-task-icon">{task.provider ? <ProviderIcon provider={task.provider} size={14} /> : <Bot size={15} />}</span>
      <span className="agent-task-text">
        <span className="agent-task-title"><span className="agent-task-name">{task.name}</span><span className={`agent-task-state ${status}`}><TaskStatusIcon status={status} />{translate(TASK_STATUS[status])}</span></span>
        {detail && <span className="agent-task-detail">{detail}</span>}
        {taskMeta(task, status) && <span className="agent-task-meta">{taskMeta(task, status)}</span>}
        {!!task.steps?.length && <span className="agent-task-steps">{task.steps.map((step, index) => <span key={index}>{index > 0 && ' → '}{providerName(step.provider)}{step.model ? ` ${modelDisplayName(step.model)}` : ''}</span>)} · {task.steps.at(-1)!.reason}</span>}
      </span>
      <ChevronRight size={14} className="caret" />
    </Button>
    {status === 'running' && live && task.canStop && <Button className="ghost icon small-icon agent-task-stop" aria-label={translate("Stop agent {0}", { "0": task.name })} title={translate("Stop this agent")} onClick={() => onStop(task)}><Square size={12} /></Button>}
  </div>
}

/** One sub-agent's own conversation beside the chat, or the list of all of them. */
function AgentTaskPanel({ tasks, openId, events, results, cwd, live, taskId, onSelect, onClose, onStop, onMessage }: { tasks: AgentTask[]; openId: string; events: AgentEvent[]; results: Map<string, ToolResult>; cwd: string; live: boolean; taskId?: string; onSelect: (id: string | null) => void; onClose: () => void; onStop: (task: AgentTask) => void; onMessage: (task: AgentTask, text: string) => Promise<void> }) {
  useLanguage()
  const task = openId === '*' ? undefined : tasks.find((entry) => entry.agentId === openId)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const body = useRef<HTMLDivElement>(null)
  useEffect(() => { setDraft('') }, [openId])
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) onClose() }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey) }, [onClose])
  // Its own output, plus what you sent it through the main agent.
  const own = useMemo(() => {
    if (!task) return []
    const address = task.address ?? task.agentId
    return toBlocks(events.flatMap((event): AgentEvent[] => {
      if (event.kind === 'user' && event.agentId === task.agentId) { const { agentId: _, ...rest } = event; return [rest as AgentEvent] }
      if (event.kind === 'user') { const relay = parseTaskMessage(event.text); return relay?.address === address ? [{ ...event, text: relay.body }] : [] }
      if (event.kind === 'agent' || event.agentId !== task.agentId) return []
      const { agentId: _, ...rest } = event
      return [rest as AgentEvent]
    }))
  }, [events, task?.agentId, task?.address])
  useEffect(() => { const el = body.current; if (el) el.scrollTop = el.scrollHeight }, [own.length])
  const status = task ? effectiveStatus(task, live) : 'stopped'
  const send = async () => {
    if (!task || !draft.trim() || sending) return
    setSending(true)
    try { await onMessage(task, draft.trim()); setDraft('') } finally { setSending(false) }
  }
  return <aside className="agent-panel" aria-label={task ? translate("Agent {0}", { "0": task.name }) : translate("Agents")}>
    <header className="agent-panel-header">
      {task && tasks.length > 1 && <Button className="ghost icon small-icon" aria-label={translate("All agents")} title={translate("All agents")} onClick={() => onSelect('*')}><ArrowLeft size={14} /></Button>}
      {task ? <><TaskStatusIcon status={status} /><span className="agent-panel-title" title={task.name}>{task.name}</span></> : <><Bot size={15} /><span className="agent-panel-title">{translate("Agents")}</span></>}
      <span className="grow" />
      {task && status === 'running' && live && task.canStop && <Button className="ghost small" onClick={() => onStop(task)}><Square size={11} />{translate("Stop")}</Button>}
      <Button className="ghost icon small-icon" aria-label={translate("Close agent panel")} title={translate("Close (Esc)")} onClick={onClose}><X size={14} /></Button>
    </header>
    {!task ? <div className="agent-panel-body agent-panel-list">
      {tasks.map((entry) => <AgentTaskCard key={entry.agentId} task={entry} live={live} onOpen={() => onSelect(entry.agentId)} onStop={onStop} />)}
    </div> : <>
      <div className="agent-panel-meta muted small">{[translate(TASK_STATUS[status]), taskMeta(task, status)].filter(Boolean).join(' · ')}</div>
      <div ref={body} className="agent-panel-body">
        {task.recoveryError && <p className="muted small" role="status">{translate("Saved provider history could not be fully recovered. Previously received output is still shown.")} {task.recoveryError}</p>}
        {task.prompt && <div className="agent-panel-prompt"><span className="agent-panel-label">{translate("Task")}</span><div className="agent-panel-prompt-text">{task.prompt}</div></div>}
        {own.map((block, index) => <div key={index}>{block.kind === 'tools' ? <ToolGroup tools={block.tools} results={results} cwd={cwd} active={status === 'running' && live} /> : block.event.kind === 'text' ? <AssistantText event={block.event} generating={false} actions={false} taskId={taskId} /> : block.event.kind === 'turn-diff' ? <TurnDiff diff={block.event.diff} /> : block.event.kind === 'user' ? <div className="msg-wrap user"><div className="msg user">{block.event.text}</div></div> : block.event.kind === 'thinking' ? <ThinkingRow text={block.event.text} /> : block.event.kind === 'error' ? <div className="msg error">{block.event.message}</div> : null}</div>)}
        {!own.length && <p className="muted small">{status === 'running' ? translate("Working… its messages and tool calls appear here.") : translate("This agent left no transcript.")}</p>}
        {status !== 'running' && (task.error || task.summary && task.summary.toLowerCase() !== TASK_STATUS[status].toLowerCase() && !own.some((block) => block.kind === 'event' && block.event.kind === 'text' && block.event.text.trim() === task.summary!.trim())) && <div className={`agent-panel-report${task.error ? ' error' : ''}`}><span className="agent-panel-label">{task.error ? translate("Error") : translate("Report")}</span><Markdown remarkPlugins={[remarkGfm]}>{task.error ?? task.summary ?? ''}</Markdown></div>}
      </div>
      {task.canMessage && live ? <form className="agent-panel-compose" onSubmit={(event) => { event.preventDefault(); void send() }}>
        <Textarea aria-label={translate("Message {0}", { "0": task.name })} placeholder={translate("Message {0}…", { "0": task.name })} value={draft} rows={2} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send() } }} />
        <Button type="submit" className="icon agent-panel-send" aria-label={translate("Send to agent")} title={translate("Send through the main agent")} disabled={!draft.trim() || sending}><Send size={14} /></Button>
      </form> : <p className="agent-panel-hint muted small">{task.taskType === 'advisor' ? translate("The advisor answers the chat's agent and does not take messages.") : task.recovered ? translate("This helper’s previous process ended. Continue through the main chat.") : task.canMessage ? translate("Resume the chat to message this agent.") : translate("Background commands do not take messages.")}</p>}
    </>}
  </aside>
}

/** Selected chat text gets a split button: Quote into the message box, or Ask aside without touching the chat. */
function SelectionActions({ scroller, onQuote, onAside }: { scroller: React.RefObject<HTMLDivElement | null>; onQuote: (text: string) => void; onAside: (text: string, from: 'assistant' | 'user') => void }) {
  useLanguage()
  const [pick, setPick] = useState<{ text: string; from: 'assistant' | 'user'; top: number; left: number } | null>(null)
  useEffect(() => {
    let pressing = false
    const read = () => {
      const selection = document.getSelection(), el = scroller.current
      if (!selection || selection.isCollapsed || !selection.rangeCount || !el?.checkVisibility()) return setPick(null)
      const range = selection.getRangeAt(0)
      if (!el.contains(range.commonAncestorContainer)) return setPick(null)
      const text = selection.toString().trim()
      const start = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement
      if (!text || !start?.closest('.msg')) return setPick(null)
      const rect = range.getBoundingClientRect(), frame = el.getBoundingClientRect()
      // Above the selection, or below it when there is no room under the header.
      const top = rect.top - 40 < frame.top ? rect.bottom + 8 : rect.top - 40
      const left = Math.min(Math.max(rect.left + rect.width / 2, frame.left + 110), frame.right - 110)
      setPick({ text: text.slice(0, 20_000), from: start.closest('.msg.user') ? 'user' : 'assistant', top, left })
    }
    const change = () => { if (!pressing) read() }
    const down = (event: MouseEvent) => { if (!(event.target as Element).closest?.('.selection-actions')) { pressing = true; setPick(null) } }
    const up = () => { if (pressing) { pressing = false; requestAnimationFrame(read) } }
    const hide = () => setPick(null)
    const el = scroller.current
    document.addEventListener('selectionchange', change); document.addEventListener('mousedown', down); document.addEventListener('mouseup', up)
    el?.addEventListener('scroll', hide); window.addEventListener('resize', hide)
    return () => { document.removeEventListener('selectionchange', change); document.removeEventListener('mousedown', down); document.removeEventListener('mouseup', up); el?.removeEventListener('scroll', hide); window.removeEventListener('resize', hide) }
  }, [scroller])
  const quote = () => { if (pick) { onQuote(pick.text); document.getSelection()?.removeAllRanges(); setPick(null) } }
  const aside = () => { if (pick) { onAside(pick.text, pick.from); document.getSelection()?.removeAllRanges(); setPick(null) } }
  useEffect(() => {
    if (!pick) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setPick(null); return }
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey) return
      if (event.code === 'KeyQ') { event.preventDefault(); event.stopPropagation(); quote() }
      if (event.code === 'KeyA') { event.preventDefault(); event.stopPropagation(); aside() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [pick])
  if (!pick) return null
  // Pressing a half must not clear the selection it acts on.
  return createPortal(<div className="selection-actions" role="toolbar" aria-label={translate("Selected text")} style={{ top: pick.top, left: pick.left }} onMouseDown={(event) => event.preventDefault()}>
    <Button type="button" className="selection-action" title={translate("Quote in your message ({0})", { "0": formatKeys('mod+shift+q') })} onClick={quote}><Quote size={13} />{translate("Quote")}</Button>
    <span className="selection-divider" aria-hidden="true" />
    <Button type="button" className="selection-action" title={translate("Ask a side question about this, without interrupting the chat ({0})", { "0": formatKeys('mod+shift+a') })} onClick={aside}><MessageCircle size={13} />{translate("Ask aside")}</Button>
  </div>, document.body)
}

/** Side questions about the chat. Answers come from the chat's model, read-only, and never join the conversation. */
/** An open aside: an existing one, or a new one carrying its quote. keepFocus leaves the caret in the chat's composer. */
type AsideTarget = { id: string | null; quote: string; from: 'assistant' | 'user'; keepFocus?: boolean }
function AsidePanel({ sessionId, asides, open, taskId, onOpen, onClose, onQuote }: { sessionId: string; asides: Aside[]; open: AsideTarget | '*'; taskId?: string; onOpen: (value: AsideTarget | '*' | null) => void; onClose: () => void; onQuote: (text: string) => void }) {
  useLanguage()
  const aside = open === '*' ? undefined : open.id ? asides.find((entry) => entry.id === open.id) : undefined
  const quote = aside?.quote ?? (open === '*' ? '' : open.quote)
  const from = aside?.quoteFrom ?? (open === '*' ? 'assistant' : open.from)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null), body = useRef<HTMLDivElement>(null)
  const openKey = open === '*' ? '*' : open.id ?? `new:${open.quote}`
  useEffect(() => { setDraft(''); setError(null); if (open === '*' || !open.keepFocus) requestAnimationFrame(() => input.current?.focus()) }, [openKey])
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) onClose() }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey) }, [onClose])
  useEffect(() => { const el = body.current; if (el) el.scrollTop = el.scrollHeight }, [aside?.messages.length])
  const waiting = aside?.messages.at(-1)?.role === 'user'
  const send = async () => {
    const question = draft.trim()
    if (!question || sending || waiting) return
    setSending(true); setError(null)
    try { const next = await invoke('aside.ask', sessionId, aside?.id ?? null, quote, from, question); setDraft(''); if (!aside) onOpen({ id: next.id, quote: next.quote, from: next.quoteFrom }) }
    catch (e) { setError(errorText(e)) }
    finally { setSending(false) }
  }
  const remove = (id: string) => void invoke('aside.delete', sessionId, id).then(() => { if (aside?.id === id) onOpen(asides.length > 1 ? '*' : null) }, (e) => setError(errorText(e)))
  const firstLine = (text: string) => text.split('\n').find((line) => line.trim())?.trim() ?? ''
  return <aside className="agent-panel aside-panel" aria-label={translate("Aside")}>
    <header className="agent-panel-header">
      {open !== '*' && asides.length > 1 && <Button className="ghost icon small-icon" aria-label={translate("All asides")} title={translate("All asides")} onClick={() => onOpen('*')}><ArrowLeft size={14} /></Button>}
      <MessageCircle size={14} /><span className="agent-panel-title">{open === '*' ? translate("Asides") : translate("Aside")}</span>
      {open !== '*' && quote && <span className="aside-title-quote muted" title={quote}>{firstLine(quote)}</span>}
      <span className="grow" />
      {aside && <Button className="ghost icon small-icon" aria-label={translate("Delete aside")} title={translate("Delete aside")} onClick={() => remove(aside.id)}><Trash2 size={13} /></Button>}
      <Button className="ghost icon small-icon" aria-label={translate("Close aside")} title={translate("Close (Esc)")} onClick={onClose}><X size={14} /></Button>
    </header>
    {open === '*' ? <div className="agent-panel-body agent-panel-list">
      {asides.map((entry) => <Button key={entry.id} type="button" className="aside-row" onClick={() => onOpen({ id: entry.id, quote: entry.quote, from: entry.quoteFrom })}>
        <span className="aside-row-quote">{firstLine(entry.quote) || translate("Whole chat")}</span>
        <span className="muted small">{firstLine(entry.messages[0]?.text ?? '')}</span>
      </Button>)}
    </div> : <>
      <div ref={body} className="agent-panel-body">
        {quote && <blockquote className="aside-quote"><span className="agent-panel-label">{from === 'user' ? translate("You wrote") : translate("From the chat")}</span>{quote}</blockquote>}
        {aside?.messages.map((message) => message.role === 'user'
          ? <div key={message.id} className="msg-wrap user"><div className="msg user">{message.text}</div></div>
          : <div key={message.id} className={`aside-answer${message.error ? ' error' : ''}`}>
              {message.error ? <p className="error small">{message.text}</p> : <AssistantText event={{ kind: 'text', text: message.text, at: message.at }} generating={false} actions={false} taskId={taskId} />}
              {!message.error && <div className="aside-answer-actions"><Button className="ghost small" onClick={() => onQuote(message.text)}><Quote size={12} />{translate("Quote in message")}</Button><Button className="ghost small" onClick={() => onQuote(`${aside.messages[aside.messages.indexOf(message) - 1]?.text ?? ''}\n\n${message.text}`)}>{translate("Add Q&A to message")}</Button><CopyButton text={message.text} /></div>}
            </div>)}
        {waiting && <div className="working" role="status"><span className="shimmer">{translate("Thinking aside")}</span></div>}
        {!aside && <p className="muted small">{translate("Ask about this without interrupting the chat. The answer stays here and never reaches the agent.")}</p>}
      </div>
      {error && <p className="error small aside-error">{error}</p>}
      <form className="agent-panel-compose" onSubmit={(event) => { event.preventDefault(); void send() }}>
        <Textarea ref={input} aria-label={translate("Ask aside")} placeholder={aside ? translate("Follow up…") : translate("Ask about this…")} value={draft} rows={2} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send() } }} />
        <Button type="submit" className="icon agent-panel-send" aria-label={translate("Ask")} title={translate("Ask aside")} disabled={!draft.trim() || sending || waiting}><Send size={14} /></Button>
      </form>
    </>}
  </aside>
}

/** Reasoning the provider shared; folded into the turn's work and open on demand. */
function ThinkingRow({ text }: { text: string }) {
  useLanguage()
  return <Collapsible className="thinking">
    <CollapsibleTrigger render={<Button variant="ghost" />}><Brain size={14} className="tool-icon" /><span className="tool-summary">{translate("Thought")}</span><ChevronRight size={12} className="caret" /></CollapsibleTrigger>
    <CollapsibleContent className="tool-disclosure-panel"><div className="thinking-body">{text}</div></CollapsibleContent>
  </Collapsible>
}

/** The agent's own checklist, pinned above the message box so progress is visible while it works. */
/** crowded: a question is open above it, so the list starts folded to its summary line. */
function TodoDock({ items, active, crowded = false }: { items: TodoItem[]; active: boolean; crowded?: boolean }) {
  useLanguage()
  const done = items.filter((item) => item.status === 'done').length
  const current = items.find((item) => item.status === 'active') ?? items.find((item) => item.status === 'pending')
  const finished = done === items.length
  const [open, setOpen] = useState<boolean | null>(null)
  const expanded = open ?? (active && !finished && !crowded)
  return <div className={`todo-dock${finished ? ' finished' : ''}`}>
    <Button type="button" className="todo-summary" aria-expanded={expanded} onClick={() => setOpen(!expanded)}>
      <ListChecks size={14} /><span className="todo-count">{done}/{items.length}</span>
      <span className="todo-current">{finished ? translate("All steps done") : current?.text}</span>
      <ChevronDown size={13} className={`caret${expanded ? ' open' : ''}`} />
    </Button>
    {expanded && <ol className="todo-list">{items.map((item, index) => <li key={index} className={`todo-item ${item.status}`}>
      {item.status === 'done' ? <CircleCheck size={14} /> : item.status === 'active' ? <LoaderCircle size={14} className={active ? 'spin' : ''} /> : <Circle size={14} />}<span>{item.text}</span>
    </li>)}</ol>}
  </div>
}
