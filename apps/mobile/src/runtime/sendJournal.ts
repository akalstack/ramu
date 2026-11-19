import type { OutboxItem } from './store'

export const INTERRUPTED_SEND = 'App closed during delivery. Check the host before retrying.'

/**
 * Messages handed to the network are recorded in a tiny journal instead of rewriting the whole profile (every
 * transcript) before each send. After a crash, any journalled message the saved profile still shows as waiting or
 * sending may have reached the host, so it needs the same check as an interrupted send.
 */
export function restoreOutbox(outbox: OutboxItem[], journal: readonly string[]): OutboxItem[] {
  const sent = new Set(journal)
  return outbox.map((item) =>
    item.state === 'sending' || (sent.has(item.id) && item.state === 'waiting')
      ? { ...item, state: 'uncertain', error: INTERRUPTED_SEND }
      : item,
  )
}

/** The journal entries still needed once `saved` is on disk: only a message the profile still shows as waiting. */
export function remainingJournal(journal: readonly string[], saved: readonly OutboxItem[]): string[] {
  return journal.filter((id) => saved.some((item) => item.id === id && item.state === 'waiting'))
}
