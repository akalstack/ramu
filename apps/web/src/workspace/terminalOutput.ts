// Bounded terminal output held for a host that is not on screen; cursors avoid replaying snapshot content twice.

export const TERMINAL_BUFFER_LIMITS = { maxChars: 1024 * 1024, perTerminal: 128 * 1024, terminals: 128 }

export interface TerminalChunk {
  id: string
  data: string
  /** Characters the shell had printed after this chunk (the server's cursor), when known. */
  cursor?: number
  /** Output before `data` was dropped: the view must reset rather than append, or it shows a gap as if contiguous. */
  truncated?: boolean
}

interface Entry {
  data: string
  cursor?: number
  truncated: boolean
}

/** Bounded per terminal and in total; the oldest output goes first. Chunks keep the cursor of their last write. */
export class TerminalOutputBuffer {
  private readonly entries = new Map<string, Entry>()
  private total = 0
  constructor(private readonly limits = TERMINAL_BUFFER_LIMITS) {}

  get size() {
    return this.total
  }

  add({ id, data, cursor }: TerminalChunk) {
    const entry = this.entries.get(id) ?? { data: '', truncated: false }
    this.total -= entry.data.length
    entry.data += data
    // A chunk without a cursor makes the end unknown; later chunks bring it back.
    entry.cursor = cursor
    if (entry.data.length > this.limits.perTerminal) {
      entry.data = entry.data.slice(-this.limits.perTerminal)
      entry.truncated = true
    }
    this.total += entry.data.length
    this.entries.delete(id)
    this.entries.set(id, entry)
    while (this.entries.size > this.limits.terminals) this.drop(this.entries.keys().next().value!)
    while (this.total > this.limits.maxChars) {
      const first = [...this.entries.values()].find((buffer) => buffer.data.length)
      if (!first) break
      const remove = Math.min(first.data.length, this.total - this.limits.maxChars)
      first.data = first.data.slice(remove)
      first.truncated = true
      this.total -= remove
    }
  }

  drop(id: string) {
    const entry = this.entries.get(id)
    if (!entry) return
    this.total -= entry.data.length
    this.entries.delete(id)
  }

  /** Every held chunk, oldest terminal first, and empties the buffer. */
  drain(): TerminalChunk[] {
    const chunks = [...this.entries].map(([id, entry]) => ({
      id,
      data: entry.data,
      ...(entry.cursor !== undefined ? { cursor: entry.cursor } : {}),
      ...(entry.truncated ? { truncated: true } : {}),
    }))
    this.entries.clear()
    this.total = 0
    return chunks
  }
}

/**
 * What a view that already shows output up to `replayed` (its snapshot's cursor) should write for `chunk`, so a chunk
 * that overlaps the snapshot is not printed twice. `reset` means the view lost output in between and must clear first.
 */
export function unseenOutput(chunk: TerminalChunk, replayed: number): { data: string; reset: boolean } | null {
  if (chunk.cursor === undefined) return { data: chunk.data, reset: !!chunk.truncated }
  if (chunk.cursor <= replayed) return null
  const start = chunk.cursor - chunk.data.length
  if (start >= replayed) return { data: chunk.data, reset: !!chunk.truncated && start > replayed }
  return { data: chunk.data.slice(replayed - start), reset: false }
}
