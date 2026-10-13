export interface ReviewLineChange { originalStartLineNumber: number; originalEndLineNumber: number; modifiedStartLineNumber: number; modifiedEndLineNumber: number }
/** Locate a before-side discussion when the diff is displayed in one after-side pane. */
export function afterLineForBefore(line: number, changes: ReviewLineChange[]): number {
  let offset = 0
  for (const change of changes) {
    const oldCount = change.originalEndLineNumber === 0 ? 0 : change.originalEndLineNumber - change.originalStartLineNumber + 1
    const newCount = change.modifiedEndLineNumber === 0 ? 0 : change.modifiedEndLineNumber - change.modifiedStartLineNumber + 1
    if (line < change.originalStartLineNumber || oldCount === 0 && line <= change.originalStartLineNumber) break
    if (oldCount > 0 && line <= change.originalEndLineNumber) return change.modifiedEndLineNumber || change.modifiedStartLineNumber
    offset += newCount - oldCount
  }
  return Math.max(0, line + offset)
}
