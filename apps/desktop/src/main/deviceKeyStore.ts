import { randomBytes } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { DeviceProver, deviceKey, type DeviceKey } from '@ramu/client-runtime'
import { isDevicePublicKey } from '@ramu/shared/deviceProof'
import type { Sealer } from './remoteServers'

const random = (bytes: number) => new Uint8Array(randomBytes(bytes))

/**
 * This computer's device key, made once and kept beside its saved hosts: the secret is sealed by the OS credential
 * store where there is one, as the hosts' tokens are. Hosts bind this computer's tokens to the public half, so a token
 * copied from here is useless without the secret. Null when a saved key cannot be read right now.
 */
export function loadDeviceKey(path: string, sealer: Sealer): DeviceKey | null {
  let saved: { publicKey?: unknown; secret?: unknown; sealed?: unknown } | null = null
  try {
    saved = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    // None yet.
  }
  if (saved && isDevicePublicKey(saved.publicKey) && typeof saved.secret === 'string') {
    try {
      const secret = saved.sealed ? sealer.open(saved.secret) : saved.secret
      if (/^[0-9a-f]{64}$/.test(secret)) return { publicKey: saved.publicKey, secret }
    } catch {
      // The credential store would not open it just now (a locked keychain).
    }
    // Hosts already hold this key, so it is never replaced: without it this run proves nothing, and the hosts that
    // bound it answer again once the key can be read.
    return null
  }
  const key = deviceKey(random)
  const sealed = sealer.available
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temp = `${path}.${process.pid}.tmp`
  writeFileSync(
    temp,
    JSON.stringify({ publicKey: key.publicKey, secret: sealed ? sealer.seal(key.secret) : key.secret, sealed }),
    { mode: 0o600 },
  )
  chmodSync(temp, 0o600)
  renameSync(temp, path)
  return key
}

export const deviceProverFor = (key: DeviceKey) => new DeviceProver(key, random)
