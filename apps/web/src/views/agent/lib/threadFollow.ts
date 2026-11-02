import { bridge } from '../../../ipc'

const followed = new Map<string, Map<string, number>>()
let sending: Promise<unknown> = Promise.resolve()

/**
 * Asks a host to stream this thread in full until the returned function runs; every other thread stays in brief.
 * `ready` settles once the host has been told, so a read after it cannot miss a row that was still being filtered.
 */
export function followThread(host: string, sessionId: string): { ready: Promise<unknown>; stop(): void } {
  const counts = followed.get(host) ?? new Map<string, number>()
  followed.set(host, counts)
  const tell = () => {
    sending = sending.catch(() => {}).then(() => bridge.invoke('computers.threads', host, [...counts.keys()]))
    return sending
  }
  counts.set(sessionId, (counts.get(sessionId) ?? 0) + 1)
  const ready = counts.get(sessionId) === 1 ? tell() : sending
  return {
    ready,
    stop() {
      const left = (counts.get(sessionId) ?? 1) - 1
      if (left) counts.set(sessionId, left)
      else {
        counts.delete(sessionId)
        void tell().catch(() => {})
      }
    },
  }
}
