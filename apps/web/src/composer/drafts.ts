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
export function saveDraft(
  key: string,
  text: string,
  store: Store | null = defaultStore(),
  now = Date.now(),
  writer?: { id: string; revision: number },
): boolean {
  try {
    if (!store) return !text.trim()
    if (!text.trim()) store?.removeItem(PREFIX + key)
    else
      store?.setItem(
        PREFIX + key,
        JSON.stringify({ text: text.slice(0, MAX_LENGTH), at: now, ...(writer ? { writer } : {}) }),
      )
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

interface DraftEntry {
  key: string
  value: string
  host: string
  writer: { id: string; revision: number }
  original: string | null | undefined
  consumed: boolean
}
interface DraftConsumption {
  unchanged: boolean
  persisted: boolean
}
const save = (entry: DraftEntry) =>
  entry.consumed || saveDraft(entry.key, entry.value, draftStore(entry.host), Date.now(), entry.writer)
const sameScope = (a: DraftEntry, b: DraftEntry) => a.key === b.key && a.host === b.host
const rawDraft = (key: string, host: string) => {
  try {
    return draftStore(host)?.getItem(PREFIX + key) ?? null
  } catch {
    return undefined
  }
}

/**
 * Saves `value` under `key` shortly after it stops changing, and immediately when the key changes or the page closes.
 * `host` is the host the chat or project belongs to (`useHost().id`); its storage and checkpoint are that host's.
 */
export function useDraftPersistence(key: string, value: string, host: string = ownHostId()): () => DraftConsumption {
  const owner = useRef<string | null>(null)
  owner.current ??= crypto.randomUUID()
  const revision = useRef(0)
  const current = useRef<DraftEntry | null>(null)
  if (
    !current.current ||
    current.current.key !== key ||
    current.current.host !== host ||
    current.current.value !== value
  ) {
    const previous = current.current
    current.current = {
      key,
      value,
      host,
      writer: { id: owner.current, revision: ++revision.current },
      // Keep the scope's original baseline: typing must not adopt a newer write made by another window.
      original: previous?.key === key && previous.host === host ? previous.original : rawDraft(key, host),
      consumed: Boolean(previous?.consumed && previous.key === key && previous.host === host && !value.trim()),
    }
  }
  const rendered = current.current
  useEffect(() => registerWorkspaceCheckpoint(async () => save(current.current!), host), [host])
  const pending = useRef<DraftEntry | null>(null)
  useEffect(() => {
    if (pending.current && (pending.current.key !== key || pending.current.host !== host)) save(pending.current)
    const entry = (pending.current = rendered)
    const timer = setTimeout(() => {
      save(entry)
      if (pending.current === entry) pending.current = null
    }, SAVE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [key, value, host, rendered])
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

  // The returned function belongs to this exact render. A late acknowledgement never consumes a newer edit.
  return () => {
    const unchanged = current.current === rendered
    rendered.consumed = true
    if (pending.current === rendered) pending.current = null
    if (!unchanged && sameScope(current.current!, rendered)) return { unchanged, persisted: true }
    try {
      const store = draftStore(rendered.host)
      if (!store) return { unchanged, persisted: true }
      const raw = store.getItem(PREFIX + rendered.key)
      if (raw === null) return { unchanged, persisted: true }
      const record = JSON.parse(raw) as { writer?: { id?: unknown; revision?: unknown } }
      const ownOlderWrite =
        record.writer?.id === rendered.writer.id &&
        typeof record.writer.revision === 'number' &&
        record.writer.revision <= rendered.writer.revision
      if (raw === rendered.original || ownOlderWrite) store.removeItem(PREFIX + rendered.key)
      return { unchanged, persisted: true }
    } catch {
      return { unchanged, persisted: false }
    }
  }
}
