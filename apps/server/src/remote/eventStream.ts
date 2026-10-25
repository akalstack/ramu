import type { ServerResponse } from 'node:http'
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

/** finish precedes close when a stream is ended (for example by revocation). Also absorb asynchronous write errors. */
export function watchEventStream(response: ServerResponse, detach: () => void): void {
  let detached = false
  const cleanup = () => {
    if (detached) return
    detached = true
    detach()
  }
  response.once('finish', cleanup)
  response.once('close', cleanup)
  response.on('error', () => {
    cleanup()
    response.destroy()
  })
}
