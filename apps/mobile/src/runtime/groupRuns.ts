/** Splits a list into runs that share a key, so each run becomes one `SheetGroup`. */
export function runsBy<T>(items: readonly T[], key: (item: T) => string): T[][] {
  const runs: T[][] = []
  for (const item of items) {
    const last = runs.at(-1)
    if (last && key(last[0]!) === key(item)) last.push(item)
    else runs.push([item])
  }
  return runs
}
