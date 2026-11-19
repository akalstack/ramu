import type { EventSink } from './socket'

/** Backpressure is not a failed send, but an ended transport must never receive another event. */
export function writeEvent(sink: EventSink & { readonly writableEnded?: boolean }, chunk: string): boolean {
  if (sink.destroyed || sink.writableEnded) return false
  try {
    sink.write(chunk)
    return !sink.destroyed && !sink.writableEnded
  } catch {
    sink.destroy()
    return false
  }
}
