import { it, expect } from 'vitest'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runtimeInvoke, closeHostSockets } from '@ramu/client-runtime'
import { serveSockets } from '../src/remote/socket'

it('loads a desktop startup burst through one local connection without refusing or replaying calls', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ramu-startup-burst-'))
  const path = join(directory, 'host.sock')
  let active = 0,
    peak = 0,
    calls = 0
  const server = createServer((_req, res) => res.writeHead(404).end())
  const sockets = serveSockets(server, {
    accept: async () => null,
    epoch: 'startup-burst',
    attach() {},
    detach() {},
    invoke: async (_device, request) => {
      calls++
      peak = Math.max(peak, ++active)
      await new Promise((resolve) => setTimeout(resolve, 10))
      active--
      return { ok: true, value: request.args[0] }
    },
  })
  await new Promise<void>((resolve) => server.listen(path, resolve))
  try {
    const expected = Array.from({ length: 120 }, (_, index) => index)
    const result = await Promise.all(expected.map((index) => runtimeInvoke(path, 'startup.read', [index])))
    expect(result).toEqual(expected)
    expect(calls).toBe(expected.length)
    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThanOrEqual(32)
    expect(sockets.connections()).toBe(1)
  } finally {
    closeHostSockets()
    sockets.close()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    rmSync(directory, { recursive: true, force: true })
  }
})
