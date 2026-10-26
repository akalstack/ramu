import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findHostRoute, rememberRoutes, verifyHost } from '../src/runtime/hostRoutes.ts'
import { deviceProofKey, hostProof } from '@ramu/shared/hostProof'
const lan = 'http://192.168.1.3:7788'
const vpn = 'http://100.99.224.30:7788'
const verified = { state: 'verified', hostId: 'paired', routes: [vpn] }

test('a reachable VPN wins without waiting for a dead LAN interface; losing probes abort', async () => {
  let losingSignal
  const result = await findHostRoute({
    address: lan,
    routes: [lan, 'http://192.168.1.4:7788', vpn],
    signal: new AbortController().signal,
    verify: async (address, signal) => {
      if (address === vpn) return verified
      losingSignal = signal
      return new Promise(() => {})
    },
  })
  assert.equal(result.address, vpn)
  assert.equal(losingSignal.aborted, true)
  assert.deepEqual(rememberRoutes(lan, result.routes, [lan]), [vpn, lan])
})

test('mismatched identities, HTTPS downgrade, and credential URLs never become routes', async () => {
  const checked = []
  assert.equal(
    await findHostRoute({
      address: 'https://host:7788',
      routes: [vpn, 'https://user:secret@host:7788', 'https://other:7788'],
      signal: new AbortController().signal,
      verify: async (address) => {
        checked.push(address)
        return { state: 'mismatch' }
      },
    }),
    null,
  )
  assert.deepEqual(checked, ['https://other:7788'])
})

test('suspension cancels outstanding route probes and ignores late answers', async () => {
  const controller = new AbortController()
  let finish
  const pending = findHostRoute({
    address: lan,
    routes: [vpn],
    signal: controller.signal,
    verify: () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  })
  await Promise.resolve()
  controller.abort()
  assert.equal(await pending, null)
  finish(verified)
})

test('returning from VPN retains the previous route for the next network change', () => {
  assert.deepEqual(rememberRoutes(vpn, [lan], [vpn]), [vpn, lan])
})

test('route probing has a deadline even when a platform fetch never settles', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let signal
  const pending = findHostRoute({
    address: lan,
    routes: [vpn],
    signal: new AbortController().signal,
    verify: (_, probeSignal) => {
      signal = probeSignal
      return new Promise(() => {})
    },
  })
  await Promise.resolve()
  t.mock.timers.tick(4000)
  assert.equal(await pending, null)
  assert.equal(signal.aborted, true)
})

test('a suspended connection does not probe any address', async () => {
  const controller = new AbortController()
  controller.abort()
  assert.equal(
    await findHostRoute({
      address: lan,
      routes: [vpn],
      signal: controller.signal,
      verify: () => assert.fail('must not start a probe'),
    }),
    null,
  )
})

test('failover checks the actual host proof without sending the saved bearer token', async () => {
  const token = 'paired-device-secret'
  const requests = []
  const result = await findHostRoute({
    address: lan,
    routes: [vpn, 'http://192.168.1.4:7788'],
    signal: new AbortController().signal,
    verify: (address, signal) =>
      verifyHost({
        baseUrl: address,
        deviceId: 'phone',
        token,
        expectedHostId: 'paired',
        challenge: 'fresh-challenge',
        signal,
        fetch: async (url, init) => {
          requests.push({ url, init })
          return {
            ok: true,
            status: 200,
            json: async () => ({
              hostId: 'paired',
              routes: [lan, vpn],
              proof: hostProof(deviceProofKey(address === vpn ? token : 'wrong-token'), 'paired', 'fresh-challenge'),
            }),
          }
        },
      }),
  })
  assert.equal(result.address, vpn)
  assert.ok(requests.length > 0)
  for (const request of requests) {
    assert.equal(request.init.headers, undefined)
    assert.ok(!request.url.includes(token))
  }
})

test('an identity endpoint without a usable WebSocket cannot win over a working route', async () => {
  const blocked = 'http://192.168.1.4:7788'
  const checked = []
  const result = await findHostRoute({
    address: lan,
    routes: [blocked, vpn],
    signal: new AbortController().signal,
    verify: async () => verified,
    usable: async (address) => {
      checked.push(address)
      return address === vpn
    },
  })
  assert.equal(result.address, vpn)
  assert.ok(checked.includes(vpn))
})

test('unproven candidates never receive a credential-bearing WebSocket probe', async () => {
  const result = await findHostRoute({
    address: lan,
    routes: [vpn],
    signal: new AbortController().signal,
    verify: async () => ({ state: 'mismatch' }),
    usable: () => assert.fail('must prove the host before authenticating a socket'),
  })
  assert.equal(result, null)
})
