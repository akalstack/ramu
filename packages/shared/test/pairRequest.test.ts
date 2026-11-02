import { randomBytes } from 'node:crypto'
import { expect, it } from 'vitest'
import {
  PAIR_REQUEST_PATH,
  PAIR_REVEAL_PATH,
  pairCommit,
  pairKeys,
  pairResultMac,
  pairSecrets,
  requestPairing,
  PairRequestUnsupported,
  type PairPost,
} from '../src/pairRequest'

const random = (bytes: number) => new Uint8Array(randomBytes(bytes))

/** A host that follows the protocol and approves at once. */
function host(options: { tamper?: boolean; hostId?: string; linkKey?: string; sentLinkKey?: string } = {}) {
  const keys = pairKeys(random)
  let commit = ''
  let deviceKey = ''
  const secrets = () =>
    pairSecrets(keys.secret, deviceKey, { requestId: 'r1', hostId: 'h1', commit, deviceKey, hostKey: keys.publicKey })
  const post: PairPost = async (path, body) => {
    const input = body as Record<string, string>
    if (path === PAIR_REQUEST_PATH) {
      commit = input.commit!
      return {
        status: 200,
        body: { requestId: 'r1', hostKey: keys.publicKey, hostId: 'h1', expiresAt: Date.now() + 60_000 },
      }
    }
    if (path === PAIR_REVEAL_PATH) {
      if (pairCommit(input.key!) !== commit) return { status: 401, body: { error: 'mismatch' } }
      deviceKey = input.key!
      return { status: 200, body: { ok: true } }
    }
    const fields = {
      deviceId: 'd1',
      role: 'owner' as const,
      hostId: 'h1',
      expiresAt: null,
      ...(options.linkKey ? { linkKey: options.linkKey } : {}),
    }
    const mac = pairResultMac(secrets().macKey, fields)
    return {
      status: 200,
      body: {
        state: 'approved',
        ...fields,
        ...(options.sentLinkKey ? { linkKey: options.sentLinkKey } : {}),
        hostId: options.hostId ?? 'h1',
        mac: options.tamper ? (mac[0] === '0' ? '1' : '0') + mac.slice(1) : mac,
      },
    }
  }
  return { post, shown: () => secrets().code, token: () => secrets().token }
}

it('shows the same code on both sides and derives the same token without sending it', async () => {
  const fake = host()
  let code = ''
  const sent: unknown[] = []
  const result = await requestPairing({
    post: (path, body, signal) => {
      sent.push(body)
      return fake.post(path, body, signal)
    },
    name: 'Phone',
    random,
    onCode: (value) => (code = value),
    signal: new AbortController().signal,
  })
  expect(code).toMatch(/^\d{3} \d{3}$/)
  expect(code).toBe(fake.shown())
  expect(result).toMatchObject({ deviceId: 'd1', hostId: 'h1', role: 'owner', token: fake.token() })
  expect(JSON.stringify(sent)).not.toContain(result.token)
})

it('refuses an approval that does not come from the host that ran the exchange', async () => {
  for (const options of [{ tamper: true }, { hostId: 'other' }])
    await expect(
      requestPairing({
        post: host(options).post,
        name: 'Phone',
        random,
        onCode() {},
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('did not match')
})

it('gives each side of a relay a different code', () => {
  const device = pairKeys(random)
  const relay = pairKeys(random)
  const realHost = pairKeys(random)
  const deviceSide = {
    requestId: 'r',
    hostId: 'h',
    commit: pairCommit(device.publicKey),
    deviceKey: device.publicKey,
    hostKey: relay.publicKey,
  }
  const hostSide = {
    requestId: 'r',
    hostId: 'h',
    commit: pairCommit(relay.publicKey),
    deviceKey: relay.publicKey,
    hostKey: realHost.publicKey,
  }
  const seen = pairSecrets(device.secret, relay.publicKey, deviceSide)
  const approved = pairSecrets(realHost.secret, relay.publicKey, hostSide)
  expect(seen.code).not.toBe(approved.code)
  expect(seen.token).not.toBe(approved.token)
  // Both honest sides of one exchange agree.
  expect(pairSecrets(relay.secret, device.publicKey, deviceSide)).toEqual(seen)
})

it('rejects malformed and low-order keys and treats a 404 as an older host', async () => {
  const keys = pairKeys(random)
  const transcript = { requestId: 'r', hostId: 'h', commit: 'c', deviceKey: keys.publicKey, hostKey: '0'.repeat(64) }
  expect(() => pairSecrets(keys.secret, '0'.repeat(64), transcript)).toThrow('Invalid pairing key')
  expect(() => pairSecrets(keys.secret, 'zz', transcript)).toThrow('Invalid pairing key')
  expect(() => pairKeys(() => new Uint8Array(4))).toThrow('Secure random')
  await expect(
    requestPairing({
      post: async () => ({ status: 404, body: null }),
      name: 'Phone',
      random,
      onCode() {},
      signal: new AbortController().signal,
    }),
  ).rejects.toBeInstanceOf(PairRequestUnsupported)
})

it('returns the host’s Link key only as the host vouched for it', async () => {
  const linkKey = 'a'.repeat(64)
  const pair = (options: Parameters<typeof host>[0]) =>
    requestPairing({
      post: host(options).post,
      name: 'Phone',
      random,
      onCode() {},
      signal: new AbortController().signal,
    })
  await expect(pair({ linkKey })).resolves.toMatchObject({ linkKey })
  // A relay that swaps in its own key breaks the check the host computed over the real one.
  await expect(pair({ linkKey, sentLinkKey: 'b'.repeat(64) })).rejects.toThrow('did not match')
})
