import type { AgentEvent } from './types'
import { isTurnFooter } from './compaction'
export type ToolUse = Extract<AgentEvent, { kind: 'tool-use' }>
export type ToolResult = Extract<AgentEvent, { kind: 'tool-result' }>
export type ChatBlock = { kind: 'event'; event: AgentEvent } | { kind: 'tools'; tools: ToolUse[] }

/** Failures and unfinished calls must remain discoverable outside completed work. */
export function toolNeedsAttention(result: ToolResult | undefined) {
  return !result || result.isError || result.status === 'failed' || result.running === true
}

export function foldChatTurn(items: ChatBlock[], outcomes: Map<string, string>, results: Map<string, ToolResult>) {
  let end = items.length
  while (end > 0 && items[end - 1]!.kind === 'event' && isTurnFooter((items[end - 1] as { event: AgentEvent }).event)) end--
  let start = end
  while (start > 0 && items[start - 1]!.kind === 'event' && ['text', 'content'].includes((items[start - 1] as { event: AgentEvent }).event.kind)) start--
  const folded: ChatBlock[] = [], kept: ChatBlock[] = []
  for (const block of items.slice(0, start)) {
    if (block.kind === 'tools') {
      const routine = block.tools.filter(tool => !toolNeedsAttention(results.get(tool.toolUseId)))
      const attention = block.tools.filter(tool => toolNeedsAttention(results.get(tool.toolUseId)))
      if (routine.length) folded.push(routine.length === block.tools.length ? block : { kind: 'tools', tools: routine })
      if (attention.length) kept.push(attention.length === block.tools.length ? block : { kind: 'tools', tools: attention })
      continue
    }
    const event = block.event
    const foldable = event.kind === 'text' || event.kind === 'content' || event.kind === 'thinking'
      || event.kind === 'plan' && event.entries.every(entry => entry.status === 'completed')
      || event.kind === 'agent' && event.taskType !== 'advisor' && event.status === 'completed'
      || (event.kind === 'permission-request' || event.kind === 'elicitation' || event.kind === 'question') && ['approved', 'accepted', 'answered', 'allow', 'allowed'].includes(outcomes.get(event.requestId) ?? '')
    ;(foldable ? folded : kept).push(block)
  }
  return { folded, kept, answer: items.slice(start) }
}
