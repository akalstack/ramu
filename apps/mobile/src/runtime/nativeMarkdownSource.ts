import { chatReferences } from '@ramu/shared/chat/chatReferences'
import { inlineCodeFileLink } from '@ramu/shared/workspace/fileLinks'

export const FILE_SCHEME = 'ramu-file:'
export const SKILL_SCHEME = 'ramu-skill:'

/** An image alone on its line; it is drawn as its own tappable image between the text, never by the native view. */
const IMAGE_LINE = /^\s*!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)\s*$/

/**
 * Explicit references (`@file`, `$skill`) become links, so the native view draws and opens them; fenced and inline code
 * are left alone, as chatReferences skips them. Workspace images need the host to fetch them, which this view cannot,
 * so a reply with one inside a paragraph keeps the React Native renderer; one alone on its line is split out instead.
 */
export function nativeMarkdownSource(text: string): string | null {
  const inline = text
    .split('\n')
    .some((line) => !IMAGE_LINE.test(line) && /!\[[^\]]*\]\((?!https?:|data:image\/)/i.test(line))
  if (inline) return null
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

export type MarkdownPart =
  | { kind: 'text'; source: string }
  | { kind: 'code'; source: string; lang?: string }
  | { kind: 'image'; src: string; alt: string }

/**
 * A reply cut around its closed fenced code blocks and the images alone on their lines. The native text view lays code
 * out with the prose, with no file header and no sideways scroll, and cannot open an image, so each is drawn as its own
 * block instead, also inside a list item, as the desktop and the React Native renderer draw them. A fence still being
 * written (no closing marker yet) stays in the text.
 */
export function splitCodeFences(source: string): MarkdownPart[] {
  const parts: MarkdownPart[] = []
  const lines = source.split('\n')
  let text: string[] = []
  const flush = () => {
    const joined = text.join('\n')
    if (joined.trim()) parts.push({ kind: 'text', source: joined })
    text = []
  }
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!
    const image = IMAGE_LINE.exec(line)
    if (image) {
      flush()
      parts.push({ kind: 'image', src: image[2]!, alt: image[1]! })
      continue
    }
    const open = /^(\s*)(`{3,}|~{3,})\s*([^\s`]*)[^`]*$/.exec(line)
    if (!open) {
      text.push(line)
      continue
    }
    const fence = open[2]!
    const end = lines.findIndex((candidate, at) => {
      if (at <= index) return false
      const close = /^\s*(`{3,}|~{3,})\s*$/.exec(candidate)
      return !!close && close[1]![0] === fence[0] && close[1]!.length >= fence.length
    })
    if (end < 0) {
      text.push(...lines.slice(index))
      break
    }
    flush()
    parts.push({ kind: 'code', source: lines.slice(index + 1, end).join('\n'), ...(open[3] ? { lang: open[3] } : {}) })
    index = end
  }
  flush()
  return parts
}
