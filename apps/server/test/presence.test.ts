import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PresenceListener, presenceKey } from '@ramu/client-runtime'
import { HostPresence } from '../src/presence'

const dirs: string[] = [], cleanup: (() => void)[] = []
afterEach(() => { for (const close of cleanup) close(); cleanup.length = 0; for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs.length = 0 })

it('persists only authenticated recipient addresses and announces after a host restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ramu-presence-')); dirs.push(dir)
  const path = join(dir, 'presence.json'), key = presenceKey('private-device-token')
  const listener = new PresenceListener(); await listener.start(); cleanup.push(() => listener.close())
  let wakes = 0
  listener.watch('private-device-token', () => { wakes++ })
  const keys = new Map([['device', key]])
  const host = new HostPresence(path, (id) => keys.get(id) ?? null)
  cleanup.push(() => host.close())
  host.register('unknown', '127.0.0.1', listener.port)
  host.register('device', 'arbitrary.example', listener.port)
  host.register('device', '127.0.0.1', 80)
  host.register('device', '::ffff:127.0.0.1', listener.port)
  const file = readFileSync(path, 'utf8')
  expect(JSON.parse(file)).toHaveLength(1)
  expect(file).not.toContain(key)
  expect(file).not.toContain('private-device-token')
  const restarted = new HostPresence(path, (id) => keys.get(id) ?? null)
  cleanup.push(() => restarted.close())
  restarted.announce()
  await expect.poll(() => wakes).toBeGreaterThan(0)
  restarted.close()
  const before = wakes
  keys.clear()
  const revoked = new HostPresence(path, (id) => keys.get(id) ?? null)
  cleanup.push(() => revoked.close())
  revoked.announce()
  await new Promise((resolve) => setTimeout(resolve, 1600))
  expect(wakes).toBe(before)
})
