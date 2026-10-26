import { expect, it } from 'vitest'
import { pinnedRuntime } from '../src/main/runtimeLauncher'

it('does not snapshot a development Electron.app with a daemon outside its bundle', () => {
  const dir = '/tmp/ramu-user-data'
  const daemonPath = '/project/out/main/daemon.js',
    executable = '/project/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
  expect(pinnedRuntime(dir, daemonPath, executable)).toEqual({ daemonPath, executable })
})

it('reports a live pre-WebSocket service without replacing it or leaking an unsupported socket', async () => {
  const { createServer } = await import('node:http')
  const { mkdtempSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { runtimeSocket, closeHostSockets } = await import('@ramu/client-runtime')
  const { ensureRuntime } = await import('../src/main/runtimeLauncher')
  const directory = mkdtempSync(join(tmpdir(), 'ramu-legacy-startup-'))
  const socketPath = runtimeSocket(directory)
  const requests: string[] = []
  const server = createServer((req, res) => {
    requests.push(req.url ?? '')
    res.writeHead(req.url === '/socket' ? 404 : 200).end()
  })
  await new Promise<void>((resolve) => server.listen(socketPath, resolve))
  try {
    await expect(ensureRuntime(directory, '/not-a-real-daemon.js', '/not-a-real-executable')).rejects.toMatchObject({
      message: expect.stringContaining('older Ramu background service is still running'),
      cause: { status: 426 },
    })
    expect(server.listening).toBe(true)
    expect(requests).toContain('/socket')
    // A second start reaches the actual service again rather than inheriting a cached unsupported connection.
    await expect(ensureRuntime(directory, '/not-a-real-daemon.js')).rejects.toThrow(
      'Running agents have been left untouched',
    )
    expect(requests.filter((path) => path === '/socket')).toHaveLength(2)
  } finally {
    closeHostSockets()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    rmSync(directory, { recursive: true, force: true })
  }
})
