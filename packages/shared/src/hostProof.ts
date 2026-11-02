// A host proves it is the one a device paired with, using what pairing already gave both sides: the device keeps its
// token, the host keeps the token's hash. Neither the token nor the hash crosses the wire when checking.
import { hmac } from '@noble/hashes/hmac'
import { sha256 } from '@noble/hashes/sha2'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils'

/** The key both sides hold for one device: the SHA-256 of its token, in hex. The host stores exactly this value. */
export const deviceProofKey = (token: string): string => bytesToHex(sha256(utf8ToBytes(token)))

export const hostProof = (key: string, hostId: string, challenge: string): string =>
  bytesToHex(hmac(sha256, utf8ToBytes(key), utf8ToBytes(`ramu-host-proof:1:${hostId}:${challenge}`)))

/** Constant-time comparison of a host's answer with the one this device expects. */
export function verifyHostProof(key: string, hostId: string, challenge: string, proof: string): boolean {
  const expected = hostProof(key, hostId, challenge)
  if (proof.length !== expected.length) return false
  let difference = 0
  for (let index = 0; index < expected.length; index++)
    difference |= expected.charCodeAt(index) ^ proof.charCodeAt(index)
  return difference === 0
}

export type HostVerification =
  /** `routes` are other addresses the host named in this same proven answer; each still has to prove itself before use. */
  | { state: 'verified'; hostId: string; routes: string[] }
  /** The address answered, but not as the host this device paired with: do not send it the credential. */
  | { state: 'mismatch' }
  /** An older host that has no identity endpoint: continuity cannot be proven, so pairing again is explicit. */
  | { state: 'unsupported' }
  | { state: 'unreachable' }

/**
 * Asks `baseUrl` to prove it is the host this device paired with. Sends the device id and a fresh challenge only.
 * When the pairing recorded a host id, a different id is a mismatch even with a valid proof.
 */
export async function verifyHost(input: {
  fetch: (
    url: string,
    init: { signal?: AbortSignal },
  ) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>
  baseUrl: string
  deviceId: string
  token: string
  expectedHostId?: string
  challenge: string
  signal?: AbortSignal
}): Promise<HostVerification> {
  const url = `${input.baseUrl.replace(/\/$/, '')}/identity?device=${encodeURIComponent(input.deviceId)}&challenge=${encodeURIComponent(input.challenge)}`
  let response
  try {
    response = await input.fetch(url, { signal: input.signal })
  } catch {
    return { state: 'unreachable' }
  }
  if (response.status === 404) return { state: 'unsupported' }
  if (!response.ok) return { state: 'unreachable' }
  let body: { hostId?: unknown; proof?: unknown; alternates?: unknown; routes?: unknown }
  try {
    body = (await response.json()) as typeof body
  } catch {
    return { state: 'mismatch' }
  }
  if (typeof body.hostId !== 'string' || typeof body.proof !== 'string') return { state: 'mismatch' }
  if (input.expectedHostId && body.hostId !== input.expectedHostId) return { state: 'mismatch' }
  const key = deviceProofKey(input.token)
  // A host answers for the current token and, while one is pending, a renewed one; whichever this device holds proves it.
  const proofs = [body.proof, ...(Array.isArray(body.alternates) ? body.alternates.slice(0, 3) : [])]
  return proofs.some(
    (proof) => typeof proof === 'string' && verifyHostProof(key, body.hostId as string, input.challenge, proof),
  )
    ? { state: 'verified', hostId: body.hostId, routes: learnedRoutes(body.routes) }
    : { state: 'mismatch' }
}

export const MAX_LEARNED_ROUTES = 8

/** The addresses a host's proven answer names: a few short http(s) origins, nothing else. */
export function learnedRoutes(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const origins = value.flatMap((entry) => {
    if (typeof entry !== 'string' || entry.length > 200) return []
    try {
      const url = new URL(entry)
      return ['http:', 'https:'].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        url.pathname === '/' &&
        !url.search &&
        !url.hash
        ? [url.origin]
        : []
    } catch {
      return []
    }
  })
  // Keep mesh VPNs even on machines with many VM/container bridges before bounding persisted routes.
  const mesh = (origin: string) => /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(new URL(origin).hostname)
  return [...new Set(origins)].sort((a, b) => Number(mesh(b)) - Number(mesh(a))).slice(0, MAX_LEARNED_ROUTES)
}
