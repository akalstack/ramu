// Pages on the phone: links that open one, a saved copy for when the host is away, and record changes made offline.
// No React Native in here, so it is unit tested.
import type { InteractiveDocument } from '@ramu/shared/interactive'

export interface PageLink {
  computerId: string
  pageId: string
  share?: string
}

/** A `ramu://page/<host>/<page>` link (with `?share=` for a share link), as Add to Home Screen and share links use. */
export function pageLink(link: PageLink): string {
  return `ramu://page/${encodeURIComponent(link.computerId)}/${encodeURIComponent(link.pageId)}${link.share ? `?share=${encodeURIComponent(link.share)}` : ''}`
}

export function parsePageLink(url: string): PageLink | null {
  const match = /^ramu:\/\/page\/([^/?#]{1,120})\/([\w-]{1,80})(?:\?share=([\w-]{8,80}))?$/.exec(url.trim())
  if (!match) return null
  return {
    computerId: decodeURIComponent(match[1]!),
    pageId: match[2]!,
    ...(match[3] ? { share: match[3] } : {}),
  }
}

export interface Storage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const copyKey = (computerId: string, pageId: string) => `ramu.page.copy.${computerId}.${pageId}`
const queueKey = (computerId: string, pageId: string) => `ramu.page.queue.${computerId}.${pageId}`

/** The last version opened here, shown as a saved copy until the host answers. Never shown as current. */
export function savePageCopy(storage: Storage, computerId: string, pageId: string, document: InteractiveDocument) {
  try {
    const text = JSON.stringify(document)
    if (text.length < 2_000_000) storage.setItem(copyKey(computerId, pageId), text)
  } catch {
    // A full cache only means no saved copy.
  }
}

export function pageCopy(storage: Storage, computerId: string, pageId: string): InteractiveDocument | null {
  try {
    const value = JSON.parse(storage.getItem(copyKey(computerId, pageId)) ?? 'null') as InteractiveDocument | null
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

export function queuedCalls(storage: Storage, computerId: string, pageId: string): QueuedCall[] {
  try {
    const value = JSON.parse(storage.getItem(queueKey(computerId, pageId)) ?? '[]')
    return Array.isArray(value) ? value.slice(0, 200) : []
  } catch {
    return []
  }
}

export function queueCall(storage: Storage, computerId: string, pageId: string, call: QueuedCall): boolean {
  const queue = queuedCalls(storage, computerId, pageId)
  if (queue.length >= 200) return false
  try {
    storage.setItem(queueKey(computerId, pageId), JSON.stringify([...queue, call]))
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
  pageId: string,
  send: (call: QueuedCall) => Promise<unknown>,
  reachable: (error: unknown) => boolean,
): Promise<{ sent: number; conflicts: { call: QueuedCall; error: string }[]; results: Map<string, unknown> }> {
  const queue = queuedCalls(storage, computerId, pageId)
  const conflicts: { call: QueuedCall; error: string }[] = []
  const results = new Map<string, unknown>()
  let sent = 0
  for (const [index, call] of queue.entries()) {
    try {
      results.set(call.id, await send(call))
      sent++
    } catch (error) {
      if (!reachable(error)) {
        storage.setItem(queueKey(computerId, pageId), JSON.stringify(queue.slice(index)))
        return { sent, conflicts, results }
      }
      conflicts.push({ call, error: error instanceof Error ? error.message : String(error) })
    }
  }
  storage.setItem(queueKey(computerId, pageId), '[]')
  return { sent, conflicts, results }
}
