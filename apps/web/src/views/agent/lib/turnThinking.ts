import { foldChatTurn, type ChatBlock, type ToolResult } from '@ramu/shared/chat/chatFolding'

/** Keep reasoning history in the work disclosure and expose one latest-reasoning slot while working. */
export function turnThinking(
  items: ChatBlock[],
  finished: boolean,
  outcomes: Map<string, string>,
  results: Map<string, ToolResult>,
) {
  const latest = items.findLast((block) => block.kind === 'event' && block.event.kind === 'thinking')
  const thinking = latest?.kind === 'event' && latest.event.kind === 'thinking' ? latest.event : undefined
  if (finished) return { ...foldChatTurn(items, outcomes, results), thinking: undefined }

  // Keep the live transcript in place. Tool groups own their disclosures; the
  // turn-wide summary is only introduced after the run finishes.
  return { folded: [] as ChatBlock[], kept: items, answer: [] as ChatBlock[], thinking }
}
