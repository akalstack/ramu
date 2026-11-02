import type { AgentEvent } from '@ramu/shared/types'
import { helperGroups } from '@ramu/shared/chat/helperPresentation'
import { toolKind } from '@ramu/shared/chat/agentTools'
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

/** What the person typed: the file context Ramu appends for the agent (`<ramu-context>…`) is hidden, as on the desktop. */
export const visibleText = (text: string) => text.split(/\n*<ramu-context>/)[0]!.trimEnd()

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
          ? { kind: 'text', id, text: `**${report.name}** ${report.verb}\n\n${report.body}` }
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
    else if (e.kind === 'interactive') items.push({ kind: 'interactive', id, reference: e.reference })
    else if (e.kind === 'theme') items.push({ kind: 'theme', id, theme: e.theme })
    else if (e.kind === 'threads-started') items.push({ kind: 'threads', id, threads: e.threads })
    else if (e.kind === 'continued') items.push({ kind: 'continued', id, event: e })
    else if (e.kind === 'text') items.push({ kind: 'text', id, text: e.text })
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
      // As on desktop, file tools say only the file's name (and an edit its +/- lines) until opened.
      const file = fileToolLine(e, result)
      const kind = toolKind(e)
      items.push({
        kind: 'tool',
        id: e.toolUseId,
        tool: isToolKind(kind) ? kind : 'other',
        verb: file?.verb ?? e.name,
        subject: file ? `${file.name}${file.others ? ` +${file.others}` : ''}` : e.title || e.summary,
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
      })
    else if (e.kind === 'elicitation')
      items.push({ kind: 'elicitation', id: e.requestId, request: e, outcome: resolved.get(e.requestId) })
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
    else if (e.kind === 'result')
      items.push({ kind: 'end', id, ended: true, interrupted: e.isError || /interrupt|abort/i.test(e.text) })
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
  return items
}

/** Snapshot the existing occurrences so repeated messages cannot match old history. */
/** A message as a person reads it, without Markdown's marks: what a selection in the thread shows and quotes. */
export function readableText(markdown: string): string {
  return markdown
    .replace(/^ {0,3}```.*$\n?/gm, '')
    .replace(/^ {0,3}#{1,6}\s+/gm, '')
    .replace(/^ {0,3}>\s?/gm, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|~~|`)(.+?)\1/g, '$2')
    .replace(/(^|[\s(])[*_]([^\s*_][^*_\n]*)[*_](?=[\s).,!?:;]|$)/gm, '$1$2')
    .trim()
}

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
export function reconcileDelivered(outbox: OutboxItem[], chats: Chat[]): OutboxItem[] {
  return outbox.filter((item) => {
    const chat = chats.find((chat) => chat.id === item.chatId)
    return item.state !== 'accepted' || !chat || !deliveryVisible(item, chat)
  })
}
