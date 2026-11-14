import { afterEach, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AUTH_SCHEME } from '@ramu/contracts'
import { DeviceStore } from '../src/remote/devices'
import { RemoteAccess } from '../src/remote/access'
import { PairingRequests } from '../src/remote/pairingRequests'
import { PAIR_REQUEST_PATH, PAIR_REVEAL_PATH, pairCommit, pairKeys, requestPairing } from '@ramu/shared/pairRequest'

const random = (bytes: number) => new Uint8Array(randomBytes(bytes))
const cleanup: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close()
})

async function fixture(discoverable = true) {
  const dir = mkdtempSync(join(tmpdir(), 'ramu-pairing-'))
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
  const devices = new DeviceStore(join(dir, 'devices.json'))
  const pairing = new PairingRequests({ devices, hostId: 'host-1', accepting: () => discoverable })
  const access = new RemoteAccess({ devices, hostId: 'host-1', pairing, browserOrigins: [] })
  const server: Server = createServer(async (req, res) => {
    const device = await access.accept(req, res)
    if (device === undefined) return
    res.writeHead(200).end(device ? device.id : 'legacy')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(
    () =>
      new Promise<void>((resolve) => {
        server.close(resolve as () => void)
        server.closeAllConnections()
      }),
  )
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const post = async (path: string, body: unknown, signal?: AbortSignal) => {
    const response = await fetch(base + path, { method: 'POST', body: JSON.stringify(body), signal })
    const text = await response.text()
    return { status: response.status, body: text ? JSON.parse(text) : null }
  }
  return { devices, pairing, base, post }
}

/** Waits until the request shows at the host, then answers it the way the person at the host would. */
async function answerAtHost(pairing: PairingRequests, decide: (id: string, code: string) => void) {
  for (let i = 0; i < 100; i++) {
    const [request] = pairing.list()
    if (request) return decide(request.id, request.code)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('No request reached the host')
}

it('pairs a nearby device once a person at the host approves the matching code, with no code opened first', async () => {
  const { devices, pairing, base, post } = await fixture()
  let shown = ''
  const pairingDone = requestPairing({
    post: (path, body, signal) => post(path, body, signal),
    name: 'Ahmad’s iPhone',
    random,
    onCode: (code) => (shown = code),
    signal: new AbortController().signal,
  })
  let approvedCode = ''
  await answerAtHost(pairing, (id, code) => {
    approvedCode = code
    expect(pairing.list()[0]).toMatchObject({ name: 'Ahmad’s iPhone', address: '127.0.0.1' })
    pairing.approve(id, 'viewer')
  })
  const result = await pairingDone
  expect(shown).toBe(approvedCode)
  expect(result).toMatchObject({ hostId: 'host-1', role: 'viewer' })
  // Approval leaves no usable code behind.
  expect(devices.offers()).toEqual([])
  expect(() => pairing.approve(pairing.list()[0]?.id ?? 'gone', 'owner')).toThrow('expired')
  const authorized = await fetch(base + '/anything', { headers: { Authorization: `${AUTH_SCHEME} ${result.token}` } })
  expect(await authorized.text()).toBe(result.deviceId)
})

it('tells the device when the host declines', async () => {
  const { devices, pairing, post } = await fixture()
  const done = requestPairing({
    post: (path, body, signal) => post(path, body, signal),
    name: 'Phone',
    random,
    onCode() {},
    signal: new AbortController().signal,
  })
  await answerAtHost(pairing, (id) => pairing.deny(id))
  await expect(done).rejects.toThrow('declined')
  expect(devices.list()).toEqual([])
  // The same address waits a minute before it can raise the prompt again.
  const again = await post(PAIR_REQUEST_PATH, { name: 'Phone', commit: pairCommit(pairKeys(random).publicKey) })
  expect(again.status).toBe(429)
})

it('accepts requests only while the host is discoverable or has an offer open, and one matching reveal', async () => {
  const { devices, pairing, post } = await fixture(false)
  const keys = pairKeys(random)
  const commit = pairCommit(keys.publicKey)
  expect((await post(PAIR_REQUEST_PATH, { name: 'Phone', commit })).status).toBe(401)
  expect(pairing.list()).toEqual([])
  const open = new PairingRequests({ devices, hostId: 'host-1' })
  expect(() => open.begin('10.0.0.2', { name: 'Phone', commit })).toThrow('not discoverable')
  devices.createCode(Date.now(), 'owner')
  expect(open.begin('10.0.0.2', { name: 'Phone', commit }).requestId).toBeTruthy()
})

it('shows a request at the host only after one reveal that matches the commitment', async () => {
  const { pairing, post } = await fixture()
  const keys = pairKeys(random)
  const commit = pairCommit(keys.publicKey)
  const begun = await post(PAIR_REQUEST_PATH, { name: 'Phone', commit })
  expect(begun.status).toBe(200)
  // Nothing shows at the host until the device reveals the key it committed to.
  expect(pairing.list()).toEqual([])
  const other = pairKeys(random)
  expect((await post(PAIR_REVEAL_PATH, { requestId: begun.body.requestId, key: other.publicKey })).status).toBe(401)
  // A failed reveal ends the request; revealing the right key afterwards does not revive it.
  expect((await post(PAIR_REVEAL_PATH, { requestId: begun.body.requestId, key: keys.publicKey })).status).toBe(404)
  expect(pairing.list()).toEqual([])
})

it('a request the account relayed gets the host’s addresses sealed to that device', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ramu-pair-relay-'))
  try {
    const devices = new DeviceStore(join(dir, 'devices.json'))
    const pairing = new PairingRequests({
      devices,
      hostId: 'host-1',
      accepting: (peer) => peer.startsWith('account:'),
      addresses: () => ['https://home.example.ts.net', 'http://192.168.1.20:7788'],
    })
    const seen: unknown[] = []
    const peer = 'account:device-a'
    const answer = async (path: string, body: unknown) => {
      seen.push(body)
      if (path === PAIR_REQUEST_PATH) return { status: 200, body: pairing.begin(peer, body) }
      if (path === PAIR_REVEAL_PATH) {
        pairing.reveal(peer, body)
        setTimeout(() => pairing.approve(pairing.list()[0]!.id, 'owner'), 10)
        return { status: 200, body: { ok: true } }
      }
      const waited = await pairing.wait(peer, body)
      seen.push(waited)
      return { status: 200, body: waited }
    }
    const result = await requestPairing({
      post: answer,
      name: 'Phone',
      random: (bytes) => new Uint8Array(randomBytes(bytes)),
      onCode: () => {},
      signal: new AbortController().signal,
    })
    expect(result.addresses).toEqual(['https://home.example.ts.net', 'http://192.168.1.20:7788'])
    // What crossed the relay never names an address in the clear.
    expect(JSON.stringify(seen)).not.toMatch(/ts\.net|192\.168/)
    // A nearby device is not let in by the account's door.
    expect(() =>
      pairing.begin('192.168.1.50', { commit: pairCommit(pairKeys((n) => new Uint8Array(randomBytes(n))).publicKey) }),
    ).toThrow(/not discoverable/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

it('a relayed request from a device the host lets in pairs on its own, never showing a prompt, and says so once', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ramu-pair-trust-'))
  try {
    const devices = new DeviceStore(join(dir, 'devices.json'))
    const joined: { name: string; role: string; peer: string }[] = []
    let prompts = 0
    const pairing = new PairingRequests({
      devices,
      hostId: 'host-1',
      accepting: (peer) => peer.startsWith('account:'),
      addresses: () => ['https://home.example.ts.net'],
      autoApprove: (peer) => (peer === 'account:trusted' ? 'viewer' : null),
      joined: (device, peer) => joined.push({ name: device.name, role: device.role, peer }),
      changed: () => (prompts += pairing.list().length),
    })
    const relay = (peer: string) => async (path: string, body: unknown) => {
      if (path === PAIR_REQUEST_PATH) return { status: 200, body: pairing.begin(peer, body) }
      if (path === PAIR_REVEAL_PATH) {
        pairing.reveal(peer, body)
        return { status: 200, body: { ok: true } }
      }
      return { status: 200, body: await pairing.wait(peer, body, AbortSignal.timeout(200)) }
    }
    const result = await requestPairing({
      post: relay('account:trusted'),
      name: 'Phone',
      random,
      onCode: () => {},
      signal: new AbortController().signal,
    })
    // The same checked exchange as an approval by hand: the host's answer and its sealed addresses.
    expect(result).toMatchObject({ hostId: 'host-1', role: 'viewer', addresses: ['https://home.example.ts.net'] })
    expect(joined).toEqual([{ name: 'Phone', role: 'viewer', peer: 'account:trusted' }])
    expect(prompts).toBe(0)
    expect(devices.list().map((device) => device.name)).toEqual(['Phone'])

    // Any other asking device still waits for the person here.
    const asking = requestPairing({
      post: relay('account:other'),
      name: 'Tablet',
      random,
      onCode: () => {},
      signal: AbortSignal.timeout(2_000),
    }).catch(() => null)
    await answerAtHost(pairing, (id) => pairing.deny(id))
    await asking
    expect(joined).toHaveLength(1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
