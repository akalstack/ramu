// Unsent composer text survives switching chats, closing the window and restarting. It lives in this client's
// localStorage (per device and host), keyed by chat or by project for a new chat, and is removed when the message is sent.
import { useEffect, useRef } from 'react'
import { registerWorkspaceCheckpoint } from '../workspace/workspaceCheckpoint'
import { ownHostStore, storeForHost } from '../hostStorage'
import { ownHostId } from '../hosts'

const PREFIX = 'ramu.draft.'
const MAX_LENGTH = 200_000
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
const SAVE_DELAY_MS = 300

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>

export const draftKey = {
  chat: (sessionId: string) => `chat:${sessionId}`,
  newChat: (projectId: string) => `new:${projectId}`,
}

const defaultStore = (): Store | null => {
  try {
    return ownHostStore()
  } catch {
    return null
  }
}

/** Drafts of one host: a chat or project id only means something on its own host. */
export const draftStore = (host: string): Store | null => {
  try {
    return storeForHost(host)
  } catch {
    return null
  }
}

export function loadDraft(key: string, store: Store | null = defaultStore(), now = Date.now()): string {
  try {
    const raw = store?.getItem(PREFIX + key)
    if (!raw) return ''
    const saved = JSON.parse(raw) as { text?: unknown; at?: unknown }
    if (typeof saved.text !== 'string' || typeof saved.at !== 'number' || now - saved.at > MAX_AGE_MS) {
      store?.removeItem(PREFIX + key)
      return ''
    }
    return saved.text
  } catch {
    return ''
  }
}

/** Whitespace-only text is not a draft. Storage failures (quota, privacy mode) are ignored: a draft is a convenience. */
export function saveDraft(key: string, text: string, store: Store | null = defaultStore(), now = Date.now()): boolean {
  try {
    if (!store) return !text.trim()
    if (!text.trim()) store?.removeItem(PREFIX + key)
    else store?.setItem(PREFIX + key, JSON.stringify({ text: text.slice(0, MAX_LENGTH), at: now }))
    return text.length <= MAX_LENGTH
  } catch {
    return false
  }
}

export function clearDraft(key: string, store: Store | null = defaultStore()): void {
  try {
    store?.removeItem(PREFIX + key)
  } catch {}
}

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

const save = (entry: { key: string; value: string; host: string }) =>
  saveDraft(entry.key, entry.value, draftStore(entry.host))

/**
 * Saves `value` under `key` shortly after it stops changing, and immediately when the key changes or the page closes.
 * `host` is the host the chat or project belongs to (`useHost().id`); its storage and checkpoint are that host's.
 */
export function useDraftPersistence(key: string, value: string, host: string = ownHostId()): void {
  const current = useRef({ key, value, host })
  current.current = { key, value, host }
  useEffect(() => registerWorkspaceCheckpoint(async () => save(current.current), host), [host])
  const pending = useRef<{ key: string; value: string; host: string } | null>(null)
  useEffect(() => {
    if (pending.current && (pending.current.key !== key || pending.current.host !== host)) save(pending.current)
    const entry = (pending.current = { key, value, host })
    const timer = setTimeout(() => {
      save(entry)
      if (pending.current === entry) pending.current = null
    }, SAVE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [key, value, host])
  useEffect(() => {
    const flush = () => {
      if (pending.current) save(pending.current)
      pending.current = null
    }
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [])
}
