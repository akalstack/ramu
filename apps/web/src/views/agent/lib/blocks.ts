import { isAbilityToolCall, ramuTool, ramuToolHasOwnUi } from '@ramu/shared/chat/ramuTools'
import { requestOutcomes } from '@ramu/shared/chat/questions'
import type { AgentEvent } from '@ramu/shared/types'
import { type ChatBlock as Block } from '@ramu/shared/chat/chatFolding'
import { goalChanges } from '@ramu/shared/chat/goalHistory'
import { foldSettingsChanges } from '@ramu/shared/chat/settingsChanges'
import { foldRepeats } from '@ramu/shared/chat/repeats'
import { latestSurfaces } from '@ramu/shared/chat/inlineUi'
import type { AgentTask } from '@ramu/shared/types'

const SILENT = new Set<AgentEvent['kind']>([
  'provider-wait',
  'init',
  'usage',
  'title',
  'context',
  'custom-agent',
  'helper-role',
])

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
  const cards = latestSurfaces(events)
  const outcomes = requestOutcomes(events)
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
    // A card shows once, at its newest version, so an agent's update moves it to where the conversation is.
    if (event.kind === 'inline-ui' && (event.surface.deleted || cards.get(event.surface.surfaceId) !== event.surface))
      continue
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
    // The advisor's card stands for its tool calls, and an ability row for its call.
    if (event.kind === 'tool-use' && (isAdvisorTool(event) || isAbilityToolCall(event))) continue
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
    // Bookkeeping with no row of its own. Each would still be an empty block, and the gap between blocks would add up:
    // every "Try anyway" records a provider-wait.
    if (SILENT.has(event.kind)) continue
    if (
      event.kind === 'goal' ||
      event.kind === 'queue' ||
      event.kind === 'settings-waiting' ||
      event.kind === 'tool-result' ||
      event.kind === 'state' ||
      event.kind === 'request-resolved' ||
      event.kind === 'question-state'
    )
      continue
    // A request allowed on its own (a saved rule, full access) left nothing to decide; the executed tool stands for it.
    // One the person allowed stays as a quiet line, as on the phone.
    if (event.kind === 'permission-request' && outcomes.get(event.requestId) === 'allowed-auto') continue
    const last = blocks.at(-1)
    if (event.kind === 'tool-use') {
      if (last?.kind === 'tools') last.tools.push(event)
      else blocks.push({ kind: 'tools', tools: [event] })
    } else blocks.push({ kind: 'event', event })
  }
  // Back-to-back settings changes read as one, and one that ends where it began (a switch back) leaves no line.
  const settled = foldSettingsChanges(
    blocks,
    (block) =>
      block.kind === 'event' && block.event.kind === 'settings'
        ? { settings: block.event.settings, previous: block.event.previous }
        : null,
    (first, last) =>
      first.kind === 'event' &&
      first.event.kind === 'settings' &&
      last.kind === 'event' &&
      last.event.kind === 'settings'
        ? { ...last, event: { ...last.event, previous: first.event.previous } }
        : last,
  )
  return foldRepeats(settled, repeatKey, (block, repeats) => ({ ...block, repeats }) as Block)
}

/** What makes two notices the same, so a run of them reads once; null for anything that always gets its own row. */
function repeatKey(block: Block): string | null {
  if (block.kind !== 'event') return null
  const e = block.event
  if (e.kind === 'error') return `error:${e.message}`
  if (e.kind === 'result' && e.isError) return 'result:failed'
  if (e.kind === 'recovery') return `recovery:${JSON.stringify(e.setupOmissions ?? null)}`
  if (e.kind === 'compaction' && e.state === 'failed') return `compaction:${e.error ?? ''}`
  if (e.kind === 'background-terminal-stop') return `stop:${e.command}`
  return null
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
