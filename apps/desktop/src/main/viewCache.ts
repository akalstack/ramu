/** Keeps recently used clean workspace views warm. Dirty editors, terminals and unfinished forms are pinned. */
export class WorkspaceViewCache {
  private readonly used = new Map<string, { at: number }>()
  private visible = 'local'
  private sweeping = false
  private again = false
  private closed = false
  constructor(
    private readonly safe: (id: string) => Promise<boolean>,
    private readonly release: (id: string) => void,
    private readonly limit = 4,
    private readonly idleMs = 10 * 60_000,
    private readonly now = Date.now,
  ) {}
  show(id: string) {
    this.visible = id
    if (id !== 'local') this.used.set(id, { at: this.now() })
    void this.sweep()
  }
  forget(id: string) {
    this.used.delete(id)
  }
  close() {
    this.closed = true
    this.used.clear()
  }
  async sweep() {
    if (this.closed) return
    if (this.sweeping) {
      this.again = true
      return
    }
    this.sweeping = true
    try {
      const candidates = [...this.used].filter(([id]) => id !== this.visible).sort((a, b) => a[1].at - b[1].at)
      for (const [id, usedAt] of candidates) {
        if (this.closed) break
        if (this.used.size <= this.limit && this.now() - usedAt.at < this.idleMs) continue
        if (!(await this.safe(id)) || this.closed || id === this.visible || this.used.get(id) !== usedAt) continue
        this.used.delete(id)
        this.release(id)
      }
    } finally {
      this.sweeping = false
      if (this.again && !this.closed) {
        this.again = false
        void this.sweep()
      }
    }
  }
}
