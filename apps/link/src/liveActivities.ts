// Live Activity pushes for hosts' paired iPhones. Hosts cannot hold Apple's push key, so they hand Link what the
// activity shows and Link signs and sends it. Only Ramu's own work activity can be sent: Link builds every field of the
// push itself from a bounded request, so a host cannot use it for any other notification.
import { z } from 'zod'
import { liveActivityApsPayload, type LiveActivityPush, type LiveActivityPushReply } from '@ramu/shared/ramuLink'

export const liveActivityPush = z
  .object({
    token: z.string().regex(/^[a-fA-F0-9]{64,256}$/),
    environment: z.enum(['sandbox', 'production']),
    event: z.enum(['start', 'update', 'end']),
    props: z.string().min(2).max(1024),
    staleDate: z.number().int().nonnegative().optional(),
    dismissalDate: z.number().int().nonnegative().optional(),
    computerId: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,100}$/)
      .optional(),
    alert: z
      .object({ title: z.string().trim().min(1).max(80), body: z.string().trim().min(1).max(160) })
      .strict()
      .optional(),
  })
  .strict()
  .refine((push) => push.event !== 'start' || (!!push.computerId && !!push.alert), {
    message: 'A start names its host and what iOS shows',
  }) satisfies z.ZodType<LiveActivityPush>

export interface ApnsKey {
  /** The .p8 key's PEM text. */
  key: string
  keyId: string
  teamId: string
  bundleId: string
}

const base64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
const text64 = (value: string) => base64url(new TextEncoder().encode(value))

/** Apple's provider token: an ES256 JWT, good for up to an hour and refreshed well before. */
export function apnsTokens(crypto: SubtleCrypto = globalThis.crypto.subtle) {
  let cached: { jwt: string; at: number; keyId: string } | null = null
  let signingKey: Promise<CryptoKey> | null = null
  return async (key: ApnsKey, now: number): Promise<string> => {
    if (cached && cached.keyId === key.keyId && now - cached.at < 40 * 60_000) return cached.jwt
    signingKey ??= crypto.importKey(
      'pkcs8',
      Uint8Array.from(atob(key.key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')), (c) => c.charCodeAt(0)),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign'],
    )
    const unsigned = `${text64(JSON.stringify({ alg: 'ES256', kid: key.keyId }))}.${text64(
      JSON.stringify({ iss: key.teamId, iat: Math.floor(now / 1000) }),
    )}`
    // WebCrypto signs ECDSA as raw r||s, the form a JWT uses.
    const signature = await crypto.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      await signingKey,
      new TextEncoder().encode(unsigned),
    )
    cached = { jwt: `${unsigned}.${base64url(signature)}`, at: now, keyId: key.keyId }
    return cached.jwt
  }
}

/** Sends one validated push to Apple and says what it answered. */
export async function sendLiveActivity(
  push: LiveActivityPush,
  key: ApnsKey,
  jwt: string,
  now: number,
  fetcher: typeof fetch = fetch,
): Promise<LiveActivityPushReply> {
  const host = push.environment === 'sandbox' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com'
  const response = await fetcher(`${host}/3/device/${push.token}`, {
    method: 'POST',
    headers: {
      authorization: `bearer ${jwt}`,
      'apns-push-type': 'liveactivity',
      'apns-topic': `${key.bundleId}.push-type.liveactivity`,
      // An update with no alert is low priority, as Apple asks; a start or an end shows at once.
      'apns-priority': push.event === 'update' ? '5' : '10',
      'apns-expiration': '0',
      'content-type': 'application/json',
    },
    body: JSON.stringify(liveActivityApsPayload(push, now)),
  })
  let reason: string | undefined
  if (!response.ok) {
    try {
      const body = (await response.json()) as { reason?: unknown }
      if (typeof body.reason === 'string') reason = body.reason.slice(0, 100)
    } catch {}
  }
  return { status: response.status, ...(reason ? { reason } : {}) }
}
