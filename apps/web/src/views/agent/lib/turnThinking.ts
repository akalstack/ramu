import { foldChatTurn, type ChatBlock, type ToolResult } from '@ramu/shared/chat/chatFolding'

/** Reasoning stays where it arrived, inside the work it belongs to; a finished turn folds it with its tools. */
export function turnThinking(
  items: ChatBlock[],
  finished: boolean,
  outcomes: Map<string, string>,
  results: Map<string, ToolResult>,
) {
  if (finished) return foldChatTurn(items, outcomes, results)

  // Keep the live transcript in place. Tool groups own their disclosures; the
  // turn-wide summary is only introduced after the run finishes.
  return { folded: [] as ChatBlock[], kept: items, answer: [] as ChatBlock[] }
}
