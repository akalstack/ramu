// Who is editing an artifact's text right now, on which of the person's devices: each editor says so when it opens
// and every half minute while it stays open, and a mark lapses after ninety seconds without one. Kept in memory
// only; it shows a notice beside the editor and decides nothing, since saving merges edits made at once.

const LAPSE_MS = 90_000

export class EditingPresence {
  private readonly marks = new Map<string, Map<string, number>>()

  constructor(private readonly now: () => number = Date.now) {}

  /** Marks (or clears) `device` editing the artifact, and returns the other devices editing it now. */
  mark(artifactId: string, device: string, editing: boolean): string[] {
    const marks = this.marks.get(artifactId) ?? new Map<string, number>()
    if (editing) marks.set(device, this.now())
    else marks.delete(device)
    for (const [name, at] of marks) if (this.now() - at > LAPSE_MS) marks.delete(name)
    if (marks.size) this.marks.set(artifactId, marks)
    else this.marks.delete(artifactId)
    return [...marks.keys()].filter((name) => name !== device)
  }
}
