// Who is editing an artifact's text right now, on which of the person's devices: each editor says so when it opens
// and every half minute while it stays open, and a mark lapses after ninety seconds without one. Kept in memory
// only; it shows a notice beside the editor and decides nothing, since saving merges edits made at once.

const LAPSE_MS = 90_000

export class EditingPresence {
  private readonly marks = new Map<string, Map<string, { at: number; part: string | null }>>()

  constructor(private readonly now: () => number = Date.now) {}

  /**
   * Marks (or clears) `device` editing the artifact, with the part it is on (a heading or a slide), and returns the
   * others editing it now, each with its part as "MacBook · Goals".
   */
  mark(artifactId: string, device: string, editing: boolean, part: string | null = null): string[] {
    const marks = this.marks.get(artifactId) ?? new Map<string, { at: number; part: string | null }>()
    if (editing) marks.set(device, { at: this.now(), part: part ?? marks.get(device)?.part ?? null })
    else marks.delete(device)
    for (const [name, mark] of marks) if (this.now() - mark.at > LAPSE_MS) marks.delete(name)
    if (marks.size) this.marks.set(artifactId, marks)
    else this.marks.delete(artifactId)
    return [...marks.entries()]
      .filter(([name]) => name !== device)
      .map(([name, mark]) => (mark.part ? `${name} · ${mark.part}` : name))
  }
}
