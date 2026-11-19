import type { Memory } from '../types'

/**
 * Where a saved note came from. A note remembers the thread and event it was saved in, but the thread can be deleted
 * later, so a link is offered only for a thread the host still lists; otherwise the note says its source is gone instead of
 * showing a link that leads nowhere. Notes saved by hand or by cleanup have no conversation source.
 */
export type MemorySourceThread =
  | { state: 'none' }
  | { state: 'unavailable' }
  | { state: 'thread'; taskId: string; sessionId?: string; eventSeq?: number }

export function memorySourceThread(source: Memory['source'], knownTaskIds: ReadonlySet<string>): MemorySourceThread {
  if (!source.taskId && !source.sessionId) return { state: 'none' }
  if (!source.taskId || !knownTaskIds.has(source.taskId)) return { state: 'unavailable' }
  return {
    state: 'thread',
    taskId: source.taskId,
    ...(source.sessionId ? { sessionId: source.sessionId } : {}),
    ...(source.eventSeq !== undefined ? { eventSeq: source.eventSeq } : {}),
  }
}
