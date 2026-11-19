import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import * as hostRoutes from '../src/runtime/hostRoutes.ts'
import * as transport from '../src/runtime/transport.ts'
import * as contract from '@ramu/shared/discovery/contract'
import * as proofs from '@ramu/shared/hostProof'
const module = { exports: {} }
runInNewContext(
  ts.transpileModule(readFileSync(new URL('../src/runtime/reachableHosts.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
  {
    exports: module.exports,
    URL,
    AbortController,
    setTimeout: (...args) => globalThis.setTimeout(...args),
    clearTimeout: (...args) => globalThis.clearTimeout(...args),
    require: (id) =>
      ({
        './hostRoutes': hostRoutes,
        './transport': transport,
        '@ramu/shared/discovery/contract': contract,
        '@ramu/shared/hostProof': proofs,
      })[id],
  },
)
const { probeReachableHosts } = module.exports
import { mergeReachableHosts } from '../src/runtime/nearbyModel.ts'
import { deviceProofKey, hostProof } from '@ramu/shared/hostProof'
const token = 'unique-phone-credential'
const hostId = 'a'.repeat(32)
const lan = 'http://192.168.1.3:7788'
const vpn = 'http://100.99.224.30:7788'
const computer = {
  id: 'saved-mac',
  hostId,
  deviceId: 'phone',
  name: 'Work Mac',
  address: lan,
  status: 'offline',
  routes: [],
}
const answer = (value, status = 200) => ({ ok: status === 200, status, json: async () => value })
const identity = (url) => {
  const challenge = new URL(url).searchParams.get('challenge')
  return answer({ hostId, routes: [lan, vpn], proof: hostProof(deviceProofKey(token), hostId, challenge) })
}
const options = (found, fetch, computers = [computer]) => ({
  computers,
  found: (host) => found.push(host),
  fetch,
  tokenFor: async () => token,
  signal: new AbortController().signal,
  usable: async () => true,
})

test('Nearby hosts finds a paired Mac over NetBird even with no multicast and no previously learned VPN route', async () => {
  const found = [],
    requests = []
  await probeReachableHosts({
    ...options(found, async (url, init) => {
      requests.push({ url, init })
      if (url.startsWith(vpn + '/identity')) return identity(url)
      throw Error('unreachable')
    }),
    bundleUrl: 'http://100.99.224.30:8081/index.bundle',
  })
  assert.equal(found.length, 1)
  assert.equal(found[0].pairedHostId, computer.id)
  assert.equal(found[0].routes[0].url, vpn)
  assert.ok(requests.every(({ init }) => !init.headers?.Authorization))
})

test('older pairings can prove continuity with their device credential even before a host id was saved', async () => {
  const found = []
  await probeReachableHosts(options(found, async (url) => identity(url), [{ ...computer, hostId: undefined }]))
  assert.equal(found[0].hostId, hostId)
  assert.equal(found[0].pairedHostId, computer.id)
})

test('an impostor or a revoked pairing cannot appear as the saved computer or receive a credential probe', async () => {
  const found = []
  await probeReachableHosts({
    ...options(found, async () => answer({ hostId: 'b'.repeat(32), proof: 'fake' })),
    usable: () => assert.fail('must verify first'),
  })
  assert.deepEqual(found, [])
  await probeReachableHosts({
    ...options(found, () => assert.fail('revoked host must not be queried'), [{ ...computer, status: 'revoked' }]),
    tokenFor: () => assert.fail('must not read revoked credentials'),
  })
})

test('a new development host is listed by address only and is never marked as paired by its health response', async () => {
  const found = []
  await probeReachableHosts({
    ...options(
      found,
      async (url, init) => {
        assert.equal(url, vpn + '/health')
        assert.equal(init.headers, undefined)
        return answer({ ok: true, protocol: 1 })
      },
      [],
    ),
    bundleUrl: 'http://100.99.224.30:8081/index.bundle',
  })
  assert.equal(found[0].routes[0].url, vpn)
  assert.equal(found[0].pairedHostId, null)
  assert.equal(found[0].hostId, '')
})

test('discovery cancellation prevents late results, and an unresponsive health request has a deadline', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const found = []
  let finish
  const pending = probeReachableHosts({
    ...options(
      found,
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
      [],
    ),
    bundleUrl: 'http://100.99.224.30:8081/index.bundle',
  })
  t.mock.timers.tick(4000)
  await pending
  finish(answer({ ok: true, protocol: 1 }))
  await Promise.resolve()
  await Promise.resolve()
  assert.deepEqual(found, [])
  const controller = new AbortController()
  controller.abort()
  await probeReachableHosts({ ...options(found, () => assert.fail('already aborted')), signal: controller.signal })
  assert.deepEqual(found, [])
})

test('a sleeping first computer does not delay discovering another reachable host', async () => {
  const found = [],
    controller = new AbortController()
  await probeReachableHosts({
    ...options(
      found,
      async (url) => {
        if (url.startsWith(lan)) throw Error('offline')
        return identity(url)
      },
      [computer, { ...computer, id: 'other', address: vpn }],
    ),
    signal: controller.signal,
  })
  assert.deepEqual(
    found.map((host) => host.pairedHostId),
    ['other'],
  )
})

test('native and verified direct sightings merge without duplicate rows or losing the selected key', () => {
  const native = {
    key: 'native-row',
    hostId,
    name: 'Mac',
    label: 'Mac',
    scheme: 'http',
    routes: [{ url: lan, interfaceName: 'Wi-Fi' }],
    pairedHostId: null,
  }
  const verified = {
    ...native,
    key: 'paired-row',
    name: 'Work Mac',
    label: 'Work Mac',
    routes: [{ url: vpn, interfaceName: null }],
    pairedHostId: 'saved-mac',
  }
  const rows = mergeReachableHosts([native], [verified])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].key, native.key)
  assert.equal(rows[0].pairedHostId, 'saved-mac')
  assert.deepEqual(
    rows[0].routes.map((route) => route.url),
    [vpn, lan],
  )
})

test('a faster .4 interface does not hide .3 learned from the same proven host', async () => {
  const snapshots = [],
    lan4 = 'http://192.168.1.4:7788'
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const pending = probeReachableHosts({
    ...options(
      [],
      async (url) => {
        if (url.startsWith(lan + '/identity')) await gate
        else if (!url.startsWith(lan4 + '/identity')) throw Error('unreachable')
        return identity(url)
      },
      [{ ...computer, address: lan4 }],
    ),
    found: (host) => snapshots.push(host),
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(snapshots[0].routes[0].url, lan4)
  release()
  await pending
  assert.deepEqual(
    Array.from(snapshots.at(-1).routes, (route) => route.url),
    [lan4, lan],
  )
  assert.ok(snapshots.every((host) => host.pairedHostId === computer.id))
})
