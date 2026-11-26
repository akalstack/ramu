// A line that so far holds only a list, quote or heading marker: shown alone it would draw an empty bullet or heading.
const MARKER_ONLY = /^[ \t]*(?:[-*+>]|\d{1,9}[.)]|#{1,6})?[ \t]*$/

/**
 * How much of a reply still being written to show: up to its last whole word, as T3 Code streams a reply, so a
 * paragraph, list, table or code block grows as it is written instead of appearing only once it ends. A word still
 * being typed waits, so none changes under the reader, and so does a line that so far holds only its marker. Both apps'
 * Markdown renderers draw a code block or emphasis that is not closed yet.
 */
export function settledLength(text: string): number {
  const lineStart = text.lastIndexOf('\n') + 1
  let cut = text.length
  while (cut > lineStart && !/\s/.test(text[cut - 1]!)) cut--
  // Inside the line: back over the spaces before the partial word, so the shown text never ends in a space.
  while (cut > lineStart && /\s/.test(text[cut - 1]!)) cut--
  if (cut === lineStart || MARKER_ONLY.test(text.slice(lineStart, cut))) return lineStart
  return cut
}
