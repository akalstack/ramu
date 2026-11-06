import type { AgentEvent } from '@ramu/shared/types'
import { interactiveRevisions, interactiveSuccessor, interactiveUpdates } from '@ramu/shared/interactiveRevisions'
import { helperGroups } from '@ramu/shared/chat/helperPresentation'
import { toolKind } from '@ramu/shared/chat/agentTools'
import { visibleMessage } from '@ramu/shared/chat/visibleMessage'
import { resultStopped } from '@ramu/shared/chat/turnResult'
import { describeRamuTool, isAbilityToolCall, ramuTool, ramuToolHasOwnUi } from '@ramu/shared/chat/ramuTools'
import { fileToolDiffs, fileToolLine } from '@ramu/shared/chat/fileTools'
import type { Chat, ToolKind, TranscriptItem } from './types'
import type { OutboxItem } from './store'
import {
  advisorTranscript,
  parseAdvice,
  parseTaskMessage,
  parseTaskReport,
  parseTaskStop,
} from '@ramu/shared/chat/agentTasks'
import { requestOutcomes, parseAnswerMessage, questionState } from '@ramu/shared/chat/questions'
import { goalChanges, goalFactLines } from '@ramu/shared/chat/goalHistory'
import { providerWaitState, type ProviderWaitState } from '@ramu/shared/chat/providerWait'
import { foldSettingsChanges } from '@ramu/shared/chat/settingsChanges'

/**
 * The line for a thread at a provider's usage limit. It names the cause and says the thread continues; "Paused" stays
 * for a goal the user paused themselves. A guessed time is not shown as a reset.
 */
const isToolKind = (kind: string): kind is ToolKind =>
  ['read', 'edit', 'search', 'execute', 'think', 'fetch'].includes(kind)

export function limitNoteTitle(wait: Pick<ProviderWaitState, 'retryAt' | 'guessed'>): string {
  if (wait.guessed) return 'Limit reached · resuming automatically'
  const at = new Date(wait.retryAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return `Limit reached · resumes around ${at}`
}

/** What the person typed, without what Ramu added around it for the agent, as on the desktop. */
export const visibleText = (text: string) => visibleMessage(text)

/** Mutable text stays off screen until the next block, tool, request or end of the turn. */
function pendingTextBlocks(events: AgentEvent[]): Set<number> {
  const pending = new Map<string, number>()
  events.forEach((event, index) => {
    const lane = event.agentId ?? ''
    if (event.kind === 'text') pending.set(lane, index)
    else if (
      ['user', 'tool-use', 'tool-result', 'content', 'question', 'permission-request', 'result', 'error'].includes(
        event.kind,
      )
    )
      pending.delete(lane)
    else if (event.kind === 'state' && !['running', 'starting'].includes(event.state)) {
      if (!event.agentId) pending.clear()
      else pending.delete(lane)
    }
  })
  return new Set(pending.values())
}

export function transcript(events: AgentEvent[], seqs?: number[], completeBlocksOnly = false): TranscriptItem[] {
  const pending = completeBlocksOnly ? pendingTextBlocks(events) : new Set<number>()
  const items: TranscriptItem[] = []
  const positions = new Map<TranscriptItem, number>()
  const latestPermissions = new Map<string, number>()
  events.forEach((event, index) => {
    if (event.kind === 'permission-request') latestPermissions.set(event.requestId, index)
  })
  const resolved = requestOutcomes(events)
  const answers = new Map<string, Record<string, string>>()
  const results = new Map<string, Extract<AgentEvent, { kind: 'tool-result' }>>()
  const helperEvents = new Map<string, AgentEvent[]>()
  const goals = goalChanges(events)
  const revisions = interactiveRevisions(events)
  const updates = interactiveUpdates(events)
  // The row of each document's newest version, so an older row can scroll to it.
  const latestItem = new Map<string, string>()
  events.forEach((e, index) => {
    if (e.kind === 'interactive' && revisions.get(e.reference.id)?.latest.version === e.reference.version)
      latestItem.set(e.reference.id, `event-${index}`)
  })
  for (const e of events) {
    if (e.kind === 'question-state' && e.answers)
      answers.set(e.requestId, { ...answers.get(e.requestId), ...e.answers })
    if (e.kind === 'tool-result') results.set(`${e.agentId ?? ''}:${e.toolUseId}`, e)
    if (e.agentId && e.kind !== 'agent') {
      const own = helperEvents.get(e.agentId) ?? []
      own.push(e)
      helperEvents.set(e.agentId, own)
    }
  }
  events.forEach((e, index) => {
    if (pending.has(index)) return
    if (e.agentId && e.kind !== 'agent') return
    const id = `event-${index}`
    const before = items.length
    if (
      e.kind === 'user' &&
      !e.agentId &&
      (parseTaskReport(e.text) ||
        parseAdvice(e.text) ||
        parseTaskStop(e.text) ||
        parseTaskMessage(e.text) ||
        parseAnswerMessage(e.text))
    ) {
      // Messages Ramu writes on your behalf are status lines, not something you typed, as on the desktop.
      const report = parseTaskReport(e.text),
        advice = parseAdvice(e.text),
        stop = parseTaskStop(e.text),
        relay = parseTaskMessage(e.text),
        answers = parseAnswerMessage(e.text)
      items.push(
        report
          ? { kind: 'report', id, name: report.name, verb: report.verb, body: report.body }
          : advice
            ? {
                kind: 'note',
                id,
                title: advice.failed ? `The advisor could not answer: ${advice.body}` : 'Advice delivered to the agent',
                detail: advice.advisor,
                failed: advice.failed,
              }
            : stop
              ? { kind: 'note', id, title: `Asked the agent to stop ${stop.name}` }
              : relay
                ? { kind: 'note', id, title: `Message to ${relay.name}`, detail: relay.body }
                : ({
                    kind: 'note',
                    id,
                    title: "Answers to the agent's questions",
                    detail: answers!.body,
                  } as TranscriptItem),
      )
    } else if (e.kind === 'teammate-message') {
      // What you wrote to a teammate, so its report reads after the request, as on the desktop.
      items.push({ kind: 'teammate-message', id, teammateId: e.teammateId, name: e.name, text: e.text, at: e.at })
    } else if (e.kind === 'goal' && goals.has(e)) {
      const { type, goal } = goals.get(e)!
      const verb = {
        set: 'Goal set',
        edited: 'Goal edited',
        paused: 'Goal paused',
        resumed: 'Goal resumed',
        blocked: 'Goal blocked',
        stalled: 'No progress',
        'verify-failed': 'Verification failed',
        'turn-limit': 'Goal reached its turn limit',
        cleared: 'Goal cleared',
      }[type]
      // A failed check and a stall say what happened beneath the title; the others name the goal.
      const facts = type === 'verify-failed' ? goalFactLines(goal) : type === 'stalled' ? [goal.reason] : []
      items.push({
        kind: 'note',
        id,
        title: verb,
        goalNote: type,
        detail: facts.length ? facts.join('\n') : goal.objective,
        failed: type === 'blocked' || type === 'stalled' || type === 'verify-failed',
      })
    } else if (e.kind === 'schedule')
      items.push({
        kind: 'note',
        id,
        title: `Schedule created: ${e.schedule.name}`,
        detail: e.schedule.state === 'paused' ? 'Paused' : undefined,
      })
    else if (e.kind === 'user')
      items.push({
        kind: 'user',
        id,
        text: visibleText(e.text),
        at: e.at ?? 0,
        attachments: e.attachments,
        seq: seqs?.[index],
        raw: e.text,
      })
    else if (e.kind === 'interactive') {
      const revision = revisions.get(e.reference.id)
      const replaced = revision && revision.latest.version > e.reference.version
      items.push({
        kind: 'interactive',
        id,
        reference: e.reference,
        ...(replaced
          ? {
              replacedBy: {
                itemId: latestItem.get(e.reference.id) ?? id,
                version: revision.latest.version,
                changes: interactiveSuccessor(e.reference, revision)?.changes,
              },
            }
          : {
              previous: revision?.versions.find((entry) => entry.version < e.reference.version),
              update: updates.get(e.reference.id),
            }),
      })
    } else if (e.kind === 'theme') items.push({ kind: 'theme', id, theme: e.theme })
    else if (e.kind === 'ability') items.push({ kind: 'ability', id, call: e.call })
    else if (e.kind === 'threads-started') items.push({ kind: 'threads', id, threads: e.threads })
    else if (e.kind === 'continued') items.push({ kind: 'continued', id, event: e })
    // A block can open empty as a reply starts; an empty row would blink in and out at the end of the chat.
    else if (e.kind === 'text') {
      if (e.text.trim()) items.push({ kind: 'text', id, text: e.text })
    } else if (e.kind === 'thinking' && e.text.trim()) items.push({ kind: 'thinking', id, text: e.text })
    else if (e.kind === 'error') items.push({ kind: 'error', id, message: e.message })
    else if (e.kind === 'content') {
      const text = e.content
        .filter((c) => c.type !== 'image')
        .map((c) =>
          'text' in c && typeof c.text === 'string'
            ? c.text
            : c.type === 'resource'
              ? c.name
              : c.type === 'unsupported'
                ? c.label
                : '',
        )
        .filter(Boolean)
        .join('\n')
      if (text) items.push({ kind: 'text', id, text })
      e.content.forEach((c, n) => {
        if (c.type === 'image' && (c.data || c.uri))
          items.push({
            kind: 'image',
            id: `${id}-img-${n}`,
            uri: c.data ? `data:${c.mimeType};base64,${c.data}` : c.uri!,
            alt: c.alt,
          })
      })
    } else if (e.kind === 'plan')
      items.push({
        kind: 'plan',
        id,
        entries: e.entries,
      })
    else if (e.kind === 'tool-use') {
      const result = results.get(`:${e.toolUseId}`)
      const failedCall = result ? result.isError : e.status === 'failed'
      // As on desktop, a question, goal, schedule or sub-agent call has its own place in the chat; a failed one stays.
      if (ramuToolHasOwnUi(e) && !failedCall) return
      // An ability call's own row stands for it, refusals included.
      if (isAbilityToolCall(e)) return
      const call = ramuTool(e)
      const ramu = call ? describeRamuTool(call, result?.summary) : undefined
      // As on desktop, file tools say only the file's name (and an edit its +/- lines) until opened.
      const file = ramu ? null : fileToolLine(e, result)
      const kind = toolKind(e)
      items.push({
        kind: 'tool',
        id: e.toolUseId,
        tool: isToolKind(kind) ? kind : 'other',
        verb: file?.verb ?? e.name,
        subject: file ? `${file.name}${file.others ? ` +${file.others}` : ''}` : e.title || e.summary,
        ...(ramu ? { ramu: { done: ramu.done, running: ramu.running, subject: ramu.subject, facts: ramu.facts } } : {}),
        ...(file ? { file, diffs: fileToolDiffs(e, result) } : {}),
        status: result
          ? result.isError
            ? 'failed'
            : result.running
              ? 'in_progress'
              : 'completed'
          : e.status === 'failed'
            ? 'failed'
            : 'in_progress',
        detail: result?.summary,
        input: e.input,
      })
    } else if (e.kind === 'question')
      items.push({
        kind: 'question',
        id: e.requestId,
        questions: e.questions.filter(
          (q) => resolved.has(e.requestId) || !answers.get(e.requestId)?.[q.id ?? q.question],
        ),
        submitted: answers.get(e.requestId),
        answers: resolved.has(e.requestId) ? (answers.get(e.requestId) ?? {}) : undefined,
        outcome: resolved.get(e.requestId),
        reason: questionState(events, e.requestId).reason,
        responseMode: e.responseMode,
        grouping: e.grouping,
      })
    else if (e.kind === 'permission-request' && latestPermissions.get(e.requestId) === index)
      items.push({
        kind: 'permission',
        id: e.requestId,
        title: e.title,
        command: e.detail,
        decision: resolved.has(e.requestId)
          ? /allow|approv/.test(resolved.get(e.requestId)!)
            ? 'allow'
            : 'deny'
          : undefined,
        ...(resolved.get(e.requestId) === 'allowed-project'
          ? { saved: 'project' as const }
          : resolved.get(e.requestId) === 'allowed-user'
            ? { saved: 'user' as const }
            : {}),
        ...(e.approvalKey && !e.approvalOnceOnly ? { rememberable: { project: !!e.approvalProjectId } } : {}),
        ...(e.approvalPatterns?.length ? { patterns: e.approvalPatterns } : {}),
        ...(e.approvalReviewRule ? { reviewRule: e.approvalReviewRule } : {}),
      })
    else if (e.kind === 'elicitation')
      items.push({ kind: 'elicitation', id: e.requestId, request: e, outcome: resolved.get(e.requestId) })
    else if (e.kind === 'secret-request')
      items.push({ kind: 'secret', id: e.requestId, request: e, outcome: resolved.get(e.requestId) })
    else if (e.kind === 'goal' && e.goal?.status === 'completed')
      items.push({
        kind: 'goal',
        id,
        objective: e.goal.objective,
        turns: e.goal.turns,
        ...(goalFactLines(e.goal).length ? { detail: goalFactLines(e.goal).join('\n') } : {}),
      })
    else if (e.kind === 'settings')
      items.push({
        kind: 'note',
        id,
        title: '',
        detail: e.reason + (e.handoff ? ' · Conversation context handed over' : ''),
        settings: e.settings,
        previous: e.previous,
      })
    else if (e.kind === 'background-terminal-stop')
      items.push({ kind: 'note', id, title: 'Background command stop requested', detail: e.command })
    else if (e.kind === 'recovery') items.push({ kind: 'note', id, title: 'Continued after restart' })
    else if (e.kind === 'compaction' && e.state !== 'started')
      items.push({
        kind: 'note',
        id,
        title:
          e.state === 'failed'
            ? 'Could not compact the conversation'
            : e.beforeTokens && e.afterTokens
              ? `Conversation compacted · ${Math.round(e.beforeTokens / 1000)}k → ${Math.round(e.afterTokens / 1000)}k tokens`
              : 'Conversation compacted',
        failed: e.state === 'failed',
      })
    else if (e.kind === 'result') items.push({ kind: 'end', id, ended: true, interrupted: resultStopped(e) })
    else if (e.kind === 'state' && ['idle', 'failed', 'stopped'].includes(e.state))
      items.push({ kind: 'end', id, ended: false, interrupted: false })
    // Keep exact event positions even for requests whose IDs are provider-owned.
    for (let i = before; i < items.length; i++) {
      items[i] = {
        ...items[i]!,
        ...(e.at !== undefined ? { at: e.at } : {}),
        ...(e.requestSource ? { requestSource: e.requestSource } : {}),
      } as TranscriptItem
      positions.set(items[i]!, index)
    }
  })
  // A thread held at a provider's usage limit, as the desktop shows it: only while nothing has happened since.
  const lastWait = events.findLastIndex((e) => e.kind === 'provider-wait')
  const wait = providerWaitState(events)
  if (
    wait &&
    !events
      .slice(lastWait + 1)
      .some(
        (e) =>
          !e.agentId &&
          (e.kind === 'text' ||
            e.kind === 'tool-use' ||
            e.kind === 'result' ||
            e.kind === 'user' ||
            (e.kind === 'state' && e.state !== 'running' && e.state !== 'starting')),
      )
  )
    items.push({
      kind: 'note',
      id: `wait-${lastWait}`,
      wait: true,
      limit: { retryAt: wait.retryAt, guessed: wait.guessed, ...(wait.provider ? { provider: wait.provider } : {}) },
      title: limitNoteTitle(wait),
    })
  const groups = helperGroups(events).groups
  // Insert at the launch point, rather than append every helper from the thread's lifetime.
  for (const group of [...groups].reverse()) {
    const row: TranscriptItem = {
      kind: 'agents',
      id: group.id,
      advisor: group.advisor,
      earlier: group.anchor === null,
      agents: group.tasks.map((task) => {
        const own =
          task.taskType === 'advisor' ? advisorTranscript(events, task.agentId) : (helperEvents.get(task.agentId) ?? [])
        const log = own
          .flatMap((e) => (e.kind === 'text' ? [e.text] : e.kind === 'error' ? [`Error: ${e.message}`] : []))
          .join('\n\n')
        return { ...task, id: task.agentId, type: task.agentType ?? task.taskType ?? '', log }
      }),
    }
    const next = items.findIndex((item) => (positions.get(item) ?? -1) > group.launchIndex)
    items.splice(group.anchor === null || next < 0 ? items.length : next, 0, row)
  }
  return foldSettingsChanges(
    items,
    (item) => (item.kind === 'note' && item.settings ? { settings: item.settings, previous: item.previous } : null),
    (first, last) => (first.kind === 'note' && last.kind === 'note' ? { ...last, previous: first.previous } : last),
  )
}

/** Snapshot the existing occurrences so repeated messages cannot match old history. */
/** How a run of a message's text is drawn while it is open for selecting. */
export type ReadableStyle = 'body' | 'strong' | 'em' | 'code' | 'heading' | 'marker'
export interface ReadableRun {
  text: string
  style: ReadableStyle
}

const INLINE =
  /(\*\*|__)(.+?)\1|`([^`\n]+)`|~~(.+?)~~|!?\[([^\]]*)\]\([^)]*\)|(^|[\s(])[*_]([^\s*_][^*_\n]*?)[*_](?=[\s).,!?:;]|$)/g

function inlineRuns(line: string, base: ReadableStyle, out: ReadableRun[]) {
  let at = 0
  for (const match of line.matchAll(INLINE)) {
    const lead = match[6] ?? ''
    const start = match.index + lead.length
    if (start > at || lead) out.push({ text: line.slice(at, match.index) + lead, style: base })
    if (match[2] !== undefined) out.push({ text: match[2], style: base === 'heading' ? 'heading' : 'strong' })
    else if (match[3] !== undefined) out.push({ text: match[3], style: 'code' })
    else if (match[4] !== undefined) out.push({ text: match[4], style: base })
    else if (match[5] !== undefined) out.push({ text: match[5], style: base })
    else out.push({ text: match[7]!, style: base === 'heading' ? 'heading' : 'em' })
    at = match.index + match[0].length
  }
  if (at < line.length) out.push({ text: line.slice(at), style: base })
}

/**
 * A message as it reads, in styled runs: Markdown marks become the look they stand for (a heading, bold, code, a bullet),
 * so the text opened for selecting looks like the message and what is copied is what was read.
 */
export function readableRuns(markdown: string): ReadableRun[] {
  const out: ReadableRun[] = []
  let fenced = false
  const lines = markdown.replace(/\r\n?/g, '\n').trim().split('\n')
  lines.forEach((raw, index) => {
    if (index) out.push({ text: '\n', style: 'body' })
    if (/^ {0,3}(```|~~~)/.test(raw)) {
      fenced = !fenced
      out.pop()
      return
    }
    if (fenced) return void out.push({ text: raw, style: 'code' })
    if (/^ {0,3}([-*_])( *\1){2,} *$/.test(raw)) return
    let line = raw.replace(/^ {0,3}>\s?/, '')
    const heading = /^ {0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line)
    if (heading) return inlineRuns(heading[1]!, 'heading', out)
    const item = /^(\s*)([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/.exec(line)
    if (item) {
      const marker = /\d/.test(item[2]!) ? item[2]! : '•'
      out.push({ text: `${item[1]!.replace(/\t/g, '  ')}${marker} `, style: 'marker' })
      line = line.slice(item[0].length)
    }
    inlineRuns(line, 'body', out)
  })
  // Neighbouring runs of one look join, and blank runs between blocks stay single blank lines.
  const joined: ReadableRun[] = []
  for (const run of out) {
    const last = joined.at(-1)
    if (last && last.style === run.style) last.text += run.text
    else if (run.text) joined.push({ ...run })
  }
  // A fence on the first or last line leaves a bare line break at that end.
  if (joined[0]) joined[0].text = joined[0].text.replace(/^\n+/, '')
  if (joined.at(-1)) joined.at(-1)!.text = joined.at(-1)!.text.replace(/\n+$/, '')
  return joined.filter((run) => run.text)
}

/** A message's text as it reads, without Markdown marks. */
export const readableText = (markdown: string): string =>
  readableRuns(markdown)
    .map((run) => run.text)
    .join('')
    .replace(/\n{3,}/g, '\n\n')

export function deliveryBaseline(chat: Chat, text: string) {
  const shown = visibleText(text)
  return {
    userCount: (chat.items ?? []).filter((row) => row.kind === 'user' && row.text === shown).length,
    queueIds: (chat.queue ?? []).filter((row) => visibleText(row.text) === shown).map((row) => row.id),
  }
}

export function deliveryVisible(item: OutboxItem, chat: Chat): boolean {
  if (!item.deliveryBaseline) return false
  const shown = visibleText(item.text)
  return (
    (chat.items ?? []).filter((row) => row.kind === 'user' && row.text === shown).length >
      item.deliveryBaseline.userCount ||
    (chat.queue ?? []).some(
      (row) => visibleText(row.text) === shown && !item.deliveryBaseline!.queueIds.includes(row.id),
    )
  )
}

/** An acknowledgement alone cannot remove the only visible copy of a message. */
/** How long an acknowledged message may hold its host's queue while its history entry has not appeared. */
export const ACCEPTED_HOLD_MS = 60_000

/** An accepted message holds later sends to its host only briefly: the host already has it. */
export function holdsQueue(item: OutboxItem, now = Date.now()): boolean {
  // One saved before acknowledgements carried a time is already past its hold.
  return item.state === 'accepted' && item.acceptedAt !== undefined && now - item.acceptedAt < ACCEPTED_HOLD_MS
}

/**
 * Drops acknowledged messages once their thread shows them or once the hold has passed. Keeping one forever would
 * stop every later message to that host.
 */
export function reconcileDelivered(outbox: OutboxItem[], chats: Chat[], now = Date.now()): OutboxItem[] {
  return outbox.filter((item) => {
    if (item.state !== 'accepted') return true
    if (!holdsQueue(item, now)) return false
    // A refresh can briefly leave the thread out; the hold above still bounds how long that keeps it.
    const chat = chats.find((chat) => chat.id === item.chatId)
    return !chat || !deliveryVisible(item, chat)
  })
}
