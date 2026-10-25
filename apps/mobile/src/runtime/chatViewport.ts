/** Programmatic jumps keep following enabled; only the reader can leave the latest message. */
export function transcriptScrollState(following: boolean, gap: number, dragging: boolean, settling: boolean) {
  const follow = !settling && dragging ? gap < 40 : following
  return { following: follow, away: !follow && gap > 80 }
}

/** Native prompts and Control Center report inactive without suspending the app. */
export function appForeground(previous: boolean, next: string): boolean {
  return next === 'inactive' ? previous : next === 'active'
}
