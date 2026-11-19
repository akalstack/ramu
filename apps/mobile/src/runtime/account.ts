// The phone's own side of the optional Ramu account: sign-in by code in the browser, the backup key kept in the
// phone's secure store, approving a new host's request for that key after both screens show the same number, the
// phone's own preferences backed up sealed in a slot of their own, and pairing with a listed host without a code.
// Device tokens, paired hosts' credentials and drafts never go into a backup.
import * as SecureStore from 'expo-secure-store'
import type { RamuTheme } from '@ramu/shared/theme'
import {
  ACCOUNT_LIMITS,
  ACCOUNT_URL,
  type AccountUser,
  type BackupSlotInfo,
  type KeyRequestInfo,
  type ListedHostInfo,
} from '@ramu/shared/account'
import {
  exchangeCommit,
  exchangeKeys,
  exchangeSecrets,
  fromBase64,
  newBackupKey,
  open,
  recoveryKey,
  seal,
  toBase64,
  type ExchangeKeys,
  type Random,
} from '@ramu/shared/accountCrypto'

const SESSION = 'ramu-account-session'
const KEY = 'ramu-account-backup-key'
const SLOT = 'ramu-account-phone-slot'
/** Set after the first backup of this phone: later changes then back up on their own. */
const AUTO = 'ramu-account-phone-backup'

/** What a phone backup carries: its look and its layout choices, nothing that grants access. */
export interface PhonePreferences {
  appearance: string
  textSize: string
  language: string
  /** Kept themes, and the one selected (null for Ramu Default). */
  themes: RamuTheme[]
  selectedTheme: string | null
  /** Device-only view choices kept as `pref-device:` drafts, such as the thread list's layout. */
  layout: Record<string, string>
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await SecureStore.getItemAsync(SESSION)
  const response = await fetch(`${ACCOUNT_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const parsed = (await response.json().catch(() => ({}))) as { error?: string; message?: string }
  if (response.status === 401 && token) await SecureStore.deleteItemAsync(SESSION)
  if (!response.ok)
    throw new Error(parsed.error ?? parsed.message ?? `The account service answered ${response.status}.`)
  return parsed as T
}

export async function accountUser(): Promise<AccountUser | null> {
  if (!(await SecureStore.getItemAsync(SESSION))) return null
  return call<AccountUser>('GET', '/api/me').catch(() => null)
}

export const hasBackupKey = async () => !!(await SecureStore.getItemAsync(KEY))

/** Starts the code sign-in; `wait` resolves with the user once the code is approved in the browser. */
export async function startSignIn(): Promise<{
  userCode: string
  url: string
  wait: () => Promise<AccountUser | null>
}> {
  const started = await call<{
    device_code: string
    user_code: string
    verification_uri: string
    verification_uri_complete?: string
    expires_in: number
    interval?: number
  }>('POST', '/api/auth/device/code', { client_id: 'ramu-phone' })
  const wait = async () => {
    const until = Date.now() + started.expires_in * 1000
    while (Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, Math.max(5, started.interval ?? 5) * 1000))
      const response = await fetch(`${ACCOUNT_URL}/api/auth/device/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          device_code: started.device_code,
          client_id: 'ramu-phone',
        }),
      }).catch(() => null)
      const body = (await response?.json().catch(() => ({}))) as { access_token?: string; error?: string }
      if (body?.access_token) {
        await SecureStore.setItemAsync(SESSION, body.access_token)
        return accountUser()
      }
      if (body?.error && !['authorization_pending', 'slow_down'].includes(body.error)) return null
    }
    return null
  }
  return {
    userCode: started.user_code,
    url: started.verification_uri_complete ?? `${started.verification_uri}?user_code=${started.user_code}`,
    wait,
  }
}

/** Whether this phone backs its preferences up after a change: signed in, and backed up once by hand. */
export async function autoBackup(): Promise<boolean> {
  return !!(await SecureStore.getItemAsync(AUTO)) && !!(await SecureStore.getItemAsync(SESSION))
}

export async function signOut() {
  await SecureStore.deleteItemAsync(AUTO)
  await call('POST', '/api/auth/sign-out', {}).catch(() => {})
  await SecureStore.deleteItemAsync(SESSION)
  await SecureStore.deleteItemAsync(KEY)
}

async function backupKey(): Promise<Uint8Array | null> {
  const saved = await SecureStore.getItemAsync(KEY)
  return saved ? fromBase64(saved) : null
}

// ---- New devices asking for the key ----

const answering = new Map<string, ExchangeKeys>()

export async function keyRequests(): Promise<{ id: string; name: string; code: string | null }[]> {
  if (!(await backupKey())) return []
  const requests = await call<KeyRequestInfo[]>('GET', '/api/key-requests')
  return requests.map((request) => {
    const keys = answering.get(request.id)
    const code =
      keys && request.requesterKey
        ? exchangeSecrets(keys.secret, request.requesterKey, {
            requestId: request.id,
            commit: request.commit,
            requesterKey: request.requesterKey,
            approverKey: keys.publicKey,
          }).code
        : null
    return { id: request.id, name: request.name, code }
  })
}

export async function answerKeyRequest(id: string, random: Random) {
  const keys = exchangeKeys(random)
  await call('POST', `/api/key-requests/${id}/offer`, { approverKey: keys.publicKey })
  answering.set(id, keys)
}

export async function approveKeyRequest(id: string, random: Random) {
  const keys = answering.get(id)
  const key = await backupKey()
  if (!keys || !key) throw new Error('Answer the request first.')
  const request = (await call<KeyRequestInfo[]>('GET', '/api/key-requests')).find((entry) => entry.id === id)
  if (!request?.requesterKey) throw new Error('The new device has not shown its number yet.')
  const secrets = exchangeSecrets(keys.secret, request.requesterKey, {
    requestId: id,
    commit: request.commit,
    requesterKey: request.requesterKey,
    approverKey: keys.publicKey,
  })
  await call('POST', `/api/key-requests/${id}/approve`, {
    envelope: toBase64(seal(secrets.key, key, random, `key:${id}`)),
  })
  answering.delete(id)
}

export async function denyKeyRequest(id: string) {
  await call('DELETE', `/api/key-requests/${id}`)
  answering.delete(id)
}

/** This phone asks a device that has the backup key for it; `onCode` shows the number to compare there. */
export async function requestKey(name: string, random: Random, onCode: (code: string) => void): Promise<void> {
  const keys = exchangeKeys(random)
  const { id } = await call<{ id: string }>('POST', '/api/key-requests', {
    name: name.slice(0, 60),
    commit: exchangeCommit(keys.publicKey),
  })
  const until = Date.now() + ACCOUNT_LIMITS.requestMs
  while (Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 2000))
    const request = await call<KeyRequestInfo>('GET', `/api/key-requests/${id}`)
    const transcript = (approverKey: string) => ({
      requestId: id,
      commit: request.commit,
      requesterKey: keys.publicKey,
      approverKey,
    })
    if (request.approverKey && !request.requesterKey) {
      await call('POST', `/api/key-requests/${id}/reveal`, { requesterKey: keys.publicKey })
      onCode(exchangeSecrets(keys.secret, request.approverKey, transcript(request.approverKey)).code)
    }
    if (request.envelope && request.approverKey) {
      const secrets = exchangeSecrets(keys.secret, request.approverKey, transcript(request.approverKey))
      await SecureStore.setItemAsync(
        KEY,
        toBase64(open(secrets.key, fromBase64(request.envelope), `key:${id}`).plaintext),
      )
      return
    }
  }
  throw new Error('No device answered in ten minutes. Try again.')
}

export async function useRecoveryCode(code: string) {
  const { sealed } = await call<{ sealed: string | null }>('GET', '/api/recovery')
  if (!sealed) throw new Error('This account has no recovery copy of a backup key.')
  await SecureStore.setItemAsync(KEY, toBase64(open(recoveryKey(code), fromBase64(sealed), 'recovery').plaintext))
}

// ---- This phone's preferences ----

async function slot(random: Random): Promise<string> {
  const saved = await SecureStore.getItemAsync(SLOT)
  if (saved) return saved
  const made = Array.from(random(16), (byte) => byte.toString(16).padStart(2, '0')).join('')
  await SecureStore.setItemAsync(SLOT, made)
  return made
}

/** Seals the phone's preferences under the backup key and keeps them in the account; makes a key if there is none. */
export async function backUpPhone(preferences: PhonePreferences, name: string, random: Random) {
  let key = await backupKey()
  if (!key) {
    key = newBackupKey(random)
    await SecureStore.setItemAsync(KEY, toBase64(key))
  }
  const id = await slot(random)
  await SecureStore.setItemAsync(AUTO, '1')
  const encode = (text: string) => new TextEncoder().encode(text)
  await call('PUT', `/api/backups/${id}`, {
    kind: 'phone',
    label: toBase64(seal(key, encode(name), random, `${id}:label`)),
    ciphertext: toBase64(seal(key, encode(JSON.stringify(preferences)), random, id)),
  })
}

/** A phone backup this person's phones made, newest first, opened here. */
export async function phoneBackups(): Promise<{ slot: string; name: string; version: string; createdAt: number }[]> {
  const key = await backupKey()
  if (!key) return []
  const slots = await call<BackupSlotInfo[]>('GET', '/api/backups')
  return slots
    .filter((entry) => entry.kind === 'phone' && entry.versions.length)
    .map((entry) => {
      let name = 'A phone'
      try {
        name = new TextDecoder().decode(open(key, fromBase64(entry.label), `${entry.slot}:label`).plaintext)
      } catch {
        // Sealed under another key: listed without its name.
      }
      return { slot: entry.slot, name, version: entry.versions[0]!.id, createdAt: entry.versions[0]!.createdAt }
    })
}

export async function readPhoneBackup(slotId: string, version: string): Promise<PhonePreferences> {
  const key = await backupKey()
  if (!key) throw new Error('Get the backup key first.')
  const { ciphertext } = await call<{ ciphertext: string }>('GET', `/api/backups/${slotId}/${version}`)
  return JSON.parse(new TextDecoder().decode(open(key, fromBase64(ciphertext), slotId).plaintext)) as PhonePreferences
}

// ---- Your hosts ----

export const listedHosts = () => call<ListedHostInfo[]>('GET', '/api/hosts')

/** One pairing message to a listed host through the account; resolves with the host's answer. */
export async function relay(hostId: string, path: string, body: unknown, signal: AbortSignal) {
  const { id } = await call<{ id: string }>('POST', `/api/hosts/${hostId}/relay`, { path, body })
  const until = Date.now() + ACCOUNT_LIMITS.requestMs
  while (Date.now() < until && !signal.aborted) {
    await new Promise((resolve) => setTimeout(resolve, 2000))
    const answer = await call<{ waiting: boolean; reply?: { status: number; body: unknown } }>(
      'GET',
      `/api/relay/${id}`,
    )
    if (!answer.waiting && answer.reply) return answer.reply
  }
  return { status: 408, body: { error: 'The host did not answer in time. Check that it is running.' } }
}
