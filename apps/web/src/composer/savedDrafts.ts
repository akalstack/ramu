// Explicit saved drafts: one library per host in this device's storage. The pure move lives in
// @ramu/shared/chat/savedDrafts (shared with mobile); this adapter only reads, writes and verifies the commit.
import {
  moveMessageDraft,
  readSavedDrafts,
  SavedDraftError,
  type MessageDraftSnapshot,
  type SavedDraftCommand,
  type SavedDraftLibrary,
  type SavedDraftScope,
} from '@ramu/shared/chat/savedDrafts'
import { storeForHost, type Store } from '../hostStorage'

export const SAVED_DRAFTS_KEY = 'ramu.saved-drafts'

/** The library of one host. Corrupt or newer data throws and is left untouched; it is never read as empty. */
export function loadSavedDrafts(host: string, store: Store | null = storeForHost(host)): SavedDraftLibrary {
  return readSavedDrafts(store?.getItem(SAVED_DRAFTS_KEY) ?? null, host)
}

/**
 * Commits one move to storage and returns the new library and composer content. The caller updates the visible
 * composer only after this returns, so a failed write leaves the message editable and the saved source intact.
 */
export function commitSavedDraftMove(input: {
  host: string
  scope: SavedDraftScope
  active: MessageDraftSnapshot
  command: SavedDraftCommand
  store?: Store | null
}) {
  const store = input.store === undefined ? storeForHost(input.host) : input.store
  if (!store) throw new SavedDraftError('invalid')
  const library = loadSavedDrafts(input.host, store)
  const moved = moveMessageDraft({
    library,
    hostId: input.host,
    expectedRevision: library.revision,
    scope: input.scope,
    active: input.active,
    expectedActive: input.active,
    command: input.command,
  })
  const text = JSON.stringify(moved.library)
  try {
    store.setItem(SAVED_DRAFTS_KEY, text)
    if (store.getItem(SAVED_DRAFTS_KEY) !== text) throw new Error('not persisted')
  } catch {
    try {
      // Never leave a half-applied library behind.
      const previous = JSON.stringify(library)
      if (library.revision) store.setItem(SAVED_DRAFTS_KEY, previous)
      else store.removeItem(SAVED_DRAFTS_KEY)
    } catch {}
    throw new SavedDraftError('full')
  }
  return moved
}

export const savedDraftPreview = (snapshot: MessageDraftSnapshot) => {
  const line = snapshot.text.trim().split(/\r?\n/).find(Boolean) ?? ''
  return line.length > 80 ? `${line.slice(0, 79)}…` : line
}
