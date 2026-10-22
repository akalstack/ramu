import { afterEach, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DeviceStore, PAIRING_TTL_MS } from '../src/remote/devices'
import { RemoteAccess, accessOf, deviceMayInvoke } from '../src/remote/access'
import { verifyHost } from '@ramu/shared/hostProof'

const cleanup: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close()
})
async function fixture(hostId?: string) {
  let now = Date.now()
  const dir = mkdtempSync(join(tmpdir(), 'ramu-access-'))
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
  const devices = new DeviceStore(join(dir, 'devices.json'))
  const access = new RemoteAccess({
    devices,
    browserOrigins: ['https://companion.example'],
    ...(hostId ? { hostId } : {}),
    now: () => now,
  })
  const server: Server = createServer(async (req, res) => {
    const device = await access.accept(req, res)
    if (device === undefined) return
    if (!deviceMayInvoke(device ?? undefined, 'agent.start') && req.url === '/invoke') {
      res.writeHead(403).end()
      return
    }
    res.writeHead(200).end('ok')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(
    () =>
      new Promise<void>((resolve) => {
        server.close(resolve as () => void)
        server.closeAllConnections()
      }),
  )
  const address = server.address() as { port: number }
  const request = (path: string, init?: RequestInit) => fetch(`http://127.0.0.1:${address.port}${path}`, init)
  const pair = (code: string, extra = {}) =>
    request('/pair', { method: 'POST', body: JSON.stringify({ code, ...extra }) })
  return {
    devices,
    request,
    pair,
    advance: (ms: number) => {
      now += ms
    },
    now: () => now,
    base: `http://127.0.0.1:${address.port}`,
  }
}

it('pairs through HTTP once, and rejects used, expired and evicted codes', async () => {
  const f = await fixture()
  const code = f.devices.createCode(f.now()).code
  const paired = await f.pair(code)
  expect(paired.status).toBe(200)
  expect(paired.headers.get('cache-control')).toBe('no-store')
  const data = (await paired.json()) as { token: string; deviceId: string }
  expect((await f.request('/events', { headers: { Authorization: `Bearer ${data.token}` } })).status).toBe(200)
  expect((await f.pair(code)).status).toBe(401)
  const expired = f.devices.createCode(f.now()).code
  f.advance(PAIRING_TTL_MS)
  expect((await f.pair(expired)).status).toBe(401)
  const codes = Array.from({ length: 6 }, () => f.devices.createCode(f.now()).code)
  expect((await f.pair(codes[0]!)).status).toBe(401)
  expect((await f.pair(codes[5]!)).status).toBe(200)
  f.devices.revoke(data.deviceId)
  for (const path of ['/invoke', '/events'])
    expect((await f.request(path, { headers: { Authorization: `Bearer ${data.token}` } })).status).toBe(401)
})

it('returns 429 with retry timing after repeated failures and recovers after backoff', async () => {
  const f = await fixture()
  for (let i = 0; i < 5; i++) expect((await f.pair('wrong')).status).toBe(401)
  const blocked = await f.pair('wrong')
  expect(blocked.status).toBe(429)
  expect(blocked.headers.get('retry-after')).toBe('1')
  f.advance(1001)
  expect((await f.pair(f.devices.createCode(f.now()).code)).status).toBe(200)
})

it('binds the role to the host-issued code and denies viewer execution', async () => {
  const f = await fixture()
  const code = f.devices.createCode(f.now(), 'viewer').code
  const paired = (await (await f.pair(code, { role: 'owner' })).json()) as { token: string; role: string }
  expect(paired.role).toBe('viewer')
  const headers = { Authorization: `Bearer ${paired.token}` }
  expect((await f.request('/invoke', { method: 'POST', headers })).status).toBe(403)
  const device = f.devices.authenticate(headers.Authorization)!
  for (const method of ['agent.get', 'agent.nextRoute', 'agent.replyPermission', 'agent.replyQuestion'])
    expect(deviceMayInvoke(device, method)).toBe(true)
  for (const method of [
    'term.open',
    'files.write',
    'settings.app.set',
    'background.stop',
    'agent.start',
    'projects.actionSettings',
    'tasks.agentDefaults',
    'projects.setActionVisibility',
    'projects.resetActionOrder',
    'projects.reorderActions',
    'future.read',
  ])
    expect(deviceMayInvoke(device, method)).toBe(false)
})

it('rejects unapproved browser origins, and only emits CORS for explicitly enabled origins', async () => {
  const f = await fixture()
  const health = await f.request('/health')
  expect(health.status).toBe(200)
  expect(health.headers.has('access-control-allow-origin')).toBe(false)
  expect((await f.request('/health', { headers: { Origin: 'https://evil.example' } })).status).toBe(403)
  const allowed = await f.request('/invoke', { method: 'OPTIONS', headers: { Origin: 'https://companion.example' } })
  expect(allowed.status).toBe(204)
  expect(allowed.headers.get('access-control-allow-origin')).toBe('https://companion.example')
})

it('reports the caller role for client action hiding, defaulting local and legacy callers to owner', async () => {
  const f = await fixture()
  const viewer = f.devices.redeem(f.devices.createCode(f.now(), 'viewer').code, 'Phone', f.now())!.device
  const owner = f.devices.redeem(f.devices.createCode(f.now(), 'owner').code, 'Laptop', f.now())!.device
  expect(accessOf(viewer)).toBe('viewer')
  expect(accessOf(owner)).toBe('owner')
  expect(accessOf(undefined)).toBe('owner')
})

it('lets a viewer device reach only the computer screen watching methods, never input or grants', async () => {
  const f = await fixture()
  const viewer = f.devices.redeem(f.devices.createCode(f.now(), 'viewer').code, 'Phone', f.now())!.device
  for (const method of ['computer.frame', 'computer.session', 'computer.rtcOffer'])
    expect(deviceMayInvoke(viewer, method)).toBe(true)
  for (const method of [
    'computer.input',
    'computer.takeControl',
    'computer.grantViewer',
    'computer.setEnabled',
    'computer.revoke',
  ])
    expect(deviceMayInvoke(viewer, method)).toBe(false)
})

it('renews a device token over HTTP without a gap, and refuses renewal without a live device token', async () => {
  const f = await fixture()
  const paired = (await (await f.pair(f.devices.createCode(f.now()).code)).json()) as { token: string }
  const renew = (token?: string) =>
    f.request('/renew', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {} })
  expect((await renew()).status).toBe(401)
  const response = await renew(paired.token)
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  const renewed = (await response.json()) as { token: string }
  const events = (token: string) => f.request('/events', { headers: { Authorization: `Bearer ${token}` } })
  expect((await events(paired.token)).status).toBe(200)
  expect((await events(renewed.token)).status).toBe(200)
  f.advance(3 * 60_000)
  expect((await events(paired.token)).status).toBe(401)
  expect((await events(renewed.token)).status).toBe(200)
})

const HOST = 'a'.repeat(32)
const CHALLENGE = 'challenge-0123456789abcdef'

async function pairedHost(hostId = HOST) {
  const f = await fixture(hostId)
  const code = f.devices.createCode(f.now()).code
  const data = (await (await f.pair(code)).json()) as { token: string; deviceId: string; hostId?: string }
  const check = (token: string, expectedHostId?: string, baseUrl?: string) =>
    verifyHost({
      fetch: (url) => fetch(url.replace('http://base', baseUrl ?? f.base)),
      baseUrl: 'http://base',
      deviceId: data.deviceId,
      token,
      expectedHostId,
      challenge: CHALLENGE,
    })
  return { f, data, check }
}

it('binds the host id at pairing and proves it later without any credential on the wire', async () => {
  const { data, check } = await pairedHost()
  expect(data.hostId).toBe(HOST)
  expect(await check(data.token, data.hostId)).toEqual({ state: 'verified', hostId: HOST })
})

it('does not verify a host that is not the one paired with, or a token it does not hold', async () => {
  const { data, check } = await pairedHost()
  expect(await check(data.token, 'b'.repeat(32))).toEqual({ state: 'mismatch' })
  expect(await check('someone-elses-token', data.hostId)).toEqual({ state: 'mismatch' })
})

it('reports a host without the endpoint as unsupported and an unreachable address as unreachable', async () => {
  const f = await fixture()
  const code = f.devices.createCode(f.now()).code
  const data = (await (await f.pair(code)).json()) as { token: string; deviceId: string; hostId?: string }
  expect(data.hostId).toBeUndefined()
  const asked = (baseUrl: string) =>
    verifyHost({
      fetch: (url) => fetch(url.replace('http://base', baseUrl)),
      baseUrl: 'http://base',
      deviceId: data.deviceId,
      token: data.token,
      challenge: CHALLENGE,
    })
  // Without a host id the identity route is absent and falls through to normal authentication.
  expect((await asked(f.base)).state).not.toBe('verified')
  expect(await asked('http://127.0.0.1:1')).toEqual({ state: 'unreachable' })
})

it('refuses unknown devices and malformed challenges alike', async () => {
  const { f, data } = await pairedHost()
  expect((await f.request(`/identity?device=nope&challenge=${CHALLENGE}`)).status).toBe(401)
  expect((await f.request(`/identity?device=${data.deviceId}&challenge=short`)).status).toBe(401)
})
