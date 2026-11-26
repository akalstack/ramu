import { Platform } from 'react-native'
import { requireOptionalNativeModule } from 'expo'
import * as SecureStore from 'expo-secure-store'
import { DeviceProver, deviceKey, type DeviceKey, type Prover } from '@ramu/client-runtime/deviceProver'
import { isDevicePublicKey } from '@ramu/shared/deviceProof'

// This phone's device key. Hosts bind the phone's tokens to its public half when the phone renews them, and from then
// on accept a token only with a proof signed here, so a token copied off the phone is useless. The secret stays in the
// Keychain or Keystore and is never part of a backup to another device.
const KEY = 'ramu.deviceKey'

type Random = (bytes: number) => Uint8Array

/** The system's secure source, or null on a build without it; nothing weaker is ever used for a key or a proof. */
function random(): Random | null {
  if (Platform.OS === 'web' || !requireOptionalNativeModule('ExpoCrypto')) return null
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded only when its native module exists
  const { getRandomBytes } = require('expo-crypto') as { getRandomBytes: Random }
  return getRandomBytes
}

const parse = (text: string | null): DeviceKey | null => {
  try {
    const saved = JSON.parse(text ?? 'null') as { publicKey?: unknown; secret?: unknown } | null
    return saved &&
      isDevicePublicKey(saved.publicKey) &&
      typeof saved.secret === 'string' &&
      /^[0-9a-f]{64}$/.test(saved.secret)
      ? { publicKey: saved.publicKey, secret: saved.secret }
      : null
  } catch {
    return null
  }
}

let prover: Prover | null = null

/** The prover for a key this phone already holds, read without waiting so a connection can be signed as it opens. */
export function phoneProver(): Prover | null {
  if (prover) return prover
  const source = random()
  if (!source) return null
  try {
    const key = parse(SecureStore.getItem(KEY))
    if (key) prover = new DeviceProver(key, source)
  } catch {
    // The store is locked or unavailable: connect as before, and a host that bound the key answers once it opens.
  }
  return prover
}

/** The phone's prover, making and saving its key the first time. Null where no secure source or store exists. */
export async function ensurePhoneProver(): Promise<Prover | null> {
  const held = phoneProver()
  if (held) return held
  const source = random()
  if (!source) return null
  try {
    // A key that exists but could not be read just now is never replaced: hosts already hold it.
    if ((await SecureStore.getItemAsync(KEY)) !== null) return null
    const key = deviceKey(source)
    await SecureStore.setItemAsync(KEY, JSON.stringify(key), {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    })
    prover = new DeviceProver(key, source)
    return prover
  } catch {
    return null
  }
}
