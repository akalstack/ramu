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
