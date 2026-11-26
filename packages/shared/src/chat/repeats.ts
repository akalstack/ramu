/**
 * The same notice back to back reads once, with how many times it happened: a provider error retried five times, or
 * the thread resuming after several restarts with nothing in between. `key` names what makes two items the same, or
 * null for an item that never folds. The first item keeps its place and identity, so a row on screen stays put as
 * repeats arrive; `counted` gives it the run's length. Items `unseen` says draw nothing (bookkeeping such as a turn
 * boundary) stay in place without breaking a run.
 */
export function foldRepeats<T>(
  items: readonly T[],
  key: (item: T) => string | null,
  counted: (item: T, repeats: number) => T,
  unseen: (item: T) => boolean = () => false,
): T[] {
  const out: T[] = []
  let runKey: string | null = null
  let runStart = -1
  let runLength = 0
  for (const item of items) {
    if (unseen(item)) {
      out.push(item)
      continue
    }
    const now = key(item)
    if (now !== null && now === runKey) {
      runLength++
      out[runStart] = counted(out[runStart]!, runLength)
      continue
    }
    out.push(item)
    runKey = now
    runStart = out.length - 1
    runLength = 1
  }
  return out
}
