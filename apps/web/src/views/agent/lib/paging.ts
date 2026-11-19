/**
 * How many turns to add to the drawn page when new turns arrive. A reader at the bottom follows them (the oldest drawn
 * turn slides out of the page); one who scrolled up keeps every turn they can see, so the text does not move away.
 */
export function turnsToKeep(
  previous: { sessionId: string; count: number },
  current: { sessionId: string; count: number },
  atBottom: boolean,
): number {
  if (atBottom || previous.sessionId !== current.sessionId) return 0
  return Math.max(0, current.count - previous.count)
}
