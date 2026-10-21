// Transport-independent rules for resuming a stream without missing or duplicating data. They work on sequence
// cursors, so HTTP/SSE and a later WebSocket path share one meaning of "current", "synchronizing" and "reset".

export type ConnectionOutcome = 'current' | 'synchronizing' | 'disconnected' | 'rejected' | 'unknown'

/** What the server still holds for one stream. */
export interface StreamWindow {
  /** Identity of this server run for the stream; a restart changes it and invalidates every cursor. */
  epoch: string
  /** Lowest sequence still replayable, and the latest one produced. */
  first: number
  last: number
  /** Bytes a replay from each client's cursor would send, when known. */
  replayBytes?: number
}

export interface ResumeBounds {
  maxReplayItems: number
  maxReplayBytes: number
}

export type ResumePlan =
  | { kind: 'live' }
  | { kind: 'replay'; from: number; items: number }
  | { kind: 'snapshot'; reason: 'no-cursor' | 'restart' | 'expired' | 'ahead' | 'too-large' }

/**
 * How a client at `cursor` catches up. Exactly current resumes live; a bounded gap is replayed; anything the server
 * can no longer replay, or that would be too large, gets an authoritative snapshot instead of a silent skip.
 */
export function planResume(
  client: { epoch: string | null; cursor: number | null },
  window: StreamWindow,
  bounds: ResumeBounds,
): ResumePlan {
  if (client.cursor === null || client.epoch === null) return { kind: 'snapshot', reason: 'no-cursor' }
  if (client.epoch !== window.epoch) return { kind: 'snapshot', reason: 'restart' }
  if (client.cursor > window.last) return { kind: 'snapshot', reason: 'ahead' }
  if (client.cursor === window.last) return { kind: 'live' }
  // The next item the client needs is cursor + 1; if it has been trimmed away the gap cannot be replayed.
  if (client.cursor + 1 < window.first) return { kind: 'snapshot', reason: 'expired' }
  const items = window.last - client.cursor
  if (items > bounds.maxReplayItems || (window.replayBytes ?? 0) > bounds.maxReplayBytes)
    return { kind: 'snapshot', reason: 'too-large' }
  return { kind: 'replay', from: client.cursor + 1, items }
}

export interface BufferedItem<T> {
  seq: number
  size: number
  value: T
}

/**
 * Live items that arrive while a snapshot or replay is still loading. Bounded by count and bytes: overflow is
 * reported so the consumer restarts synchronization rather than applying a stream with a hole in it.
 */
export class LiveBuffer<T> {
  private items: BufferedItem<T>[] = []
  private bytes = 0
  private over = false
  constructor(
    private readonly maxItems: number,
    private readonly maxBytes: number,
  ) {}

  push(item: BufferedItem<T>): void {
    if (this.over) return
    if (this.items.length + 1 > this.maxItems || this.bytes + item.size > this.maxBytes) {
      this.over = true
      this.items = []
      this.bytes = 0
      return
    }
    this.items.push(item)
    this.bytes += item.size
  }

  get overflowed(): boolean {
    return this.over
  }

  /**
   * The buffered values that follow `cursor`, in order and without repeats. A hole between the cursor and the first
   * buffered item, or an overflow, returns null: the caller must resynchronize.
   */
  drainAfter(cursor: number): T[] | null {
    if (this.over) return null
    const fresh = this.items.filter((item) => item.seq > cursor).sort((a, b) => a.seq - b.seq)
    this.items = []
    this.bytes = 0
    let expected = cursor + 1
    const out: T[] = []
    for (const item of fresh) {
      if (item.seq < expected) continue
      if (item.seq !== expected) return null
      out.push(item.value)
      expected++
    }
    return out
  }
}

/**
 * Application-level window for terminal output: how much sent data the consumer has not acknowledged yet. When it is
 * full the producer stops sending, so a slow consumer cannot build an unbounded queue. Acknowledging output is not
 * acknowledging that a command finished.
 */
export class OutputWindow {
  private unacked = 0
  constructor(private readonly limit: number) {}

  /** Whether a chunk of this size may be sent now. An oversize chunk is allowed alone so output cannot stall forever. */
  canSend(size: number): boolean {
    return this.unacked === 0 || this.unacked + size <= this.limit
  }

  sent(size: number): void {
    this.unacked += size
  }

  ack(size: number): void {
    this.unacked = Math.max(0, this.unacked - size)
  }

  get pending(): number {
    return this.unacked
  }
}
