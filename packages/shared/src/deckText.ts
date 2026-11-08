// A deck's slide words as one text, so live typing on a deck shares the doc's Yjs text: each slide's fields in a fixed
// order, separated by control characters a person cannot type. Edits stay inside their field when merged; a deck whose
// slides were added, removed or moved since is not mapped back, and its editors save as before.
import type { Slide, SlideTextEdit } from './artifactSource'

const FIELD = '\u001e'
const SLIDE = '\u001d'
const KEYS = ['title', 'body', 'by', 'notes', 'left', 'right'] as const

/** The deck's words as one text. */
export function deckText(slides: readonly Pick<Slide, 'title' | 'body' | 'by' | 'notes' | 'columns'>[]): string {
  return slides
    .map((slide) =>
      [slide.title ?? '', slide.body ?? '', slide.by ?? '', slide.notes ?? '', ...(slide.columns ?? ['', ''])]
        // The separators never appear in a field, so the text always maps back.
        .map((value) => value.split(SLIDE).join('').split(FIELD).join(''))
        .join(FIELD),
    )
    .join(SLIDE)
}

/** Each slide's words from the text, in the slides' order; null when it does not have one entry per slide. */
export function slideWords(
  text: string,
  count: number,
): Pick<SlideTextEdit, 'title' | 'body' | 'by' | 'notes' | 'columns'>[] | null {
  const slides = text.split(SLIDE)
  if (slides.length !== count) return null
  const words = slides.map((slide) => slide.split(FIELD))
  if (words.some((fields) => fields.length !== KEYS.length)) return null
  return words.map(([title, body, by, notes, left, right]) => ({
    title: title!,
    body: body!,
    by: by!,
    notes: notes!,
    ...(left || right ? { columns: [left!, right!] as [string, string] } : {}),
  }))
}
