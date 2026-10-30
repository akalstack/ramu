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

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'ramu-pairing-'))
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
  const devices = new DeviceStore(join(dir, 'devices.json'))
  const pairing = new PairingRequests({ devices, hostId: 'host-1' })
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

it('pairs a nearby device once a person at the host approves the matching code, and its derived token works', async () => {
  const { devices, pairing, base, post } = await fixture()
  const { offerId } = devices.createCode(Date.now(), 'viewer')
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
    pairing.approve(id, offerId)
  })
  const result = await pairingDone
  expect(shown).toBe(approvedCode)
  expect(result).toMatchObject({ hostId: 'host-1', role: 'viewer' })
  // The offer is spent, exactly as if its code had been typed.
  expect(devices.offers()).toEqual([])
  expect(devices.offerStatus(offerId)).toMatchObject({ state: 'redeemed' })
  const authorized = await fetch(base + '/anything', { headers: { Authorization: `${AUTH_SCHEME} ${result.token}` } })
  expect(await authorized.text()).toBe(result.deviceId)
})

it('tells the device when the host declines', async () => {
  const { devices, pairing, post } = await fixture()
  devices.createCode(Date.now(), 'owner')
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
})

it('accepts requests only while an offer is open, one reveal that matches the commitment, and never twice', async () => {
  const { devices, pairing, post } = await fixture()
  const keys = pairKeys(random)
  const commit = pairCommit(keys.publicKey)
  expect((await post(PAIR_REQUEST_PATH, { name: 'Phone', commit })).status).toBe(401)
  devices.createCode(Date.now(), 'owner')
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

it('refuses to approve once the offer is gone, so a code and a request never both spend one offer', async () => {
  const { devices, pairing, post } = await fixture()
  const { code, offerId } = devices.createCode(Date.now(), 'owner')
  void requestPairing({
    post: (path, body, signal) => post(path, body, signal),
    name: 'Phone',
    random,
    onCode() {},
    signal: new AbortController().signal,
  }).catch(() => {})
  await answerAtHost(pairing, (id) => {
    expect(devices.redeem(code, 'Typed')).not.toBeNull()
    expect(() => pairing.approve(id, offerId)).toThrow('expired')
  })
  expect(devices.list().map((device) => device.name)).toEqual(['Typed'])
})
