/** Programmatic jumps keep following enabled; only the reader can leave the latest message. */
export function transcriptScrollState(following: boolean, gap: number, dragging: boolean, settling: boolean) {
  const follow = !settling && dragging ? gap < 40 : following
  return { following: follow, away: !follow && gap > 80 }
}

/** Native prompts and Control Center report inactive without suspending the app. */
export function appForeground(previous: boolean, next: string): boolean {
  return next === 'inactive' ? previous : next === 'active'
}

/**
 * Whether the end of the transcript is held still for a sent message: from sending until the list has made room under
 * it, and then while the reply has not filled that room. Following the end then would show the empty room first.
 */
export function holdsSentMessage(sent: { awaitingRoom: boolean; anchored: boolean; room: number }): boolean {
  return sent.awaitingRoom || (sent.anchored && sent.room > 0)
}
