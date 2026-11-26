import { generateKeyPairSync } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import { liveActivityApsPayload as apnsPayload } from '@ramu/shared/ramuLink'
import { apnsTokens, liveActivityPush, sendLiveActivity } from '../src/liveActivities'

const token = 'ab'.repeat(32)
const update = { token, environment: 'production', event: 'update', props: '{"running":1}', staleDate: 100 } as const

it('builds the work activity push itself, and a start names the widget type, its host and what iOS shows', () => {
  expect(apnsPayload(update, 5_000).aps).toEqual({
    timestamp: 5,
    event: 'update',
    'content-state': { name: 'RamuWork', props: '{"running":1}' },
    'stale-date': 100,
  })
  const start = apnsPayload(
    { ...update, event: 'start', computerId: 'host-1', alert: { title: 'Ramu', body: 'Agents are working' } },
    5_000,
  ).aps
  expect(start).toMatchObject({
    event: 'start',
    'attributes-type': 'LiveActivityAttributes',
    attributes: { url: 'ramu://activity?computerId=host-1' },
    alert: { title: 'Ramu', body: 'Agents are working' },
  })
})

it('takes only a bounded Ramu work push, never another notification', () => {
  expect(liveActivityPush.safeParse(update).success).toBe(true)
  expect(liveActivityPush.safeParse({ ...update, token: 'not-hex' }).success).toBe(false)
  expect(liveActivityPush.safeParse({ ...update, sound: 'default' }).success).toBe(false)
  expect(liveActivityPush.safeParse({ ...update, props: 'x'.repeat(2000) }).success).toBe(false)
  // A start without its host and words, or naming a host that could rewrite the link, is refused.
  expect(liveActivityPush.safeParse({ ...update, event: 'start' }).success).toBe(false)
  expect(
    liveActivityPush.safeParse({ ...update, event: 'start', computerId: 'a&x=1', alert: { title: 't', body: 'b' } })
      .success,
  ).toBe(false)
})

it('signs Apple provider tokens with the push key, reusing one for most of an hour', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const key = {
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    keyId: 'KEY1234567',
    teamId: 'TEAM123456',
    bundleId: 'com.akalstack.ramu',
  }
  const tokens = apnsTokens()
  const jwt = await tokens(key, 1_000_000)
  const [header, claims, signature] = jwt.split('.')
  expect(JSON.parse(Buffer.from(header!, 'base64url').toString())).toEqual({ alg: 'ES256', kid: 'KEY1234567' })
  expect(JSON.parse(Buffer.from(claims!, 'base64url').toString())).toEqual({ iss: 'TEAM123456', iat: 1000 })
  const verifier = await crypto.subtle.importKey(
    'spki',
    publicKey.export({ type: 'spki', format: 'der' }),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  )
  expect(
    await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      verifier,
      Buffer.from(signature!, 'base64url'),
      new TextEncoder().encode(`${header}.${claims}`),
    ),
  ).toBe(true)
  expect(await tokens(key, 1_000_000 + 30 * 60_000)).toBe(jwt)
  expect(await tokens(key, 1_000_000 + 45 * 60_000)).not.toBe(jwt)
})

it("sends to Apple's live activity topic and passes back its reason", async () => {
  const fetcher = vi.fn(async () => Response.json({ reason: 'BadDeviceToken' }, { status: 400 }))
  const key = { key: '', keyId: 'K', teamId: 'T', bundleId: 'com.akalstack.ramu' }
  const reply = await sendLiveActivity({ ...update, environment: 'sandbox' }, key, 'jwt', 0, fetcher as never)
  expect(reply).toEqual({ status: 400, reason: 'BadDeviceToken' })
  const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
  expect(url).toBe(`https://api.sandbox.push.apple.com/3/device/${token}`)
  expect(init.headers).toMatchObject({
    'apns-topic': 'com.akalstack.ramu.push-type.liveactivity',
    'apns-push-type': 'liveactivity',
    'apns-priority': '5',
  })
})
