import { replyPreview } from './replyPreview'

/**
 * A thought folded to one plain line beside its "Thought" label. Streaming reasoning shows its newest paragraph, so
 * the line follows what the agent is considering now; a finished thought reads from its opening.
 */
export function thoughtLine(text: string, live: boolean): string {
  if (!live) return replyPreview(text)
  return (
    text
      .split(/\n\s*\n/)
      .map(replyPreview)
      .findLast((line) => line.length > 0) ?? ''
  )
}
