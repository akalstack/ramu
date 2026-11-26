// Text selected in the phone's terminal, as the terminal page reports it: what is selected and where its ends are on
// screen, for the handles and the menu the phone draws over it.

export interface TerminalSelectionPoint {
  x: number
  y: number
}

export interface TerminalSelectionState {
  text: string
  /** The top-left of the first selected character; null while scrolled out of view. */
  start: TerminalSelectionPoint | null
  /** The top-right of the last selected character; null while scrolled out of view. */
  end: TerminalSelectionPoint | null
  lineHeight: number
  /** Whether the selection sits in a command whose whole block can be selected. */
  block: boolean
}

const LIMIT = 200_000
const point = (value: unknown): TerminalSelectionPoint | null => {
  if (!value || typeof value !== 'object') return null
  const { x, y } = value as Record<string, unknown>
  return typeof x === 'number' && Number.isFinite(x) && typeof y === 'number' && Number.isFinite(y) ? { x, y } : null
}

/**
 * A selection report from the terminal page: the selection, or null once it is let go. Anything malformed is
 * undefined, so the phone keeps what it shows.
 */
export function terminalSelectionMessage(value: unknown): TerminalSelectionState | null | undefined {
  if (!value || typeof value !== 'object') return undefined
  const message = value as Record<string, unknown>
  if (message.kind !== 'selection') return undefined
  if (message.active !== true) return null
  const lineHeight = message.lineHeight
  if (typeof message.text !== 'string' || message.text.length > LIMIT) return undefined
  if (typeof lineHeight !== 'number' || !(lineHeight > 0) || lineHeight > 200) return undefined
  // A selection of only blank cells has nothing to copy.
  if (!message.text.trim()) return null
  return {
    text: message.text,
    start: point(message.start),
    end: point(message.end),
    lineHeight,
    block: message.block === true,
  }
}
