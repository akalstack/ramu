import { Platform } from 'react-native'
import * as SecureStore from 'expo-secure-store'
import { File, Paths } from 'expo-file-system'
import { LocalCommitError, readLocalCommit, writeLocalCommit, type LocalCommitStorage } from './localCommit'

const key = 'ramu.mobile.v1'
const preferenceKey = 'ramu.mobile.appearance'
const commits: LocalCommitStorage = {
  read: (slot) => {
    const file = new File(Paths.document, `${key}.${slot}.json`)
    return file.exists ? file.textSync() : null
  },
  write: (slot, text) => new File(Paths.document, `${key}.${slot}.json`).write(text),
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
  else new File(Paths.document, preferenceKey).write(value)
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
  else new File(Paths.document, textSizeKey).write(value)
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
  else new File(Paths.document, name).write(value)
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
      try {
        const committed = readLocalCommit(commits)
        if (committed) return { ...fallback, ...committed }
      } catch (error) {
        // An interrupted first migration still has its original profile. Never roll a newer version back.
        if (
          !(error instanceof LocalCommitError) ||
          error.code !== 'corrupt' ||
          !new File(Paths.document, `${key}.json`).exists
        )
          throw error
      }
    }
    // Leave the old profile intact as the migration fallback; the first new commit writes another file.
    const text = Platform.OS === 'web' ? localStorage.getItem(key) : new File(Paths.document, `${key}.json`).textSync()
    return text ? { ...fallback, ...JSON.parse(text) } : fallback
  } catch {
    return fallback
  }
}
export function writeLocal(value: unknown, options?: { replaceBackups?: boolean }) {
  if (Platform.OS === 'web') localStorage.setItem(key, JSON.stringify(value))
  else {
    const legacy = new File(Paths.document, `${key}.json`)
    // A readable legacy file is the recovery source only until the first new commit succeeds.
    if (legacy.exists) JSON.parse(legacy.textSync())
    writeLocalCommit(commits, value as Record<string, unknown>, legacy.exists)
    if (legacy.exists) legacy.delete()
    // Forget host must remove its device-local copies from both recovery slots.
    if (options?.replaceBackups) writeLocalCommit(commits, value as Record<string, unknown>)
  }
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
    else new File(Paths.document, visitKey).write(String(at))
  } catch {
    // Losing the marker only means Inbox shows a few more recaps as new.
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
      new File(/\.(states|scenarios)$/.test(key) ? Paths.document : Paths.cache, encodeURIComponent(key)).write(value)
  },
}
