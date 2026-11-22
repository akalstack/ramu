import type { AgentEvent, AgentProvider, AgentTask, AgentTaskStatus, AgentWork } from '../types'
import { fileToolLine } from '@ramu/shared/chat/fileTools'

// Neither SDK lets a client write to a sub-agent directly, so a message for one goes to the main
// agent, which relays it with its own tool: Claude's SendMessage or Codex's send_input.
const MESSAGE = /^Message for the agent "(.+?)" \((.+?)\)\. Relay it to that agent unchanged with [^\n]*\n\n([\s\S]*)$/

export function taskMessagePrompt(provider: AgentProvider, task: AgentTask, text: string): string {
  const address = task.address ?? task.agentId
  const tool = provider === 'codex' ? `send_input (id ${address})` : `SendMessage (to: "${address}")`
  return `Message for the agent "${task.name.replace(/"/g, "'")}" (${address}). Relay it to that agent unchanged with ${tool}, then carry on; do not act on it yourself.\n\n${text}`
}

export function taskStopPrompt(task: AgentTask): string {
  return `Stop the sub-agent "${task.name.replace(/"/g, "'")}" (${task.address ?? task.agentId}) now with close_agent, then carry on.`
}

const STOP = /^Stop the sub-agent "(.+?)" \((.+?)\) now with close_agent, then carry on\.$/
/** A stop request for a Codex sub-agent, recognised so the chat shows it as a note, not as something you typed. */
export function parseTaskStop(text: string): { name: string } | null {
  const match = STOP.exec(text)
  return match ? { name: match[1]! } : null
}

/** A relayed message, recognised so the chat can show it as addressed to the agent. */
export function parseTaskMessage(text: string): { name: string; address: string; body: string } | null {
  const match = MESSAGE.exec(text)
  return match ? { name: match[1]!, address: match[2]!, body: match[3]! } : null
}

/**
 * Progress that arrives after a sub-agent has stopped, failed or finished is stale and must not bring it back to life.
 * Only a resume that is newer than the end counts.
 */
export function isStaleProgress(
  previous: Pick<AgentTask, 'status' | 'endedAt' | 'resumedAt'> | null | undefined,
  next: Partial<Pick<AgentTask, 'status' | 'resumedAt'>>,
): boolean {
  return (
    !!previous &&
    previous.status !== 'running' &&
    next.status === 'running' &&
    !(next.resumedAt && next.resumedAt > (previous.endedAt ?? previous.resumedAt ?? 0))
  )
}

/** The latest state of every sub-agent in a transcript, in the order they started. */
export function latestTasks(events: AgentEvent[]): AgentTask[] {
  const tasks = new Map<string, AgentTask>()
  for (const event of events)
    if (event.kind === 'agent') {
      const task: AgentTask & { kind?: string; at?: number } = { ...event }
      delete task.kind
      delete task.at
      const previous = tasks.get(task.agentId)
      if (isStaleProgress(previous, task)) continue
      tasks.set(task.agentId, task)
    }
  return [...tasks.values()]
}

/** An advisor consultation's own transcript. */
export const advisorTranscript = (events: AgentEvent[], agentId: string): AgentEvent[] =>
  events.filter((event) => event.agentId === agentId && event.kind !== 'agent')

/** Parent turn state cannot settle independently owned helpers. The server records actual stops. */
export function effectiveStatus(task: AgentTask, _sessionLive: boolean): AgentTaskStatus {
  return task.status
}

// A sub-agent Ramu runs reports back to its chat through a message the chat shows as a report, not as something you typed.
const REPORT = /^\[Sub-agent "(.+?)" (finished|failed|stopped|is still working|says|asks)\]\n([\s\S]*)$/
const ANSWER_HINT = /\n\n\(Reply with answer_subagent, agent "[^"\n]*"\.\)$/

export function taskReportPrompt(name: string, status: AgentTaskStatus | 'running', text: string): string {
  const verb = status === 'completed' ? 'finished' : status === 'running' ? 'is still working' : status
  return `[Sub-agent "${name.replace(/"/g, "'")}" ${verb}]\n${text.trim() || 'It left no report.'}`
}

export function parseTaskReport(text: string): { name: string; verb: string; body: string } | null {
  const match = REPORT.exec(text)
  return match ? { name: match[1]!, verb: match[2]!, body: match[3]!.replace(ANSWER_HINT, '') } : null
}

/** A note or question a running sub-agent sends its chat before it has finished. A question tells the chat how to answer. */
export function subagentNotePrompt(name: string, kind: 'says' | 'asks', agentId: string, text: string): string {
  return `[Sub-agent "${name.replace(/"/g, "'")}" ${kind}]\n${text.trim()}${kind === 'asks' ? `\n\n(Reply with answer_subagent, agent "${agentId}".)` : ''}`
}

// Ramu's advisor shows as a card like a sub-agent; advice it delivers later arrives as a message the chat shows as a link to that card.
export const advisorAgentId = (requestId: string) => `advisor-${requestId}`
const ADVICE = /^Advice from Ramu's advisor \((.+), request ([\w-]+)\)\. [^\n]*\n\n([\s\S]*)$/
const ADVICE_FAILED =
  /^Ramu's advisor could not answer request ([\w-]+): ([\s\S]*?)\. Continue with your own judgment\.$/

export function adviceMessage(status: {
  requestId: string
  status: 'ready' | 'failed' | 'pending'
  advice?: string
  advisor?: string
  error?: string
}): string {
  return status.status === 'ready'
    ? `Advice from Ramu's advisor (${status.advisor}, request ${status.requestId}). Weigh it against what you have since learned; if work is already complete, explain any changes it calls for.\n\n${status.advice}`
    : `Ramu's advisor could not answer request ${status.requestId}: ${status.error}. Continue with your own judgment.`
}

export function parseAdvice(
  text: string,
): { requestId: string; advisor?: string; body: string; failed: boolean } | null {
  const ready = ADVICE.exec(text)
  if (ready) return { advisor: ready[1]!, requestId: ready[2]!, body: ready[3]!, failed: false }
  const failed = ADVICE_FAILED.exec(text)
  return failed ? { requestId: failed[1]!, body: failed[2]!, failed: true } : null
}

/** What a sub-agent is told, so it works as a helper and ends with something its parent can use. */
/** Appended to the agent's instructions when long commands may run in the background. */
export const BACKGROUND_PREAMBLE =
  "Long-running commands: when a command may take more than about 30 seconds (dev servers, watchers, full builds, large test suites, installs) and you have other work to do, start it in the background with your shell tool's background option instead of waiting for it. Carry on with the other work, then read its output or wait for it to finish before you rely on its result. Run short commands in the foreground."
export const SUBAGENT_PREAMBLE =
  'You are a sub-agent started by another agent that works in the same workspace. Do the task below, then finish with a concise report of what you did and found: files you changed, results, and anything left open. Ask nothing unless you are blocked; your report goes straight back to the agent that started you. While you work, message_parent sends the agent that started you a short note without stopping, and ask_parent asks it a question and waits for the answer; use ask_parent only when you cannot go on without it, and still end with your report.'

/** Files the card lists by name; the counts still cover every file. */
const WORK_PATHS = 20

/** What a helper's own session did: files its edits and writes changed with line counts, its turns and reported cost. */
export function helperWork(events: readonly AgentEvent[]): AgentWork {
  const uses = new Map<string, Extract<AgentEvent, { kind: 'tool-use' }>>()
  const files = new Set<string>()
  let added = 0
  let removed = 0
  let turns = 0
  let costUsd: number | null = null
  for (const event of events) {
    if (event.kind === 'tool-use') uses.set(event.toolUseId, event)
    else if (event.kind === 'tool-result' && !event.isError && !event.running) {
      const use = uses.get(event.toolUseId)
      const line = use && fileToolLine(use, event)
      if (!line || line.verb === 'Read') continue
      files.add(line.path)
      added += line.added ?? 0
      removed += line.removed ?? 0
    } else if (event.kind === 'result') {
      turns++
      if (event.costUsd !== null) costUsd = (costUsd ?? 0) + event.costUsd
    }
  }
  return { files: files.size, paths: [...files].slice(0, WORK_PATHS), added, removed, turns, costUsd }
}
