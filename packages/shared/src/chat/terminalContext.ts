/**
 * Terminal output a person adds to a message. The person sees a chip naming the terminal and its lines; the agent
 * reads the text in a tagged block after the message, like other hidden context.
 */
export interface TerminalAttachment {
  id: string
  /** The terminal as its tab names it (`Terminal 2`). */
  terminal: string
  /** First and last buffer line the text came from, 1-based, so a person can tell two excerpts apart. */
  lines: [number, number]
  text: string
}

/** Longer excerpts keep their end, where errors and the latest prompt are. */
export const TERMINAL_ATTACHMENT_LIMIT = 20_000
/** At most this many excerpts wait in one message box; a new one replaces the oldest. */
export const TERMINAL_ATTACHMENTS_MAX = 8

const TAG = 'terminal-output'

/** Tidies captured text: Windows line ends, trailing spaces xterm pads rows with, and blank lines around it. */
export function normalizeTerminalText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/^\n+|\n+$/g, '')
}

/** An excerpt ready to attach, or null when the capture holds nothing but whitespace. */
export function terminalAttachment(
  terminal: string,
  lines: [number, number],
  text: string,
  id: string = crypto.randomUUID(),
): TerminalAttachment | null {
  let body = normalizeTerminalText(text)
  if (!body) return null
  const end = lines[1]
  let start = lines[0]
  if (body.length > TERMINAL_ATTACHMENT_LIMIT) {
    const kept = body.slice(-TERMINAL_ATTACHMENT_LIMIT)
    const cut = kept.indexOf('\n')
    const tail = cut >= 0 ? kept.slice(cut + 1) : kept
    start = Math.max(start, end - tail.split('\n').length + 1)
    body = tail
  }
  return { id, terminal: terminal.trim() || 'Terminal', lines: [Math.min(start, end), end], text: body }
}

/** `Terminal 2 · 12–40`, or one line number when it is a single line. */
export function terminalAttachmentLabel(item: Pick<TerminalAttachment, 'terminal' | 'lines'>): string {
  const [start, end] = item.lines
  return `${item.terminal} · ${start === end ? start : `${start}–${end}`}`
}

/** Adds an excerpt; capturing the same text from the same terminal again keeps one copy. */
export function addTerminalAttachment(current: TerminalAttachment[], next: TerminalAttachment): TerminalAttachment[] {
  const others = current.filter((item) => item.terminal !== next.terminal || item.text !== next.text)
  return [...others, next].slice(-TERMINAL_ATTACHMENTS_MAX)
}

/** Hidden context for the agent: one tagged block per excerpt. */
export function terminalAttachmentBlock(items: TerminalAttachment[]): string {
  return items
    .map(
      (item) =>
        `<${TAG} terminal=${JSON.stringify(item.terminal)} lines="${item.lines[0]}-${item.lines[1]}">\n` +
        // Output that prints the closing tag must not end the block early.
        `${item.text.replaceAll(`</${TAG}`, `<\\/${TAG}`)}\n</${TAG}>`,
    )
    .join('\n')
}

const SENT = new RegExp(
  `<${TAG} terminal=("(?:[^"\\\\\\n]|\\\\.)*") lines="(\\d+)-(\\d+)">\\n([\\s\\S]*?)\\n</${TAG}>`,
  'g',
)

/** The excerpts a sent message carried, for showing them under it. */
export function sentTerminalAttachments(text: string): Omit<TerminalAttachment, 'id'>[] {
  return [...text.matchAll(SENT)].flatMap((match) => {
    try {
      return [
        {
          terminal: JSON.parse(match[1]!) as string,
          lines: [Number(match[2]), Number(match[3])] as [number, number],
          text: match[4]!.replaceAll(`<\\/${TAG}`, `</${TAG}`),
        },
      ]
    } catch {
      return []
    }
  })
}

export function isTerminalAttachmentList(value: unknown): value is TerminalAttachment[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        !!item &&
        typeof item === 'object' &&
        typeof (item as TerminalAttachment).id === 'string' &&
        typeof (item as TerminalAttachment).terminal === 'string' &&
        typeof (item as TerminalAttachment).text === 'string' &&
        Array.isArray((item as TerminalAttachment).lines) &&
        (item as TerminalAttachment).lines.length === 2 &&
        (item as TerminalAttachment).lines.every((line) => Number.isInteger(line)),
    )
  )
}
