// What the phone's terminal offers to copy, read from the terminal page's own buffer: the selection, recent commands
// with their output (newest first), the rows on screen and recent output for picking a part by hand.

export interface TerminalCopyChoices {
  id: number
  selection: string
  blocks: string[]
  screen: string
  recent: string
}

const LIMIT = 200_000
const text = (value: unknown) => (typeof value === 'string' && value.length <= LIMIT ? value : '')

/** A capture the terminal page answered with, checked before the screen shows it; anything else is null. */
export function terminalCopyMessage(value: unknown): TerminalCopyChoices | null {
  if (!value || typeof value !== 'object') return null
  const message = value as Record<string, unknown>
  if (message.kind !== 'capture' || !Number.isInteger(message.id)) return null
  const blocks = Array.isArray(message.blocks) ? message.blocks.slice(0, 5).map(text).filter(Boolean) : []
  return {
    id: message.id as number,
    selection: text(message.selection),
    blocks,
    screen: text(message.screen),
    recent: text(message.recent),
  }
}

/** A command block as a row: the command line it starts with, and the last line it printed. */
export function terminalBlockSummary(block: string): { command: string; output: string | null } {
  const lines = block.split('\n')
  const output = lines
    .slice(1)
    .reverse()
    .find((line) => line.trim())
  return { command: lines[0]!.trim(), output: output ? output.trim() : null }
}
