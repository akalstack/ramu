import type { ChangeFile, ReviewComment } from '../types'

function containsLines(content: string, selected: string[]): boolean {
  const lines = content.split('\n')
  return lines.some((_line, start) => selected.every((line, offset) => lines[start + offset] === line))
}

/** Compare the selected code, not its old line number. Insertions above it are harmless. */
export function reviewCommentOutdated(file: ChangeFile, comment: ReviewComment, currentContent: string): boolean {
  if (comment.scope === 'file' || file.binary) return false
  const selected = (comment.side === 'old' ? file.oldContent : file.newContent)
    .split('\n')
    .slice(comment.line - 1, comment.endLine)
  if (!selected.length || selected.every((line) => !line.trim())) return false
  // Deleted before-side code was already absent at the end of the recorded run.
  // Do not call that an external change or guess its replacement anchor.
  if (comment.side === 'old' && !containsLines(file.newContent, selected)) return false
  return !containsLines(currentContent, selected)
}
