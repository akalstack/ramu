import { chatReferences } from '@ramu/shared/chat/chatReferences'
import { inlineCodeFileLink } from '@ramu/shared/workspace/fileLinks'

export const FILE_SCHEME = 'ramu-file:'
export const SKILL_SCHEME = 'ramu-skill:'

/**
 * Explicit references (`@file`, `$skill`) become links, so the native view draws and opens them; fenced and inline code
 * are left alone, as chatReferences skips them. Workspace images need the host to fetch them, which this view cannot.
 */
export function nativeMarkdownSource(text: string): string | null {
  if (/!\[[^\]]*\]\((?!https?:|data:image\/)/i.test(text)) return null
  return chatReferences(text)
    .map((part) =>
      part.kind === 'text'
        ? linkInlineFiles(part.text)
        : part.kind === 'skill'
          ? `[${part.text}](${SKILL_SCHEME}${encodeURIComponent(part.target)})`
          : `[${part.text}](${FILE_SCHEME}${encodeURIComponent(part.target)})`,
    )
    .join('')
}

/** A file named in backticks opens like a linked one; fenced code is left exactly as written. */
function linkInlineFiles(text: string): string {
  return text
    .split(/(^(?:```|~~~)[^\n]*\n[\s\S]*?(?:^(?:```|~~~)[^\n]*$|(?![\s\S])))/m)
    .map((piece, index) =>
      index % 2
        ? piece
        : piece.replace(/(^|[^`])`([^`\n]+)`(?!`)/g, (whole, before: string, code: string) => {
            const path = inlineCodeFileLink(code)
            return path ? `${before}[${path}](${FILE_SCHEME}${encodeURIComponent(path)})` : whole
          }),
    )
    .join('')
}
