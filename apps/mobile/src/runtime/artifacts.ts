// Artifacts on the phone: a saved copy for when the host is away, and record changes made offline.
// No React Native in here, so it is unit tested.
import type { InteractiveDocument } from '@ramu/shared/interactive'

export interface Storage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const copyKey = (computerId: string, artifactId: string) => `ramu.artifact.copy.${computerId}.${artifactId}`
const queueKey = (computerId: string, artifactId: string) => `ramu.artifact.queue.${computerId}.${artifactId}`

/** The last version opened here, shown as a saved copy until the host answers. Never shown as current. */
export function savePageCopy(storage: Storage, computerId: string, artifactId: string, document: InteractiveDocument) {
  try {
    const text = JSON.stringify(document)
    if (text.length < 2_000_000) storage.setItem(copyKey(computerId, artifactId), text)
  } catch {
    // A full cache only means no saved copy.
  }
}

export function pageCopy(storage: Storage, computerId: string, artifactId: string): InteractiveDocument | null {
  try {
    const value = JSON.parse(storage.getItem(copyKey(computerId, artifactId)) ?? 'null') as InteractiveDocument | null
    return value?.reference && typeof value.html === 'string' ? value : null
  } catch {
    return null
  }
}

/** A frame call made while the host was away, kept in order to send when it answers. */
export interface QueuedCall {
  id: string
  method: string
  args: unknown[]
  at: number
}

/** Calls that can wait for the host: adding and changing records, and asking the page's model. */
export const QUEUEABLE = new Set(['records.add', 'records.update', 'ai.ask'])

export function queuedCalls(storage: Storage, computerId: string, artifactId: string): QueuedCall[] {
  try {
    const value = JSON.parse(storage.getItem(queueKey(computerId, artifactId)) ?? '[]')
    return Array.isArray(value) ? value.slice(0, 200) : []
  } catch {
    return []
  }
}

export function queueCall(storage: Storage, computerId: string, artifactId: string, call: QueuedCall): boolean {
  const queue = queuedCalls(storage, computerId, artifactId)
  if (queue.length >= 200) return false
  try {
    storage.setItem(queueKey(computerId, artifactId), JSON.stringify([...queue, call]))
    return true
  } catch {
    return false
  }
}

/**
 * Sends queued calls in order. A call the host refuses (a record that no longer fits, say) is kept aside as a conflict
 * to show, never silently dropped or overwritten; one that could not reach the host stops the sync for a later try.
 */
export async function syncCalls(
  storage: Storage,
  computerId: string,
  artifactId: string,
  send: (call: QueuedCall) => Promise<unknown>,
  reachable: (error: unknown) => boolean,
): Promise<{ sent: number; conflicts: { call: QueuedCall; error: string }[]; results: Map<string, unknown> }> {
  const queue = queuedCalls(storage, computerId, artifactId)
  const conflicts: { call: QueuedCall; error: string }[] = []
  const results = new Map<string, unknown>()
  let sent = 0
  for (const [index, call] of queue.entries()) {
    try {
      results.set(call.id, await send(call))
      sent++
    } catch (error) {
      if (!reachable(error)) {
        storage.setItem(queueKey(computerId, artifactId), JSON.stringify(queue.slice(index)))
        return { sent, conflicts, results }
      }
      conflicts.push({ call, error: error instanceof Error ? error.message : String(error) })
    }
  }
  storage.setItem(queueKey(computerId, artifactId), '[]')
  return { sent, conflicts, results }
}
