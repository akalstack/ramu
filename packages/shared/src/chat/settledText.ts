// A fence may open at any indentation (inside a list item); a backtick fence's info string cannot hold a backtick, so
// "```npm test``` runs" is inline code, not a fence.
const FENCE = /^( *)(`{3,}(?![^`\n]*`)|~{3,})/
const BLANK = /^[ \t]*$/
// The marker must be followed by a space, so a half-written "-" or "1" never counts as an item yet.
const LIST_ITEM = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]/
// The partial last line starts a new item once it has some text after its marker.
const PARTIAL_LIST_ITEM = /[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\S/y
// A heading, or a line that is only bold text: it introduces what follows, so it waits for that.
const TITLE = /^ {0,3}(?:#{1,6}(?:[ \t]|$)|\*\*(?:[^*]|\*(?!\*))+\*\*:?$)/
// An unindented heading ends the paragraph or list before it even without a blank line.
const HEADING = /^#{1,6}(?:[ \t]|$)/

/**
 * Where a reply that is still being written can be cut so that only whole Markdown blocks show: after a blank line or a
 * closed code block, before a heading, and between the items of a list. A title waits until its content starts, so it
 * never sits alone at the end. Keeps its place so the next piece of the same reply only scans what is new.
 */
export interface BlockScan {
  readonly text: string
  /** Start of the line still being written; every line before it has been scanned. */
  readonly lineStart: number
  readonly fence: { readonly marker: string; readonly indent: number } | null
  /** The last place it is safe to cut, or 0 when there is none yet. */
  readonly boundary: number
  readonly titleWaiting: boolean
}

export const EMPTY_BLOCK_SCAN: BlockScan = { text: '', lineStart: 0, fence: null, boundary: 0, titleWaiting: false }

/** Scans the ended lines of `text`, resuming after `previous` when `text` continues it, from the start otherwise. */
export function scanBlocks(previous: BlockScan, text: string): BlockScan {
  const resumed = text.startsWith(previous.text)
  let { lineStart, fence, boundary, titleWaiting } = resumed ? previous : EMPTY_BLOCK_SCAN
  for (let newline = text.indexOf('\n', lineStart); newline >= 0; newline = text.indexOf('\n', lineStart)) {
    const line = text.slice(lineStart, newline).replace(/[ \t\r]+$/, '')
    const opening = lineStart > 0 && !titleWaiting
    const fenceMark = FENCE.exec(line)
    if (fenceMark) {
      const indent = fenceMark[1]!.length
      const marker = fenceMark[2]!
      if (!fence) {
        if (opening && LIST_ITEM.test(line)) boundary = lineStart
        fence = { marker, indent }
        titleWaiting = false
      } else if (
        marker[0] === fence.marker[0] &&
        marker.length >= fence.marker.length &&
        indent <= fence.indent + 3 &&
        line.length === indent + marker.length
      ) {
        // A closing fence carries nothing after its marker.
        fence = null
        boundary = newline + 1
      }
    } else if (!fence) {
      if (BLANK.test(line)) {
        if (lineStart > 0 && !titleWaiting) boundary = newline + 1
      } else {
        if (opening && (LIST_ITEM.test(line) || HEADING.test(line))) boundary = lineStart
        titleWaiting = TITLE.test(line)
      }
    }
    lineStart = newline + 1
  }
  return { text, lineStart, fence, boundary, titleWaiting }
}

/** How much of the scanned text forms whole blocks. A list item still being written ends the one before it. */
export function settledLength(scan: BlockScan): number {
  if (!scan.fence && scan.lineStart > 0 && !scan.titleWaiting) {
    PARTIAL_LIST_ITEM.lastIndex = scan.lineStart
    if (PARTIAL_LIST_ITEM.test(scan.text)) return scan.lineStart
  }
  return scan.boundary
}
