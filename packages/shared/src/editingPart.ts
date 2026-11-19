// Which part of an artifact a person is editing, for the notice beside the editor: the heading above where they last
// typed in a doc, or the slide they last changed in a deck.

/** Where `next` first differs from `previous`, or null when nothing changed. */
export function changedAt(previous: string, next: string): number | null {
  if (previous === next) return null
  let at = 0
  while (at < previous.length && at < next.length && previous[at] === next[at]) at++
  return at
}

/** The Markdown heading above `offset`, without its marks; null above the first heading. */
export function headingAt(text: string, offset: number): string | null {
  const before = text.slice(0, offset).split('\n')
  for (let line = before.length - 1; line >= 0; line--) {
    const heading = /^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(before[line]!)
    if (heading) return heading[1]!.slice(0, 80)
  }
  return null
}

/**
 * Where a caret at `at` in `previous` belongs once others' typing turns it into `next`: before the change it stays,
 * after it it moves by what was added or removed, and inside a replaced span it goes to that span's end.
 */
export function caretAfter(previous: string, next: string, at: number): number {
  const start = changedAt(previous, next)
  if (start === null || at <= start) return at
  let end = 0
  while (
    end < previous.length - start &&
    end < next.length - start &&
    previous[previous.length - 1 - end] === next[next.length - 1 - end]
  )
    end++
  return at >= previous.length - end ? at + next.length - previous.length : next.length - end
}
