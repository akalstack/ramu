import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  findHostRoute,
  rememberRoutes,
  verifyHost,
  developmentHostRoute,
  chooseHostRoute,
} from '../src/runtime/hostRoutes.ts'
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

test('a development bundle on NetBird provides a recovery candidate before the host has taught any routes', async () => {
  const hint = developmentHostRoute(lan, 'http://100.99.224.30:8081/node_modules/expo-router/entry.bundle?platform=ios')
  assert.equal(hint, vpn)
  const result = await findHostRoute({
    address: lan,
    routes: [hint],
    signal: new AbortController().signal,
    verify: async () => verified,
    usable: async () => true,
  })
  assert.equal(result.address, vpn)
})

test('development hints preserve the API port and TLS instead of copying Metro settings', () => {
  assert.equal(
    developmentHostRoute('https://192.168.1.3:8443', 'http://100.99.224.30:8081/index.bundle'),
    'https://100.99.224.30:8443',
  )
  assert.equal(developmentHostRoute(lan, 'http://[fd00::12]:8081/index.bundle'), 'http://[fd00::12]:7788')
  assert.equal(developmentHostRoute(lan, 'http://192.168.1.3:8081/index.bundle'), null)
})

test('public tunnels, localhost, credentials and missing bundle URLs are not guessed as API servers', () => {
  for (const bundle of [
    undefined,
    'file:///bundle.js',
    'http://localhost:8081',
    'http://127.0.0.1:8081',
    'https://metro.exp.direct',
    'http://user:password@100.99.224.30:8081',
    'broken',
  ])
    assert.equal(developmentHostRoute(lan, bundle), null)
})

test('a working manual address stays selected while NetBird is also available', async () => {
  const checked = []
  const result = await chooseHostRoute({
    address: lan,
    routes: [vpn],
    signal: new AbortController().signal,
    verify: async (address) => {
      checked.push(address)
      return verified
    },
    usable: async () => true,
  })
  assert.equal(result.address, lan)
  assert.deepEqual(checked, [lan])
})

test('offline recovery chooses verified NetBird over a faster alternate LAN reply', async () => {
  const other = 'http://192.168.1.4:7788'
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  let finished = false
  const pending = chooseHostRoute({
    address: lan,
    routes: [other, vpn],
    signal: new AbortController().signal,
    verify: async (address) => {
      if (address === lan) return { state: 'unreachable' }
      if (address === vpn) await gate
      return verified
    },
    usable: async () => true,
  }).then((result) => {
    finished = true
    return result
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(finished, false)
  release()
  assert.equal((await pending).address, vpn)
})

test('a reachable identity endpoint that cannot carry the app teaches the VPN fallback', async () => {
  const result = await chooseHostRoute({
    address: lan,
    routes: [],
    signal: new AbortController().signal,
    verify: async () => verified,
    usable: async (address) => address === vpn,
  })
  assert.equal(result.address, vpn)
})

test('an unresponsive VPN cannot hold offline recovery forever when another LAN route works', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const other = 'http://192.168.1.4:7788'
  const pending = chooseHostRoute({
    address: lan,
    routes: [vpn, other],
    signal: new AbortController().signal,
    verify: async (address) =>
      address === lan ? { state: 'unreachable' } : address === vpn ? new Promise(() => {}) : verified,
    usable: async () => true,
  })
  await new Promise((resolve) => setImmediate(resolve))
  t.mock.timers.tick(4000)
  assert.equal((await pending).address, other)
})
