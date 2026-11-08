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

const LIST_ITEM = /^\s{0,3}(?:[-*+]|\d{1,9}[.)])\s/

/**
 * A reply's top-level blocks (paragraphs, headings, lists, tables, fenced code), each a Markdown source of its own, so
 * a streaming reply can fade each new block in. Blank lines inside a fence stay in it, and a list or an indented
 * continuation stays one block across the blank lines between its items.
 */
export function markdownBlocks(source: string): string[] {
  const blocks: string[][] = []
  let current: string[] = []
  let fence: string | null = null
  let blank = false
  const close = () => {
    if (current.length) blocks.push(current)
    current = []
  }
  for (const line of source.split('\n')) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1]
    if (fence) {
      current.push(line)
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null
      continue
    }
    if (!line.trim()) {
      blank = true
      continue
    }
    if (blank && current.length) {
      const continues = /^\s/.test(line) || (LIST_ITEM.test(line) && LIST_ITEM.test(current[0]!))
      if (continues) current.push('')
      else close()
    }
    blank = false
    if (marker) fence = marker
    current.push(line)
  }
  close()
  return blocks.map((lines) => lines.join('\n'))
}
