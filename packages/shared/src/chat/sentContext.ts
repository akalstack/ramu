// What a sent message carried besides the words the person typed: terminal output, artifacts it asked about and
// review comments. The desktop and the phone both read them back from the text as sent, to show them under it.
import { sentInteractiveAttachments } from '../interactive'
import { sentTerminalAttachments, type TerminalAttachment } from './terminalContext'

/** A review comment a sent message carried, read back from its hidden payload. */
export interface SentReviewComment {
  path: string
  side: 'old' | 'new'
  line: number
  endLine: number
  scope?: string
  text: string
}

export function sentReviewComments(text: string): SentReviewComment[] {
  const body = text.match(/<review-comments>\s*([\s\S]*?)\s*<\/review-comments>/)?.[1]
  if (!body) return []
  try {
    const parsed = JSON.parse(body) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((entry: Record<string, unknown>) =>
      typeof entry?.path === 'string' &&
      (entry.side === 'old' || entry.side === 'new') &&
      typeof entry.line === 'number' &&
      typeof entry.endLine === 'number' &&
      typeof entry.originalComment === 'string'
        ? [
            {
              path: entry.path,
              side: entry.side,
              line: entry.line,
              endLine: entry.endLine,
              ...(typeof entry.scope === 'string' ? { scope: entry.scope } : {}),
              text: entry.originalComment,
            },
          ]
        : [],
    )
  } catch {
    return []
  }
}

export interface SentContext {
  comments: SentReviewComment[]
  artifacts: { id: string; version: number; title: string }[]
  terminal: Omit<TerminalAttachment, 'id'>[]
}

/** Everything besides the typed words that a sent message carried. */
export function sentContext(text: string): SentContext {
  return {
    comments: sentReviewComments(text),
    artifacts: sentInteractiveAttachments(text),
    terminal: sentTerminalAttachments(text),
  }
}

export const hasSentContext = (context: SentContext) =>
  context.comments.length > 0 || context.artifacts.length > 0 || context.terminal.length > 0
