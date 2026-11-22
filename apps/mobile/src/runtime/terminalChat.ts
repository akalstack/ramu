// Terminal output a person adds to a thread from the phone's terminal: the rows on screen become an excerpt that waits
// above the message box as a chip and goes to the agent with the next message, as on the desktop.
import {
  addTerminalAttachment,
  isTerminalAttachmentList,
  terminalAttachment,
  terminalAttachmentBlock,
  type TerminalAttachment,
} from '@ramu/shared/chat/terminalContext'
import { withHiddenContext } from '@ramu/shared/chat/visibleMessage'
import { terminalTail } from '@ramu/shared/workspace/terminalText'

/** The draft that holds a thread's waiting excerpts, beside its message box draft. */
export const terminalDraftKey = (composerKey: string) => `${composerKey}:terminal`

export function readTerminalDraft(drafts: Record<string, string>, key: string): TerminalAttachment[] {
  try {
    const value = JSON.parse(drafts[key] ?? '[]') as unknown
    return isTerminalAttachmentList(value) ? value : []
  } catch {
    return []
  }
}

/** The rows on screen (the last `rows` lines of output) as an excerpt, or null when the screen holds nothing. */
export function captureScreen(output: string, rows: number, terminal: string, id?: string): TerminalAttachment | null {
  const tail = terminalTail(output, Math.max(1, rows))
  if (!tail.text.trim()) return null
  return terminalAttachment(terminal, [tail.total - tail.lines + 1, tail.total], tail.text, id)
}

/** The waiting excerpts with one more added; the same text from the same terminal is kept once. */
export function withScreen(drafts: Record<string, string>, key: string, next: TerminalAttachment): string {
  return JSON.stringify(addTerminalAttachment(readTerminalDraft(drafts, key), next))
}

/** The message as sent: the typed words, then the excerpts as hidden context the agent reads. */
export const messageWithTerminal = (text: string, items: TerminalAttachment[]) =>
  withHiddenContext(text, items.length ? terminalAttachmentBlock(items) : '')
