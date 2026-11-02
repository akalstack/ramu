import { Platform } from 'react-native'
import * as SecureStore from 'expo-secure-store'
import { File, Paths } from 'expo-file-system'
import { readLocalCommit, writeLocalCommitAsync, type LocalCommitStorage } from './localCommit'

const key = 'ramu.mobile.v1'
const preferenceKey = 'ramu.mobile.appearance'
const commits: LocalCommitStorage = {
  read: (slot) => {
    const file = new File(Paths.document, `${key}.${slot}.json`)
    return file.exists ? file.textSync() : null
  },
  write: (slot, text) => new File(Paths.document, `${key}.${slot}.json`).writeSync(text),
}
export function readAppearance(): 'system' | 'light' | 'dark' {
  try {
    const value =
      Platform.OS === 'web' ? localStorage.getItem(preferenceKey) : new File(Paths.document, preferenceKey).textSync()
    return value === 'light' || value === 'dark' ? value : 'system'
  } catch {
    return 'system'
  }
}
export function saveAppearance(value: string) {
  if (Platform.OS === 'web') localStorage.setItem(preferenceKey, value)
  else new File(Paths.document, preferenceKey).writeSync(value)
}
const textSizeKey = 'ramu-text-size'
export type TextSize = 'default' | 'large' | 'larger'
/** The interface text size chosen on this phone; absent means the OS setting alone decides. */
export function readTextSize(): TextSize {
  try {
    const value =
      Platform.OS === 'web' ? localStorage.getItem(textSizeKey) : new File(Paths.document, textSizeKey).textSync()
    return value === 'large' || value === 'larger' ? value : 'default'
  } catch {
    return 'default'
  }
}
export function saveTextSize(value: TextSize) {
  if (Platform.OS === 'web') localStorage.setItem(textSizeKey, value)
  else new File(Paths.document, textSizeKey).writeSync(value)
}
const themeLibraryKey = 'ramu-theme-library'
const themeSelectedKey = 'ramu-theme-selected'
const readSmall = (name: string): string | null => {
  try {
    return Platform.OS === 'web' ? localStorage.getItem(name) : new File(Paths.document, name).textSync()
  } catch {
    return null
  }
}
const writeSmall = (name: string, value: string) => {
  if (Platform.OS === 'web') localStorage.setItem(name, value)
  else new File(Paths.document, name).writeSync(value)
}
const draftsKey = 'ramu.mobile.drafts'
/**
 * Composer drafts in their own small file. They change with every keystroke, so saving them with the profile (which
 * holds every transcript) would block typing and taps while it serializes. Null when none were saved here yet.
 */
export function readDrafts(): Record<string, string> | null {
  try {
    const text = readSmall(draftsKey)
    if (!text) return null
    const value = JSON.parse(text) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    return Object.fromEntries(
      Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    )
  } catch {
    return null
  }
}
export function writeDrafts(drafts: Record<string, string>) {
  writeSmall(draftsKey, JSON.stringify(drafts))
}
const sendingKey = 'ramu.mobile.sending'
/** Outbox ids handed to the network but not yet recorded in the saved profile; see `sendJournal.ts`. */
export function readSendJournal(): string[] {
  try {
    const value = JSON.parse(readSmall(sendingKey) ?? '[]')
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}
export function writeSendJournal(ids: readonly string[]) {
  writeSmall(sendingKey, JSON.stringify(ids))
}
/** Themes kept on this phone, as stored text; callers validate each document before use. */
export const readThemeLibraryText = () => readSmall(themeLibraryKey)
export const saveThemeLibraryText = (text: string) => writeSmall(themeLibraryKey, text)
/** The kept theme this phone shows; empty means Ramu Default. */
export const readSelectedThemeId = () => readSmall(themeSelectedKey) ?? ''
export const saveSelectedThemeId = (id: string) => writeSmall(themeSelectedKey, id)
/** Serialize writes so a slower save cannot overwrite a newer draft or computer list. */
export function readLocal<T>(fallback: T): T {
  try {
    if (Platform.OS !== 'web') {
      const committed = readLocalCommit(commits)
      return committed ? { ...fallback, ...committed } : fallback
    }
    const text = localStorage.getItem(key)
    return text ? { ...fallback, ...JSON.parse(text) } : fallback
  } catch {
    return fallback
  }
}
let pendingWrite: Promise<void> = Promise.resolve()
export function writeLocal(value: unknown, options?: { replaceBackups?: boolean }): Promise<void> {
  // Freeze the snapshot at enqueue time; the store keeps changing while disk I/O is pending.
  let snapshot: string
  try {
    snapshot = JSON.stringify(value)
  } catch (error) {
    return Promise.reject(error)
  }
  const run = pendingWrite.then(async () => {
    if (Platform.OS === 'web') {
      localStorage.setItem(key, snapshot)
      return
    }
    const asyncCommits = {
      read: async (slot: 0 | 1) => {
        const file = new File(Paths.document, `${key}.${slot}.json`)
        return file.exists ? file.text() : null
      },
      write: async (slot: 0 | 1, text: string) => {
        await new File(Paths.document, `${key}.${slot}.json`).write(text)
      },
    }
    await writeLocalCommitAsync(asyncCommits, JSON.parse(snapshot))
    if (options?.replaceBackups) await writeLocalCommitAsync(asyncCommits, JSON.parse(snapshot))
  })
  // A failed save is reported to its caller and must not poison later retries.
  pendingWrite = run.catch(() => {})
  return run
}

const tokenKey = (id: string) => `ramu.token.${id}`
export async function readToken(id: string): Promise<string | null> {
  return Platform.OS === 'web' ? localStorage.getItem(tokenKey(id)) : SecureStore.getItemAsync(tokenKey(id))
}
export async function saveToken(id: string, token: string) {
  if (Platform.OS === 'web') localStorage.setItem(tokenKey(id), token)
  else
    await SecureStore.setItemAsync(tokenKey(id), token, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    })
}
const renewedKey = (id: string) => `ramu.renewed.${id}`
/** When this phone last rotated its token for a host; absent means never. */
export async function readRenewedAt(id: string): Promise<number | null> {
  const value =
    Platform.OS === 'web' ? localStorage.getItem(renewedKey(id)) : await SecureStore.getItemAsync(renewedKey(id))
  return value && Number.isFinite(Number(value)) ? Number(value) : null
}
export async function saveRenewedAt(id: string, at: number) {
  if (Platform.OS === 'web') localStorage.setItem(renewedKey(id), String(at))
  else await SecureStore.setItemAsync(renewedKey(id), String(at))
}
export async function deleteToken(id: string) {
  if (Platform.OS === 'web') {
    localStorage.removeItem(tokenKey(id))
    localStorage.removeItem(renewedKey(id))
  } else {
    await SecureStore.deleteItemAsync(tokenKey(id))
    await SecureStore.deleteItemAsync(renewedKey(id))
  }
}
const visitKey = 'ramu.mobile.last-visit'
/** When the app was last left, for "since your last visit" in Inbox. */
export function readLastVisit(): number {
  try {
    const value = Platform.OS === 'web' ? localStorage.getItem(visitKey) : new File(Paths.document, visitKey).textSync()
    return Number(value) || 0
  } catch {
    return 0
  }
}
export function saveLastVisit(at: number) {
  try {
    if (Platform.OS === 'web') localStorage.setItem(visitKey, String(at))
    else new File(Paths.document, visitKey).writeSync(String(at))
  } catch {
    // Losing the marker only means Inbox shows a few more recaps as new.
  }
}

const failuresKey = 'ramu.mobile.failures-seen'
/** Failures this phone has opened, each with the activity time it was seen at. */
export function readFailuresSeen(): Record<string, number> {
  try {
    const value =
      Platform.OS === 'web' ? localStorage.getItem(failuresKey) : new File(Paths.document, failuresKey).textSync()
    return value ? (JSON.parse(value) as Record<string, number>) : {}
  } catch {
    return {}
  }
}
export function saveFailuresSeen(seen: Record<string, number>) {
  try {
    const text = JSON.stringify(seen)
    if (Platform.OS === 'web') localStorage.setItem(failuresKey, text)
    else new File(Paths.document, failuresKey).writeSync(text)
  } catch {
    // Losing the marks only means a failure already opened shows in Inbox again.
  }
}

/** A separate, bounded content cache; never rewrites account/draft storage. */
export const contentStorage = {
  getItem(key: string): string | null {
    try {
      return Platform.OS === 'web'
        ? localStorage.getItem(key)
        : new File(/\.(states|scenarios)$/.test(key) ? Paths.document : Paths.cache, encodeURIComponent(key)).textSync()
    } catch {
      return null
    }
  },
  setItem(key: string, value: string) {
    if (Platform.OS === 'web') localStorage.setItem(key, value)
    else
      new File(/\.(states|scenarios)$/.test(key) ? Paths.document : Paths.cache, encodeURIComponent(key)).writeSync(
        value,
      )
  },
}
const linkKey = 'ramu.link.v1'
/** Ramu Link on this phone: the service, the account it is signed in to and each paired host's pinned key. */
export const readLinkStateText = () => readSmall(linkKey)
export const saveLinkStateText = (text: string) => writeSmall(linkKey, text)
