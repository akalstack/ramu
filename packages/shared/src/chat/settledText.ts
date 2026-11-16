const FENCE = /^ {0,3}(`{3,}|~{3,})/

/**
 * How much of a reply that is still being written forms whole Markdown blocks: everything up to its last blank line
 * outside a code block, or to the end of a code block that has just closed. A reply is sent a block at a time from
 * here, so a half-written paragraph, table or code block never shows and each block arrives whole.
 */
export function settledTextLength(text: string): number {
  let settled = 0
  let fence: string | null = null
  let at = 0
  while (at < text.length) {
    const end = text.indexOf('\n', at)
    // The last line has not ended yet, so it cannot close a block.
    if (end < 0) break
    const line = text.slice(at, end)
    const next = end + 1
    const marker = FENCE.exec(line)?.[1]
    if (fence) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length && !line.trim().slice(marker.length)) {
        fence = null
        settled = next
      }
    } else if (marker) fence = marker
    else if (!line.trim()) settled = next
    at = next
  }
  return settled
}
