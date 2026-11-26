// Rotates this phone's device token before it ages. No React Native in here, so it is unit tested.
import { RENEW_PATH, PROTOCOL_HEADER, PROTOCOL_VERSION, type RenewResponse } from '@ramu/contracts'
import { PROOF_HEADER, type ProofPurpose } from '@ramu/shared/deviceProof'

/** Renew weekly: well inside the host's default 30-day window, and rarely enough to cost nothing. */
export const RENEW_EVERY_MS = 7 * 24 * 60 * 60_000

/** A host that binds nothing however often it is asked (an older one) is asked to bind once a day. */
const BIND_EVERY_MS = 24 * 60 * 60_000

/**
 * `binds`: this phone holds a device key the host has not bound its token to yet, so it renews now rather than
 * waiting out the week.
 */
export function renewalDue(now: number, renewedAt: number | null, binds = false): boolean {
  return (
    renewedAt === null ||
    renewedAt > now ||
    now - renewedAt >= RENEW_EVERY_MS ||
    (binds && now - renewedAt >= BIND_EVERY_MS)
  )
}

/** The part of a device prover a renewal needs. */
export interface RenewalProver {
  publicKey: string
  header(token: string, purpose: ProofPurpose): string
}

export interface RenewalClient {
  address: string
  token(): string
  useToken(token: string): void
}

/**
 * Asks the host for a fresh token, saves it durably, and only then starts using it: the host retires the old token
 * after the new one's first use, so a crash or a failed save leaves the old one working. Returns whether it rotated.
 * An offline host or a refused request simply leaves the current token in place.
 */
export async function renewCredential(
  client: RenewalClient,
  fetcher: typeof globalThis.fetch,
  save: (token: string) => Promise<void>,
  markRenewed: (at: number, bound: boolean) => Promise<void>,
  now = Date.now(),
  /** Names this phone's key so the host binds the new token to it, and proves the key once a host has bound it. */
  prover: RenewalProver | null = null,
): Promise<boolean> {
  let response: Response
  try {
    response = await fetcher(`${client.address}${RENEW_PATH}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${client.token()}`,
        [PROTOCOL_HEADER]: String(PROTOCOL_VERSION),
        ...(prover
          ? { 'Content-Type': 'application/json', [PROOF_HEADER]: prover.header(client.token(), 'renew') }
          : {}),
      },
      ...(prover ? { body: JSON.stringify({ key: prover.publicKey }) } : {}),
    })
  } catch {
    return false
  }
  if (!response.ok) return false
  let body: Partial<RenewResponse>
  try {
    body = (await response.json()) as Partial<RenewResponse>
  } catch {
    return false
  }
  if (typeof body.token !== 'string' || !/^[a-f0-9]{64}$/.test(body.token)) return false
  await save(body.token)
  await markRenewed(now, body.bound === true)
  client.useToken(body.token)
  return true
}
