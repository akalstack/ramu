import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { ComputerRegistry, type ComputerDeps } from '../src/main/computers'
import { RemoteServers } from '../src/main/remoteServers'
import { ComputerBroadcaster } from '../src/main/computerBroadcast'

const dirs: string[] = []
afterEach(() => {
  vi.useRealTimers()
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs.length = 0
})

it('keeps 100 remote connections independent and measures full-list broadcast overhead', () => {
  vi.useFakeTimers()
  const count = 100,
    viewCount = 21
  const dir = mkdtempSync(join(tmpdir(), 'ramu-scale-'))
  dirs.push(dir)
  const path = join(dir, 'servers.json')
  writeFileSync(
    path,
    JSON.stringify({
      servers: Array.from({ length: count }, (_, i) => ({
        id: String(i),
        name: `Computer ${i}`,
        url: `http://10.0.0.${i + 1}:7788`,
        pairedAt: 1,
        token: 'token',
        sealed: false,
      })),
    }),
  )
  const servers = new RemoteServers(path, { available: false, seal: (s) => s, open: (s) => s })
  const read = vi.spyOn(servers as any, 'read')
  const streams = new Map<string, (channel: string, payload: any) => void>()
  let snapshots = 0
  const deps: ComputerDeps = {
    servers,
    deviceName: 'local',
    localName: () => 'This computer',
    local: '/tmp/unused.sock',
    subscribe: (target, receive) => {
      const url = target.kind === 'http' ? target.url : target.path
      streams.set(url, receive)
      return () => {
        streams.delete(url)
      }
    },
    invoke: async () => ({ running: 0, needsInput: 0 }),
    pair: async () => ({ token: 'token' }),
    ssh: {
      ensure: async () => {},
      connect: async () => {
        throw new Error('unused')
      },
      close: () => {},
      closeAll: () => {},
    },
    deliver: () => {},
    changed: () => broadcaster.changed(),
  }
  const registry = new ComputerRegistry(deps)
  const broadcaster = new ComputerBroadcaster(
    () => registry.list('local'),
    () => {
      snapshots++
    },
  )
  try {
    const start = performance.now()
    registry.start()
    const startupMs = performance.now() - start,
      startupReads = read.mock.calls.length
    expect(streams.size).toBe(count)
    read.mockClear()
    const burst = performance.now()
    for (const receive of streams.values()) receive('background:connection', { connected: true })
    broadcaster.flush()
    const burstMs = performance.now() - burst,
      burstReads = read.mock.calls.length
    expect(burstReads).toBe(1)
    expect(snapshots).toBe(1)
    expect(registry.list('local').computers.filter((computer) => computer.status === 'connected')).toHaveLength(
      count + 1,
    )
    registry.update('0', { enabled: false })
    expect(streams.size).toBe(count - 1)
    expect(registry.status('1')).toBe('connected')
    console.log(
      JSON.stringify({
        scale: 'registry',
        computers: count,
        retainedViews: viewCount - 1,
        startupMs: +startupMs.toFixed(1),
        startupReads,
        connectionBurstMs: +burstMs.toFixed(1),
        connectionBurstReads: burstReads,
        fullSnapshots: snapshots,
      }),
    )
  } finally {
    registry.stop()
    broadcaster.close()
  }
})
