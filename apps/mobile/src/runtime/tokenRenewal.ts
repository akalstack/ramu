// Rotates this phone's device token before it ages. No React Native in here, so it is unit tested.
import { RENEW_PATH, PROTOCOL_HEADER, PROTOCOL_VERSION, type RenewResponse } from '@ramu/contracts'

/** Renew about monthly: well inside the host's default 90-day window, and rarely enough to cost nothing. */
export const RENEW_EVERY_MS = 30 * 24 * 60 * 60_000

export function renewalDue(now: number, renewedAt: number | null): boolean {
  return renewedAt === null || now - renewedAt >= RENEW_EVERY_MS || renewedAt > now
}

export interface RenewalClient {
  address: string
  token(): string
  useToken(token: string): void
}

/**
 * Asks the host for a fresh token, saves it durably, and only then starts using it: the host retires the old token
 * after the new one's first use, so a crash or a failed save leaves the old one working. Returns whether it rotated.
 * A host that predates renewal, an offline host or a refused request simply leaves the current token in place.
 */
export async function renewCredential(
  client: RenewalClient,
  fetcher: typeof globalThis.fetch,
  save: (token: string) => Promise<void>,
  markRenewed: (at: number) => Promise<void>,
  now = Date.now(),
): Promise<boolean> {
  let response: Response
  try {
    response = await fetcher(`${client.address}${RENEW_PATH}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${client.token()}`, [PROTOCOL_HEADER]: String(PROTOCOL_VERSION) },
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
  await markRenewed(now)
  client.useToken(body.token)
  return true
}
