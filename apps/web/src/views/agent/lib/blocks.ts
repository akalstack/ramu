import { ramuTool, ramuToolHasOwnUi } from '@ramu/shared/ramuTools'
import type { AgentEvent } from '@ramu/shared/types'
import { type ChatBlock as Block } from '@ramu/shared/chatFolding'
import { goalChanges } from '@ramu/shared/goalHistory'
import type { AgentTask } from '@ramu/shared/types'
import { ramu } from '../../../ipc'

/** Consecutive tool calls collapse into one line, like "Ran 2 commands". */
export function toBlocks(events: AgentEvent[]): Block[] {
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

/** The position of a block in the full list; a tool group is found by its first call. */
export const blockIndex = (block: Block, blocks: Block[]) =>
  block.kind === 'tools'
    ? blocks.findIndex((original) => original.kind === 'tools' && original.tools.includes(block.tools[0]!))
    : blocks.indexOf(block)

/** When a block happened, if the provider said. */
export const blockAt = (block: Block): number | undefined =>
  block.kind === 'event' ? block.event.at : block.tools[0]?.at

/** Ramu's advisor tools: mcp__ramu__advisor from Claude, `advisor` on the ramu server from Codex. */
const isAdvisorTool = (e: { name: string; summary: string; input?: string }) => {
  const call = ramuTool(e)
  return call?.name === 'advisor' || call?.name === 'wait_for_advice'
}

/** Shows paths inside the agent's directory relative to it; the header carries the full path. */
export function relativize(e: AgentEvent, cwd: string): AgentEvent {
  if (!cwd) return e
  const strip = (s: string) => s.split(`${cwd}/`).join('')
  if (e.kind === 'permission-request') return { ...e, detail: strip(e.detail) }
  return e
}

/** The sub-agent task of a block known to be an agent card. */
export const agentOf = (block: Block): AgentTask => (block as { event: AgentTask }).event
const isAgentCard = (block: Block) =>
  block.kind === 'event' && block.event.kind === 'agent' && block.event.taskType !== 'advisor'

/** Runs of two or more sub-agent cards, as arrays; everything else passes through. */
export function groupAgentRuns(blocks: Block[]): (Block | Block[])[] {
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
