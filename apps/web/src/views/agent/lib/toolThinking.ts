import type { ChatBlock, ToolUse } from '@ramu/shared/chat/chatFolding'
import type { AgentEvent } from '@ramu/shared/types'

export type ToolEntry = ToolUse | Extract<AgentEvent, { kind: 'thinking' }>
/** `first` is the run's first block, thinking or tools, so the run keeps one place as calls and thoughts arrive. */
export type WorkRun = { kind: 'work'; block: ChatBlock; entries: ToolEntry[]; first: ChatBlock }

/** Reasoning between calls belongs to the same tool disclosure, in arrival order. */
export function groupToolThinking(items: (ChatBlock | ChatBlock[])[]): (ChatBlock | ChatBlock[] | WorkRun)[] {
  const result: (ChatBlock | ChatBlock[] | WorkRun)[] = []
  let run: ChatBlock[] = []
  const flush = () => {
    const tools = run.flatMap((block) => (block.kind === 'tools' ? block.tools : []))
    if (tools.length) {
      const entries = run.flatMap<ToolEntry>((block) =>
        block.kind === 'tools' ? block.tools : block.event.kind === 'thinking' ? [block.event] : [],
      )
      result.push({ kind: 'work', block: { kind: 'tools', tools }, entries, first: run[0]! })
    } else result.push(...run)
    run = []
  }
  for (const item of items) {
    if (!Array.isArray(item) && (item.kind === 'tools' || item.event.kind === 'thinking')) run.push(item)
    else {
      flush()
      result.push(item)
    }
  }
  flush()
  return result
}

/**
 * Whether the tool group `block` is the live one of a running turn: it holds `statusGroup`, the turn's newest calls,
 * and the agent has not replied after it yet. Once the agent speaks, the group is done and settles where it stands
 * instead of waiting for the turn to end; the next group to start is live in its place.
 */
export function isLiveToolGroup(block: ChatBlock, statusGroup: ChatBlock | undefined, items: ChatBlock[]): boolean {
  if (block.kind !== 'tools' || statusGroup?.kind !== 'tools') return false
  if (block !== statusGroup && !statusGroup.tools.some((tool) => block.tools.includes(tool))) return false
  const after = items.slice(items.indexOf(statusGroup) + 1)
  return !after.some((later) => later.kind === 'event' && later.event.kind === 'text')
}
