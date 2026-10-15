const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/**
 * Shortens `text` to at most `max` UTF-16 units without cutting through a character: a plain `slice` can leave half of
 * a surrogate pair (shown as "�") or split an emoji sequence such as 👨‍👩‍👧‍👦 into its parts.
 */
export function clipText(text: string, max: number): string {
  if (text.length <= max) return text
  let clipped = ''
  // Segmenting a megabyte of text just to keep forty characters would be wasted work.
  for (const { segment } of graphemes.segment(text.slice(0, max * 2 + 64))) {
    if (clipped.length + segment.length > max) break
    clipped += segment
  }
  return clipped
}

// Control characters, and the characters that reorder text (U+202A–202E, U+2066–2069, marks U+200E/F): they make a
// label read differently from what it is, e.g. "report‮gnp.txt" displays as "reporttxt.png".
const MISLEADING = /[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/g
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

/** A single-line label that cannot disguise itself: line breaks collapse to spaces, the rest of the invisible characters go. */
export function cleanLabel(text: string): string {
  return text
    .replace(LONE_SURROGATE, '�')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(MISLEADING, '')
    .replace(/ {2,}/g, ' ')
    .trim()
}

/** For names Ramu does not own (files already on disk): show the disguise instead of hiding it, like a code editor does. */
export function visibleName(name: string): string {
  return name.replace(
    MISLEADING,
    (character) => `‹U+${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}›`,
  )
}
