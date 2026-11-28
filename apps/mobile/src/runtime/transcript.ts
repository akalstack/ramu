import { mcpToolWords } from '@ramu/shared/chat/mcpToolWords'
import { commandLine } from '@ramu/shared/chat/commandLine'
import type { AgentContent, AgentEvent } from '@ramu/shared/types'
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
import {
  answerChoices,
  answerPairs,
  requestOutcomes,
  parseAnswerMessage,
  questionState,
} from '@ramu/shared/chat/questions'
import { latestSurfaces, parseInlineUiActionMessage } from '@ramu/shared/chat/inlineUi'
import { GOAL_NOTE_LABELS, goalChanges, goalFactLines } from '@ramu/shared/chat/goalHistory'
import { compactionCounts } from '@ramu/shared/chat/compaction'
import { providerWaitState, type ProviderWaitState } from '@ramu/shared/chat/providerWait'
import { foldSettingsChanges } from '@ramu/shared/chat/settingsChanges'
import { foldRepeats } from '@ramu/shared/chat/repeats'
import type { TranslationValues } from '@ramu/shared/i18n'

/**
 * The line for a thread at a provider's usage limit. It names the cause and says the thread continues; "Paused" stays
 * for a goal the user paused themselves. A guessed time is not shown as a reset.
 */
const isToolKind = (kind: string): kind is ToolKind =>
  ['read', 'edit', 'search', 'execute', 'think', 'fetch'].includes(kind)

export function limitNoteTitle(wait: Pick<ProviderWaitState, 'retryAt' | 'guessed'>): string {
  return limitNote(wait).title
}

function limitNote(wait: Pick<ProviderWaitState, 'retryAt' | 'guessed'>) {
  if (wait.guessed) return noteTitle('Limit reached · resuming automatically')
  const at = new Date(wait.retryAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return noteTitle('Limit reached · resumes around {0}', { 0: at })
}

/**
 * A note's title in English, plus the catalog copy it came from, so the transcript can draw it in the app language
 * while search and previews keep reading the English title.
 */
// Node tests import this file directly, which cannot load the shared translator, so English is filled here.
const english = (text: string, values: TranslationValues = {}) =>
  text.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : placeholder,
  )

function noteTitle(text: string, values: TranslationValues = {}) {
  return { title: english(text, values), titleCopy: { text, values } }
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

/**
 * Sent answers as the note shows them: each question, then every choice it offered with the picked ones marked, so the
 * answer reads in context. A question without choices shows the answer as typed.
 */
function answersDetail(events: AgentEvent[], answers: { requestId: string; body: string }): string {
  const asked = events.find((e) => e.kind === 'question' && e.requestId === answers.requestId)
  const questions = asked?.kind === 'question' ? asked.questions : []
  return answerPairs(answers.body)
    .map((pair) => {
      const choices = answerChoices(
        questions.find((q) => q.question === pair.question),
        pair.answer,
      )
      const lines = choices
        ? [
            ...choices.options.map((option) => `${option.chosen ? '✓' : '·'} ${option.label}`),
            ...(choices.typed ? [choices.typed] : []),
          ]
        : [pair.answer]
      return [...(pair.question ? [pair.question] : []), ...lines].join('\n')
    })
    .join('\n\n')
}

export function transcript(events: AgentEvent[], seqs?: number[], completeBlocksOnly = false): TranscriptItem[] {
  const pending = completeBlocksOnly ? pendingTextBlocks(events) : new Set<number>()
  const items: TranscriptItem[] = []
  const positions = new Map<TranscriptItem, number>()
  const latestPermissions = new Map<string, number>()
  events.forEach((event, index) => {
    if (event.kind === 'permission-request') latestPermissions.set(event.requestId, index)
  })
  // Where the thread's own agent last wrote text or ended a turn. A message from the person does not count: steering
  // arrives while a call is still running.
  const movedOn = events.findLastIndex((event) => !event.agentId && ['text', 'result', 'error'].includes(event.kind))
  const resolved = requestOutcomes(events)
  const answers = new Map<string, Record<string, string>>()
  const results = new Map<string, Extract<AgentEvent, { kind: 'tool-result' }>>()
  const helperEvents = new Map<string, AgentEvent[]>()
  const goals = goalChanges(events)
  const revisions = interactiveRevisions(events)
  const updates = interactiveUpdates(events)
  const cards = latestSurfaces(events)
  const lastHeld = events.findLastIndex((e) => e.kind === 'settings-waiting')
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
        parseAnswerMessage(e.text) ||
        parseInlineUiActionMessage(e.text))
    ) {
      // Messages Ramu writes on your behalf are status lines, not something you typed, as on the desktop.
      const report = parseTaskReport(e.text),
        advice = parseAdvice(e.text),
        stop = parseTaskStop(e.text),
        relay = parseTaskMessage(e.text),
        answers = parseAnswerMessage(e.text),
        pressed = parseInlineUiActionMessage(e.text)
      items.push(
        report
          ? { kind: 'report', id, name: report.name, verb: report.verb, body: report.body }
          : advice
            ? {
                kind: 'note',
                id,
                icon: 'advice',
                ...(advice.failed
                  ? noteTitle('The advisor could not answer: {0}', { 0: advice.body })
                  : noteTitle('Advice delivered to the agent')),
                detail: advice.advisor,
                failed: advice.failed,
              }
            : stop
              ? { kind: 'note', id, icon: 'stop', ...noteTitle('Asked the agent to stop {0}', { 0: stop.name }) }
              : relay
                ? {
                    kind: 'note',
                    id,
                    icon: 'message',
                    ...noteTitle('Message to {0}', { 0: relay.name }),
                    detail: relay.body,
                  }
                : pressed
                  ? { kind: 'note', id, icon: 'card', ...noteTitle('From a card'), detail: pressed.summary }
                  : events.some((event) => event.kind === 'question' && event.requestId === answers!.requestId)
                    ? // The question's card above already shows the answer; this line only marks when it was sent.
                      ({
                        kind: 'note',
                        id,
                        icon: 'answers',
                        ...(answerPairs(answers!.body).length === 1
                          ? noteTitle('Answered 1 question')
                          : noteTitle('Answered {0} questions', { 0: answerPairs(answers!.body).length })),
                      } as TranscriptItem)
                    : ({
                        kind: 'note',
                        id,
                        icon: 'answers',
                        ...noteTitle("Answers to the agent's questions"),
                        detail: answersDetail(events, answers!),
                      } as TranscriptItem),
      )
    } else if (e.kind === 'goal' && goals.has(e)) {
      const { type, goal } = goals.get(e)!
      const verb = GOAL_NOTE_LABELS[type]
      // A failed check and a stall say what happened beneath the title; the others name the goal.
      const facts = type === 'verify-failed' ? goalFactLines(goal) : type === 'stalled' ? [goal.reason] : []
      items.push({
        kind: 'note',
        id,
        title: verb,
        goalNote: type,
        objective: goal.objective,
        ...(facts.length ? { detail: facts.join('\n') } : {}),
        failed: type === 'blocked' || type === 'stalled' || type === 'verify-failed',
      })
    } else if (e.kind === 'schedule')
      items.push({
        kind: 'note',
        id,
        icon: 'schedule',
        ...noteTitle('Schedule created: {0}', { 0: e.schedule.name }),
        ...(e.schedule.state === 'paused' ? { detail: 'Paused', detailIsCopy: true as const } : {}),
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
        ...(e.from ? { from: e.from } : {}),
        ...(e.steered ? { steered: true as const } : {}),
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
    // A card shows once, at its newest version, as on the desktop.
    else if (e.kind === 'inline-ui') {
      if (!e.surface.deleted && cards.get(e.surface.surfaceId) === e.surface)
        items.push({ kind: 'inline-ui', id, surface: e.surface })
    } else if (e.kind === 'ability') items.push({ kind: 'ability', id, call: e.call })
    else if (e.kind === 'threads-started') items.push({ kind: 'threads', id, threads: e.threads })
    else if (e.kind === 'pull-request-writes') items.push({ kind: 'pull-request-writes', id, cardId: e.cardId })
    else if (e.kind === 'test-device-wait') items.push({ kind: 'test-device-wait', id, platform: e.platform })
    else if (e.kind === 'settings-change') items.push({ kind: 'settings-change', id, cardId: e.cardId })
    else if (e.kind === 'tool-suggestion') items.push({ kind: 'tool-suggestion', id, cardId: e.cardId })
    else if (e.kind === 'continued') items.push({ kind: 'continued', id, event: e })
    else if (e.kind === 'checkout-clash') items.push({ kind: 'checkout-clash', id, path: e.path, taskId: e.taskId })
    else if (e.kind === 'command-wait' && e.taskId) items.push({ kind: 'command-wait', id, taskId: e.taskId })
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
      const plain = mcpToolWords(e.name, e.title || e.summary)
      items.push({
        kind: 'tool',
        id: e.toolUseId,
        tool: isToolKind(kind) ? kind : 'other',
        source: {
          name: e.name,
          kind,
          summary: e.summary,
          ...(e.title ? { title: e.title } : {}),
          ...(call ? { ramu: call.name } : {}),
        },
        verb: file?.verb ?? plain.verb,
        subject: file ? `${file.name}${file.others ? ` +${file.others}` : ''}` : plain.subject,
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
            : // A call with no result is running only until the agent moves on: once it has written text after it,
              // or the turn has ended, the result is not coming (it was lost, or the call was cut short), and a row
              // that kept shimmering would say something is still running.
              index < movedOn
              ? 'completed'
              : 'in_progress',
        detail: result?.summary,
        input: e.input,
        ...toolImages(result?.content ?? e.content, file),
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
    // A request allowed on its own (a saved rule, full access) left nothing to decide; the tool row stands for it.
    else if (
      e.kind === 'permission-request' &&
      latestPermissions.get(e.requestId) === index &&
      resolved.get(e.requestId) !== 'allowed-auto'
    )
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
        ...(e.approvalFullAccess ? { fullAccess: e.approvalFullAccess } : {}),
        ...(e.approvalAlways ? { always: true } : {}),
        ...(e.productionDeploy ? { productionDeploy: true } : {}),
        ...(e.projectLocation ? { projectLocation: e.projectLocation } : {}),
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
    else if (e.kind === 'settings-waiting') {
      // Only the latest says what is held; an earlier one was applied, cancelled or replaced.
      if (e.settings && index === lastHeld)
        items.push({
          kind: 'note',
          id,
          title: '',
          detail: 'Applies when the sub-agents and background commands finish',
          detailIsCopy: true,
          settings: e.settings,
          previous: e.previous,
          held: true,
        })
    } else if (e.kind === 'settings')
      items.push({
        kind: 'note',
        id,
        title: '',
        detail: e.reason + (e.handoff ? ' · Conversation context handed over' : ''),
        settings: e.settings,
        previous: e.previous,
      })
    // These notes read as the desktop's rows do.
    else if (e.kind === 'background-terminal-stop')
      items.push({
        kind: 'note',
        id,
        icon: 'stop',
        ...noteTitle('You requested a stop for {0}', { 0: commandLine(e.command) }),
      })
    else if (e.kind === 'background-command-end')
      items.push({
        kind: 'note',
        id,
        icon: 'command',
        ...noteTitle(e.failed ? 'Background command failed: {0}' : 'Background command finished: {0}', {
          0: commandLine(e.command),
        }),
        failed: e.failed,
      })
    else if (e.kind === 'recovery')
      items.push({ kind: 'note', id, icon: 'recovery', ...noteTitle('Resumed after restart') })
    else if (e.kind === 'compaction' && e.state !== 'started') {
      const counts = compactionCounts(e)
      items.push({
        kind: 'note',
        id,
        icon: 'compaction',
        ...(e.state === 'failed'
          ? noteTitle('Context compaction failed')
          : e.state === 'cancelled'
            ? noteTitle('Context compaction cancelled')
            : e.state === 'unknown'
              ? noteTitle('Context compaction · {0}', { 0: e.providerStatus ?? 'Unknown status' })
              : e.beforeTokens && e.afterTokens
                ? noteTitle('Context compacted · {0} → {1} tokens', { 0: counts.before, 1: counts.after })
                : noteTitle('Context compacted')),
        failed: e.state === 'failed',
      })
    } else if (e.kind === 'result') items.push({ kind: 'end', id, ended: true, interrupted: resultStopped(e) })
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
      ...limitNote(wait),
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
  const settled = foldSettingsChanges(
    items,
    (item) => (item.kind === 'note' && item.settings ? { settings: item.settings, previous: item.previous } : null),
    (first, last) => (first.kind === 'note' && last.kind === 'note' ? { ...last, previous: first.previous } : last),
  )
  // As on the desktop, the same error or notice back to back reads once with its count. The desktop draws nothing for
  // the agent going idle or failing between them, so that boundary does not split a run here either.
  return foldRepeats(
    settled,
    repeatKey,
    (item, repeats) => ({ ...item, repeats }) as TranscriptItem,
    (item) => item.kind === 'end' && !item.ended,
  )
}

/** Goal, settings and limit notes carry their own state, so only plain notices and errors fold as repeats. */
function repeatKey(item: TranscriptItem): string | null {
  if (item.kind === 'error') return `error:${item.message}`
  if (item.kind !== 'note' || item.goalNote || item.settings || item.wait || item.pending) return null
  return `note:${item.title}\n${item.detail ?? ''}`
}

/** Snapshot the existing occurrences so repeated messages cannot match old history. */
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

const IMAGE_FILE = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i

/**
 * The images a tool call shows when opened, as on the desktop: what it returned (inline data, a web address or a host
 * path), or else the image file a read opened.
 */
export function toolImages(
  content: AgentContent[] | undefined,
  file: { verb: string; path: string; name: string } | null,
): { images?: { uri: string; alt?: string }[] } {
  const images = (content ?? []).flatMap((c) =>
    c.type === 'image' && (c.data || c.uri)
      ? [{ uri: c.data ? `data:${c.mimeType};base64,${c.data}` : c.uri!, ...(c.alt ? { alt: c.alt } : {}) }]
      : c.type === 'resource' && c.mimeType?.startsWith('image/') && c.blob
        ? [{ uri: `data:${c.mimeType};base64,${c.blob}`, alt: c.name }]
        : [],
  )
  if (!images.length && file?.verb === 'Read' && IMAGE_FILE.test(file.path))
    images.push({ uri: file.path, alt: file.name })
  return images.length ? { images } : {}
}
