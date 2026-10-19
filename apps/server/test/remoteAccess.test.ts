import { afterEach, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DeviceStore, PAIRING_TTL_MS } from '../src/remote/devices'
import { RemoteAccess, accessOf, deviceMayInvoke } from '../src/remote/access'

const cleanup: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close()
})
async function fixture() {
  let now = Date.now()
  const dir = mkdtempSync(join(tmpdir(), 'ramu-access-'))
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
  const devices = new DeviceStore(join(dir, 'devices.json'))
  const access = new RemoteAccess({ devices, browserOrigins: ['https://companion.example'], now: () => now })
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
  for (const method of ['agent.get', 'agent.replyPermission', 'agent.replyQuestion'])
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
