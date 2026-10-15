/** Keep a little leading context while reserving enough room for the highlighted match. */
export function searchSnippet(
  text: string,
  start: number,
  end: number,
  width: number,
  measure: (text: string) => number,
  omittedPrefix = false,
) {
  const before = text.slice(0, start).trimStart()
  const hit = text.slice(start, end) || ' '
  const after = text.slice(end)
  const ellipsisWidth = measure('…')
  const budget = Math.max(0, Math.min(width / 5, width - measure(hit) - ellipsisWidth))
  const characters = Array.from(before)
  let offset = 0
  while (
    offset < characters.length &&
    measure(characters.slice(offset).join('')) + (offset || omittedPrefix ? ellipsisWidth : 0) > budget
  )
    offset++
  const cropped = offset > 0 || omittedPrefix
  return { before: (cropped ? '…' : '') + characters.slice(offset).join(''), hit, after }
}
