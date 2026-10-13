// Unsent composer text survives switching chats, closing the window and restarting. It lives in this client's
// localStorage (per device), keyed by chat or by project for a new chat, and is removed when the message is sent.
import { useEffect, useRef } from 'react'

const PREFIX = 'ramu.draft.'
const MAX_LENGTH = 200_000
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
const SAVE_DELAY_MS = 300

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>

export const draftKey = {
  chat: (sessionId: string) => `chat:${sessionId}`,
  newChat: (projectId: string) => `new:${projectId}`,
}

const defaultStore = (): Store | null => { try { return globalThis.localStorage ?? null } catch { return null } }

export function loadDraft(key: string, store: Store | null = defaultStore(), now = Date.now()): string {
  try {
    const raw = store?.getItem(PREFIX + key)
    if (!raw) return ''
    const saved = JSON.parse(raw) as { text?: unknown; at?: unknown }
    if (typeof saved.text !== 'string' || typeof saved.at !== 'number' || now - saved.at > MAX_AGE_MS) { store?.removeItem(PREFIX + key); return '' }
    return saved.text
  } catch { return '' }
}

/** Whitespace-only text is not a draft. Storage failures (quota, privacy mode) are ignored: a draft is a convenience. */
export function saveDraft(key: string, text: string, store: Store | null = defaultStore(), now = Date.now()): void {
  try {
    if (!text.trim()) store?.removeItem(PREFIX + key)
    else store?.setItem(PREFIX + key, JSON.stringify({ text: text.slice(0, MAX_LENGTH), at: now }))
  } catch {}
}

export function clearDraft(key: string, store: Store | null = defaultStore()): void { try { store?.removeItem(PREFIX + key) } catch {} }

/** Drops drafts nobody has touched for 30 days, such as those of deleted chats. */
export function pruneDrafts(store: Store | null = defaultStore(), now = Date.now()): void {
  try {
    if (!store) return
    for (let index = store.length - 1; index >= 0; index--) {
      const name = store.key(index)
      if (name?.startsWith(PREFIX)) loadDraft(name.slice(PREFIX.length), store, now)
    }
  } catch {}
}

/** Saves `value` under `key` shortly after it stops changing, and immediately when the key changes or the page closes. */
export function useDraftPersistence(key: string, value: string): void {
  const pending = useRef<{ key: string; value: string } | null>(null)
  useEffect(() => {
    if (pending.current && pending.current.key !== key) saveDraft(pending.current.key, pending.current.value)
    const entry = pending.current = { key, value }
    const timer = setTimeout(() => { saveDraft(entry.key, entry.value); if (pending.current === entry) pending.current = null }, SAVE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [key, value])
  useEffect(() => {
    const flush = () => { if (pending.current) saveDraft(pending.current.key, pending.current.value); pending.current = null }
    window.addEventListener('pagehide', flush)
    return () => { window.removeEventListener('pagehide', flush); flush() }
  }, [])
}
