import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { compactionLabel, isCompacting, isTurnFooter } from '../../../shared/compaction'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { FileContext } from '../../../shared/types'
import { ArrowDown, BookOpen, Check, CornerDownRight, GitFork, ListEnd, MoreHorizontal, Pencil, Trash2, ChevronDown, ChevronRight, CircleAlert, Minimize2, Copy, ShieldQuestion, SquareTerminal } from 'lucide-react'
import { Children, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Markdown, { defaultUrlTransform, type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Attachment, QueuedMessage, AgentEvent, AgentQuestion, AgentSettings, AgentSessionInfo, AgentSessionState, ViewDescriptor } from '../../../shared/types'
import { accessName, AgentControls, providerName } from '../AgentControls'
import { useAppSettings } from '../AppSettings'
import { reviewsByTurn } from '../../../shared/reviewGroups'
import { useReviews } from '../reviews'
import { FILE_DRAG_TYPE } from '../ComposerSuggestions'
import { ChatFind } from '../ChatFind'
import { slide } from '../slide'
import { CommentsChip, pendingComments, sentComments } from '../ReviewChip'
import { SessionChangesButton, TurnChanges } from '../Changes'
import { ScheduleChatCard } from '../Automation'
import { Attachments } from '../Attachments'
import { Composer } from '../Composer'
import { invoke, ramu, copyText } from '../ipc'
import { errorText } from '../TaskPane'
import { Menu } from '../Menu'
import { useWorkspace } from '../workspace'
import { formatChatDate, needsChatDate } from '../../../shared/chatDates'
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
    if (event.kind === 'compaction' && event.state === 'started') continue
    if (event.kind === 'queue' || event.kind === 'tool-result' || event.kind === 'state' || event.kind === 'request-resolved') continue
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
    const foldable = block.kind === 'tools' || block.event.kind === 'text' || (block.event.kind === 'permission-request' || block.event.kind === 'question') && outcomes.has(block.event.requestId)
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
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])
  return since && active ? Math.max(0, now - since) : null
}

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

function describeTools(tools: ToolUse[], running: boolean): string {
  const counts = new Map<string, number>()
  for (const t of tools) counts.set(t.name, (counts.get(t.name) ?? 0) + 1)
  const parts = [...counts].map(([name, n]) => {
    const v = VERBS[name]
    if (!v) return `Used ${toolLabel(name)}${n > 1 ? ` ×${n}` : ''}`
    return v[1] ? `${running ? v[0].replace(/^Ran$/, 'Running').replace(/^Edited$/, 'Editing').replace(/^Read$/, 'Reading').replace(/^Wrote$/, 'Writing') : v[0]} ${n} ${n === 1 ? v[1] : v[2]}` : v[0]
  })
  return parts.join(', ')
}

export function AgentView({ view }: { view: AgentViewDesc }) {
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
  const [pendingSettings, setPendingSettings] = useState<AgentSettings | null>(null)
  const [configuring, setConfiguring] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const scrollFrame = useRef(0)
  const [dropping, setDropping] = useState(false)
  const [finding, setFinding] = useState(false)
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
      if (event.kind === 'text') setLiveText(event)
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
  // Editing puts a sent message back in the box to change and send again; the earlier message stays in the history.
  const editMessage = (text: string, files: Attachment[]) => {
    setDraft(text); setAttachments(files)
    requestAnimationFrame(() => { const box = document.querySelector<HTMLTextAreaElement>('.agent-dock .composer textarea'); box?.focus(); box?.setSelectionRange(text.length, text.length) })
  }
  const send = (mode: 'queue' | 'steer' = action, context: FileContext[] = []) => act(async () => {
    const submitted = draft
    const submittedFiles = attachments
    setConfiguring(true)
    try {
      if (pendingSettings) {
        setSession(await invoke('agent.configure', view.sessionId, pendingSettings))
        setPendingSettings(null)
      }
      if (attached.length) {
        // Review comments go out with this message, as one request to the agent.
        for (const [index, group] of attached.entries()) await invoke('reviews.sendComments', group.review.id, group.ids, index === 0 ? submitted : '', index === 0 ? submittedFiles.map((file) => file.id) : [])
      } else await invoke('agent.submit', view.sessionId, submitted, mode, submittedFiles.map((file) => file.id), context)
      setDraft((current) => current === submitted ? '' : current)
      setAttachments((current) => current.filter((file) => !submittedFiles.some((sent) => sent.id === file.id)))
      stick.current = true
    } finally { setConfiguring(false) }
  })

  return (
    <div className={`agent-view${dropping ? ' dropping' : ''}`} data-state={session?.state}
      onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'f') { event.preventDefault(); setFinding(true) } }}
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
        <SessionChangesButton sessionId={view.sessionId} />
        {session && STATE_LABEL[session.state] && <span className={`state ${session.state}`}>{STATE_LABEL[session.state]}</span>}
        <span className="grow" />
        {session && events.length > 0 && <Button className="ghost small" disabled={continuing} aria-label="Continue in new chat" title={continuing ? 'Starting…' : 'Continue in new chat (starts with this chat as context)'} onClick={() => void continueInNewChat()}><GitFork size={14} />{continuing ? 'Starting…' : 'Continue in new chat'}</Button>}
      </div>
      {finding && <ChatFind root={scroller} onClose={() => setFinding(false)} />}
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
                  <ToolGroup tools={b.tools} results={results} cwd={session?.cwd ?? ''} />
                ) : (
                  <EventRow event={relativize(b.event, session?.cwd ?? '')} taskId={session?.taskId} sessionId={view.sessionId} live={live} generating={working && b.event === liveText} outcomes={outcomes} actions={actions} latest={latest} onEdit={editMessage} />
                )}</div>
            }
            const startedAt = turn.startedAt ?? (folded[0] ? blockAt(folded[0]) : undefined)
            const endedAt = turn.endedAt ?? (answer.length ? blockAt(answer.at(-1)!) : undefined)
            return <div key={turn.key} className="turn">
              {turnDates[ti] !== undefined && <time className="chat-date" dateTime={new Date(turnDates[ti]!).toISOString()} title={new Date(turnDates[ti]!).toLocaleString()}>{formatChatDate(turnDates[ti]!, dateNow)}</time>}
              {turn.user && render(turn.user, false, isLast && !answer.length && !kept.length && !folded.length)}
              {!finished && isLast && working && <div className="turn-working" role="status"><span>{elapsed !== null ? `Working for ${formatDuration(elapsed)}` : 'Working'}</span></div>}
              {folded.length > 0 && <TurnSummary label={startedAt && endedAt && endedAt >= startedAt ? `Worked for ${formatDuration(endedAt - startedAt)}` : 'Worked'} sourceIndex={view.sourceSeq ? blocks.indexOf(folded[0]!) : undefined}>{folded.map((b) => render(b))}</TurnSummary>}
              {kept.map((b) => render(b))}
              {answer.map((b) => render(b, finished, isLast && b === answer.at(-1)))}
              {turnReviews.get(turn.key)?.map((review) => <TurnChanges key={review.id} review={review} />)}
            </div>
          })}
          {(working || compacting) && (
            <div className="working" role="status">
              <span className="shimmer">{compacting ? 'Compacting context…' : 'Thinking'}</span>
            </div>
          )}
        </div>
      </div>
      {edges.bottom && <Button type="button" className={`jump-bottom${working ? ' working' : ''}`} aria-label={working ? 'Agent is working. Scroll to latest' : 'Scroll to latest'} title="Scroll to latest" onClick={scrollToLatest}>
        {working ? <span className="ramu-loader" aria-hidden="true"><i /><i /><i /></span> : <ArrowDown size={14} />}
      </Button>}
      </div>
      <div className="composer-dock">
        {error && <div className="error">{error}</div>}
        {queued.length > 0 && <div className="message-queue" aria-label="Queued messages">
          {queuePaused && <div className="message-queue-heading"><span className="muted small">Paused</span><Button className="ghost small" onClick={() => void act(() => invoke('agent.resumeQueue', view.sessionId))}>Resume messages</Button></div>}
          {queued.map((message) => {
            const text = message.text.split('\n\n<ramu-context>\n')[0] || 'Attachments'
            const recall = () => void act(async () => { await invoke('agent.removeQueued', view.sessionId, message.id); setAttachments((current) => [...current, ...(message.attachments ?? []).filter((file) => !current.some((entry) => entry.id === file.id))]); setDraft((current) => current ? `${current}\n${message.text}` : message.text) })
            // Both modes use the queue row; steering waits for the active tools to finish.
            const steerNow = () => void act(async () => { await invoke('agent.removeQueued', view.sessionId, message.id); await invoke('agent.submit', view.sessionId, message.text, 'steer', (message.attachments ?? []).map((file) => file.id), []) })
            return <div className="queued-message" key={message.id}>
              <ListEnd size={15} className="queued-icon" />
              <span className="queued-text" title={text}>{text}{message.attachments?.length ? <Attachments files={message.attachments} size="small" /> : null}</span>
              <Button className="ghost icon small-icon queued-steer" aria-label="Steer" disabled={message.mode === 'steer' || configuring || !busyAgent || !supportsSteering} title={message.mode === 'steer' ? 'Steering pending until active tools finish' : 'Send after active tools finish'} onClick={steerNow}><CornerDownRight size={14} /></Button>
              <Button className="ghost icon small-icon" disabled={configuring} aria-label="Remove queued message" title="Remove" onClick={() => void act(() => invoke('agent.removeQueued', view.sessionId, message.id))}><Trash2 size={14} /></Button>
              <Menu label="Queued message actions" icon={<MoreHorizontal size={14} />} className="ghost icon small-icon" align="end" items={[
                { key: 'edit', label: <><Pencil size={14} /> Edit message</>, onSelect: recall },
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
          chips={attached.length > 0 && <CommentsChip groups={attached} onRemove={() => void act(async () => { for (const group of attached) await invoke('reviews.select', group.review.id, group.ids, false) })} />}
          disabled={configuring || !session}
          controls={session && <><AgentControls settings={pendingSettings ?? session.settings} onChange={changeSettings} disabled={false} /></>}
          onChange={setDraft}
          onSubmit={(context) => void send(action, context)}
          onAlternateSubmit={busyAgent && supportsSteering ? (context) => void send(opposite, context) : undefined}
          alternateDisabled={configuring || !session}
          alternateLabel={opposite === 'queue' ? 'Queue' : 'Steer'}
          placeholder={live || busyAgent ? 'Reply to the agent' : 'Resume with a message'}
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
  const ref = useScrollFade<HTMLPreElement>()
  return <pre ref={ref} className="tool-output fade-scroll">{children}</pre>
}

function ToolGroup({ tools, results, cwd }: { tools: ToolUse[]; results: Map<string, ToolResult>; cwd: string }) {
  const bodyRef = useScrollFade<HTMLDivElement>()
  const running = tools.some((t) => !results.has(t.toolUseId))
  const failed = tools.some((t) => results.get(t.toolUseId)?.isError)
  const Icon = tools.some((t) => t.name === 'Bash') ? SquareTerminal : BookOpen
  return (
    <Collapsible className={failed ? 'tool-group error' : 'tool-group'} defaultOpen={running}>
      <CollapsibleTrigger render={<Button variant="ghost" />}>
        <Icon size={14} className={running ? 'tool-icon running' : 'tool-icon'} />
        <span className="tool-group-label">{describeTools(tools, running)}</span>
        <ChevronRight size={13} className="caret" />
      </CollapsibleTrigger>
      <CollapsibleContent className="tool-disclosure-panel"><div ref={bodyRef} className="tool-group-body fade-scroll">
        {tools.map((t) => {
          const r = results.get(t.toolUseId)
          const summary = t.summary.split(`${cwd}/`).join('')
          const bash = t.name === 'Bash'
          return (
            <Collapsible key={t.toolUseId} className="tool">
              <CollapsibleTrigger render={<Button variant="ghost" />}>
                {bash ? <SquareTerminal size={14} className="tool-icon" /> : <BookOpen size={14} className="tool-icon" />}
                <span className="tool-summary">{TOOL_VERB[t.name] ?? toolLabel(t.name)} {summary}</span>
                <ChevronRight size={12} className="caret" />
              </CollapsibleTrigger>
              <CollapsibleContent className="tool-disclosure-panel"><div className="tool-card">
                <div className="tool-card-title">{bash ? 'Shell' : toolLabel(t.name)}</div>
                <ShadowPre>{bash ? `$ ${summary}\n` : ''}{r ? r.summary || 'No output' : 'Running…'}</ShadowPre>
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
  const ws = useWorkspace()
  const local = href && localFileLink(href)
  const external = href && /^https?:\/\//i.test(href)
  return <a href={href} target={external ? '_blank' : undefined} rel={external ? 'noreferrer' : undefined} title={local ? `Open ${href} in editor` : undefined} onClick={local ? (event) => {
    event.preventDefault()
    if (!taskId || !href) return
    void invoke('files.resolveLink', taskId, href).then((file) => {
      if (!file) throw new Error('This file was not found in this chat’s folders, or the path matches more than one file.')
      ws.openView(taskId, { kind: 'file', repoId: file.repoId, path: file.path, preview: false, ...(file.line ? { selection: { line: file.line, column: file.column ?? 1, endColumn: file.column ?? 1, requestId: crypto.randomUUID() } } : {}) })
    }).catch((error) => notifyError(errorText(error), 'Open file'))
  } : undefined}>{children}</a>
}

function AssistantText({ event: e, generating, actions, latest = false, taskId }: { event: Extract<AgentEvent, { kind: 'text' }>; generating: boolean; actions: boolean; latest?: boolean; taskId?: string }) {
  const text = useTypewriter(e.text, generating)
  return (
    <div className={`msg assistant${generating ? ' generating' : ''}`}>
      <Markdown remarkPlugins={[remarkGfm]} urlTransform={(url) => localFileLink(url) ? url : defaultUrlTransform(url)} components={{ ...(generating ? STREAMING : {}), a: ({ href, children }) => <ChatLink href={href} taskId={taskId}>{children}</ChatLink> }}>{text}</Markdown>
      {actions && !generating && <div className={`msg-actions${latest ? ' always' : ''}`}><MessageTime at={e.at} /><CopyButton text={e.text} /></div>}
    </div>
  )
}

function MessageTime({ at }: { at?: number }) {
  if (!at) return null
  const date = new Date(at)
  return <time className="msg-time" dateTime={date.toISOString()} title={date.toLocaleString()}>{date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time>
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <Button
      className="ghost icon small-icon copy-btn"
      aria-label="Copy"
      title="Copy"
      onClick={() => {
        void copyText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1200) }, (error) => notifyError(errorText(error), 'Copy message'))
      }}
    >
      {done ? <Check size={14} /> : <Copy size={14} />}
    </Button>
  )
}

function Outcome({ outcome }: { outcome: string | undefined }) {
  if (!outcome) return null
  const text = outcome === 'allowed' ? 'Allowed' : outcome === 'denied' ? 'Denied' : outcome === 'answered' ? 'Answered' : 'Cancelled'
  return <div className="outcome">{text}</div>
}

function EventRow({ event: e, sessionId, taskId, live, generating = false, outcomes, actions = false, latest = false, onEdit }: { event: AgentEvent; sessionId: string; taskId?: string; live: boolean; generating?: boolean; outcomes: Map<string, string>; actions?: boolean; latest?: boolean; onEdit?: (text: string, attachments: Attachment[]) => void }) {
  switch (e.kind) {
    case 'compaction':
      return e.state === 'started' ? null : <div className={`compaction-separator${e.state === 'failed' ? ' error' : ''}`} role="status"><span><Minimize2 size={14} />{compactionLabel(e)}</span></div>
    case 'schedule':
      return <ScheduleChatCard schedule={e.schedule} />
    case 'settings':
      return <div className="conversation-separator"><span>{providerName(e.settings.provider)} · {e.settings.model || 'Default model'} · {e.settings.effort || 'Default effort'} · {accessName(e.settings.access)}{e.settings.provider === 'codex' && ` · ${e.settings.serviceTier === 'fast' ? 'Fast' : 'Standard'}`}<small>{e.reason}{e.handoff ? ' · Conversation context handed over' : ''}</small></span></div>
    case 'user':
      if (!e.text.split('\n\n<ramu-context>\n')[0] && !e.attachments?.length && !sentComments(e.text).length) return null
      return <div className="msg-wrap user">
        {e.attachments?.length ? <Attachments files={e.attachments} /> : null}
        {e.text.split('\n\n<ramu-context>\n')[0] ? <div className="msg user">{e.text.split('\n\n<ramu-context>\n')[0]}</div> : null}
        {sentComments(e.text).length > 0 && <div className="sent-comments">{sentComments(e.text).map((c, i) => <div key={i} className="sent-comment"><div className="comments-popover-where"><span className="review-note-where">{c.label}</span><span className="comments-popover-file" title={c.path}>{c.path}</span></div><p>{c.text}</p></div>)}</div>}
        <div className={`msg-actions${latest ? ' always' : ''}`}><MessageTime at={e.at} /><CopyButton text={e.text.split('\n\n<ramu-context>\n')[0] ?? ''} />{onEdit && <Button className="ghost icon small-icon copy-btn" aria-label="Edit message" title="Edit and send again" onClick={() => onEdit(e.text.split('\n\n<ramu-context>\n')[0] ?? '', e.attachments ?? [])}><Pencil size={14} /></Button>}</div>
      </div>
    case 'text':
      return <AssistantText event={e} generating={generating} actions={actions} latest={latest} taskId={taskId} />
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
                Allow
              </Button>
              <Button onClick={() => void invoke('agent.replyPermission', sessionId, e.requestId, false)}>Deny</Button>
            </div>
          ) : (
            <Outcome outcome={outcomes.get(e.requestId)} />
          )}
        </div>
      )
    }
    case 'question':
      return <QuestionCard sessionId={sessionId} requestId={e.requestId} questions={e.questions} pending={live && !outcomes.has(e.requestId)} outcome={outcomes.get(e.requestId)} />
    case 'result':
      return e.isError ? <div className="turn-end error"><CircleAlert size={13} />The agent reported a failure.</div> : null
    case 'error':
      return <div className="msg error">{e.message}</div>
    default:
      return null
  }
}

function QuestionCard({
  sessionId,
  requestId,
  questions,
  pending,
  outcome,
}: {
  sessionId: string
  requestId: string
  questions: AgentQuestion[]
  pending: boolean
  outcome: string | undefined
}) {
  const [answers, setAnswers] = useState<Record<string, string[]>>({})
  const toggle = (q: AgentQuestion, label: string) =>
    setAnswers((a) => {
      const cur = a[q.question] ?? []
      return { ...a, [q.question]: q.multiSelect ? (cur.includes(label) ? cur.filter((x) => x !== label) : [...cur, label]) : [label] }
    })
  return (
    <div className={pending ? 'card pending' : 'card'}>
      {questions.map((q) => (
        <fieldset key={q.question} disabled={!pending}>
          <legend>{q.question}</legend>
          {q.options.map((o) => (
            <label key={o.label} className="option">
              <Input type={q.multiSelect ? 'checkbox' : 'radio'} checked={(answers[q.question] ?? []).includes(o.label)} onChange={() => toggle(q, o.label)} />
              <span>
                {o.label}
                {o.description && <span className="muted"> {o.description}</span>}
              </span>
            </label>
          ))}
        </fieldset>
      ))}
      {pending ? (
        <Button
          className="primary"
          disabled={questions.some((q) => !(answers[q.question] ?? []).length)}
          onClick={() =>
            void invoke(
              'agent.replyQuestion',
              sessionId,
              requestId,
              Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, v.join(', ')])),
            )
          }
        >
          Send answers
        </Button>
      ) : (
        <Outcome outcome={outcome} />
      )}
    </div>
  )
}
