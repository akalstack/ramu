/** Tracks arrivals by durable sequence so streaming, folding and pagination cannot replay them. */
export function transcriptArrivals() {
  let ready = false
  let baseline = 0
  const seen = new Set<number>()
  return {
    sync(sequences: Iterable<number>, hydrating: boolean) {
      if (ready) return
      for (const seq of sequences) baseline = Math.max(baseline, seq)
      ready = !hydrating
    },
    /** Whether this row arrived after the chat loaded, without using up its one entrance. */
    fresh(seq: number | undefined) {
      return ready && seq !== undefined && seq > baseline
    },
    claim(seq: number | undefined) {
      if (!ready || seq === undefined || seq <= baseline || seen.has(seq)) return false
      seen.add(seq)
      return true
    },
  }
}
