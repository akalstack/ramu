// A host proves it is the one a device paired with, using what pairing already gave both sides: the device keeps its
// token, the host keeps the token's hash. Neither the token nor the hash crosses the wire when checking.
import { hmac } from '@noble/hashes/hmac'
import { sha256 } from '@noble/hashes/sha2'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils'

/** The key both sides hold for one device: the SHA-256 of its token, in hex. The host stores exactly this value. */
export const deviceProofKey = (token: string): string => bytesToHex(sha256(utf8ToBytes(token)))

export const hostProof = (key: string, hostId: string, challenge: string): string =>
  bytesToHex(hmac(sha256, utf8ToBytes(key), utf8ToBytes(`ramu-host-proof:1:${hostId}:${challenge}`)))

/** Vouches for the host's Ramu Link key with the same per-device key, so a device can pin it from a proven answer. */
export const linkKeyProof = (key: string, hostId: string, challenge: string, linkKey: string): string =>
  bytesToHex(hmac(sha256, utf8ToBytes(key), utf8ToBytes(`ramu-host-link:1:${hostId}:${challenge}:${linkKey}`)))

const sameText = (a: string, b: string) => {
  if (a.length !== b.length) return false
  let difference = 0
  for (let index = 0; index < a.length; index++) difference |= a.charCodeAt(index) ^ b.charCodeAt(index)
  return difference === 0
}

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
  | { state: 'verified'; hostId: string; routes: string[]; linkKey?: string }
  /** The address answered, but not as the host this device paired with: do not send it the credential. */
  | { state: 'mismatch' }
  /** Continuity cannot be proven, so pairing again is explicit. */
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
  let body: {
    hostId?: unknown
    proof?: unknown
    alternates?: unknown
    routes?: unknown
    linkKey?: unknown
    linkProof?: unknown
  }
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
  if (
    !proofs.some(
      (proof) => typeof proof === 'string' && verifyHostProof(key, body.hostId as string, input.challenge, proof),
    )
  )
    return { state: 'mismatch' }
  const linkKey =
    typeof body.linkKey === 'string' &&
    /^[0-9a-f]{64}$/.test(body.linkKey) &&
    typeof body.linkProof === 'string' &&
    sameText(body.linkProof, linkKeyProof(key, body.hostId, input.challenge, body.linkKey))
      ? body.linkKey
      : undefined
  return { state: 'verified', hostId: body.hostId, routes: learnedRoutes(body.routes), ...(linkKey ? { linkKey } : {}) }
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
  // Keep mesh VPNs even on machines with many VM/container bridges before bounding persisted routes. A Ramu Link
  // address goes last: it always works, so it is the fallback after every direct route.
  const rank = (origin: string) => {
    const host = new URL(origin).hostname
    if (host.endsWith('.link.invalid')) return 0
    return /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host) ? 2 : 1
  }
  const unique = [...new Set(origins)].sort((a, b) => rank(b) - rank(a))
  // The Link address survives the bound: dropping it would strand a device away from every direct route.
  const link = unique.find((origin) => rank(origin) === 0)
  const direct = unique
    .filter((origin) => rank(origin) !== 0)
    .slice(0, link ? MAX_LEARNED_ROUTES - 1 : MAX_LEARNED_ROUTES)
  return link ? [...direct, link] : direct
}
