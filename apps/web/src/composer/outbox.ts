// Messages written while this window's computer is unreachable wait here, in this client's localStorage, and are
// sent in order once it reconnects. They always go out as queued messages, so a late arrival never steers a running turn.
import { useSyncExternalStore } from 'react'
import type { Attachment, FileContext } from '@ramu/shared/types'

const KEY = 'ramu.outbox'
/** Per chat. Beyond this the composer refuses, rather than piling up prompts that would all run later. */
export const OUTBOX_LIMIT = 10

type Store = Pick<Storage, 'getItem' | 'setItem'>

export interface OutboxItem {
  id: string
  sessionId: string
  text: string
  attachments: Attachment[]
  context: FileContext[]
  createdAt: number
  /** `failed` waits for Retry or Remove: the host may or may not have received it. */
  state: 'waiting' | 'sending' | 'failed'
  error?: string
}

export type Submit = (item: OutboxItem) => Promise<unknown>

export function createOutbox({
  store,
  submit,
  connected,
  now = Date.now,
  uid = () => crypto.randomUUID(),
}: {
  store: Store | null
  submit: Submit
  connected: () => boolean
  now?: () => number
  uid?: () => string
}) {
  const read = (): OutboxItem[] => {
    try {
      const saved = JSON.parse(store?.getItem(KEY) ?? '[]') as OutboxItem[]
      if (!Array.isArray(saved)) return []
      // A send cut off by closing the window may have reached the host, so it needs a person to decide.
      return saved
        .filter(
          (item) =>
            item && typeof item.id === 'string' && typeof item.sessionId === 'string' && typeof item.text === 'string',
        )
        .map((item) =>
          item.state === 'sending'
            ? { ...item, state: 'failed', error: 'The app closed while sending. Check the chat before retrying.' }
            : item,
        )
    } catch {
      return []
    }
  }
  let items = read()
  let running: Promise<void> | null = null,
    again = false
  const listeners = new Set<() => void>()
  const write = (next: OutboxItem[]) => {
    items = next
    try {
      store?.setItem(KEY, JSON.stringify(next))
    } catch {}
    for (const listener of listeners) listener()
  }
  const update = (id: string, patch: Partial<OutboxItem>) =>
    write(items.map((item) => (item.id === id ? { ...item, ...patch } : item)))

  /** Sends waiting messages oldest first. A failure holds back the rest of its chat so the order is kept. */
  const drain = async () => {
    const blocked = new Set<string>()
    for (;;) {
      if (!connected()) return
      let next: OutboxItem | undefined
      for (const item of items) {
        if (blocked.has(item.sessionId)) continue
        if (item.state === 'waiting') {
          next = item
          break
        }
        blocked.add(item.sessionId)
      }
      if (!next) return
      const sending = next
      update(sending.id, { state: 'sending', error: undefined })
      try {
        await submit(sending)
        write(items.filter((item) => item.id !== sending.id))
      } catch (error) {
        // Losing the connection mid-send is not the message's fault; it waits for the next reconnect.
        if (!connected()) {
          update(sending.id, { state: 'waiting' })
          return
        }
        update(sending.id, { state: 'failed', error: error instanceof Error ? error.message : String(error) })
        blocked.add(sending.sessionId)
      }
    }
  }
  /** One delivery at a time. A call during a delivery makes it look again once it finishes, and shares its promise. */
  const flush = (): Promise<void> => {
    if (running) {
      again = true
      return running
    }
    running = (async () => {
      do {
        again = false
        await drain()
      } while (again)
    })().finally(() => {
      running = null
    })
    return running
  }

  return {
    list: (sessionId: string) => items.filter((item) => item.sessionId === sessionId),
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    snapshot: () => items,
    /** Returns false when the chat already holds the limit. */
    add(sessionId: string, text: string, attachments: Attachment[] = [], context: FileContext[] = []): boolean {
      if (items.filter((item) => item.sessionId === sessionId).length >= OUTBOX_LIMIT) return false
      write([...items, { id: uid(), sessionId, text, attachments, context, createdAt: now(), state: 'waiting' }])
      void flush()
      return true
    },
    /** Takes a message back, for editing or deleting. One being sent right now can't be recalled. */
    remove(id: string): OutboxItem | undefined {
      const item = items.find((entry) => entry.id === id)
      if (!item || item.state === 'sending') return undefined
      write(items.filter((entry) => entry.id !== id))
      return item
    },
    retry(id: string) {
      if (items.find((item) => item.id === id)?.state === 'failed') {
        update(id, { state: 'waiting', error: undefined })
        void flush()
      }
    },
    flush,
  }
}

export type Outbox = ReturnType<typeof createOutbox>

let shared: Outbox | null = null
/** One outbox per window. It starts sending whenever the window's computer comes back. */
export function outbox(): Outbox {
  if (shared) return shared
  // Read from window here, not at import, so tests of createOutbox need no preload bridge.
  const { ramu } = window
  let online = true
  shared = createOutbox({
    store: (() => {
      try {
        return globalThis.localStorage ?? null
      } catch {
        return null
      }
    })(),
    connected: () => online,
    submit: (item) =>
      ramu.invoke(
        'agent.submit',
        item.sessionId,
        item.text,
        'queue',
        item.attachments.map((file) => file.id),
        item.context,
      ),
  })
  const instance = shared
  const set = (value: boolean) => {
    const back = value && !online
    online = value
    if (back) void instance.flush()
  }
  ramu.on('background:connection', ({ connected }) => set(connected))
  ramu.on('computers:changed', (state) => {
    const current = state.computers.find((computer) => computer.id === state.current)
    if (current) set(current.status === 'connected')
  })
  void ramu.invoke('computers.list').then(
    (state) => {
      const current = state.computers.find((computer) => computer.id === state.current)
      set(current ? current.status === 'connected' : true)
      void instance.flush()
    },
    () => {},
  )
  return instance
}

export function useOutbox(sessionId: string): OutboxItem[] {
  const box = outbox()
  const all = useSyncExternalStore(box.subscribe, box.snapshot)
  return all.filter((item) => item.sessionId === sessionId)
}
