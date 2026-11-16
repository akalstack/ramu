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
