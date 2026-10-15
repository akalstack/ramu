import { Platform } from 'react-native'
import * as SecureStore from 'expo-secure-store'
import { File, Paths } from 'expo-file-system'

const key = 'ramu.mobile.v1'
const preferenceKey = 'ramu.mobile.appearance'
export function readAppearance(): 'system' | 'light' | 'dark' {
  try { const value = Platform.OS === 'web' ? localStorage.getItem(preferenceKey) : new File(Paths.document, preferenceKey).textSync(); return value === 'light' || value === 'dark' ? value : 'system' } catch { return 'system' }
}
export function saveAppearance(value: string) {
  if (Platform.OS === 'web') localStorage.setItem(preferenceKey, value)
  else new File(Paths.document, preferenceKey).write(value)
}
/** Serialize writes so a slower save cannot overwrite a newer draft or computer list. */
export function readLocal<T>(fallback: T): T {
  try {
    const text = Platform.OS === 'web' ? localStorage.getItem(key) : new File(Paths.document, `${key}.json`).textSync()
    return text ? { ...fallback, ...JSON.parse(text) } : fallback
  } catch { return fallback }
}
export function writeLocal(value: unknown) {
  const text = JSON.stringify(value)
  if (Platform.OS === 'web') localStorage.setItem(key, text)
  else new File(Paths.document, `${key}.json`).write(text)
}
const tokenKey = (id: string) => `ramu.token.${id}`
export async function readToken(id: string): Promise<string | null> {
  return Platform.OS === 'web' ? localStorage.getItem(tokenKey(id)) : SecureStore.getItemAsync(tokenKey(id))
}
export async function saveToken(id: string, token: string) {
  if (Platform.OS === 'web') localStorage.setItem(tokenKey(id), token)
  else await SecureStore.setItemAsync(tokenKey(id), token, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY })
}
export async function deleteToken(id: string) {
  if (Platform.OS === 'web') localStorage.removeItem(tokenKey(id))
  else await SecureStore.deleteItemAsync(tokenKey(id))
}
