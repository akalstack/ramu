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
      message: expect.stringContaining('background service needs to restart'),
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

it('waits for a restarting service that stops answering until it lets go of its socket', async () => {
  const { createServer } = await import('node:http')
  const { mkdtempSync, rmSync, existsSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { runtimeSocket, closeHostSockets } = await import('@ramu/client-runtime')
  const { waitForRuntimeExit } = await import('../src/main/runtimeLauncher')
  const directory = mkdtempSync(join(tmpdir(), 'ramu-restart-wait-'))
  const socketPath = runtimeSocket(directory)
  // Draining: it still holds the socket and takes connections, but answers nothing.
  const server = createServer(() => {})
  await new Promise<void>((resolve) => server.listen(socketPath, resolve))
  const started = Date.now()
  setTimeout(() => {
    server.closeAllConnections()
    server.close()
  }, 1500)
  try {
    await waitForRuntimeExit(socketPath, 10_000)
    expect(Date.now() - started).toBeGreaterThanOrEqual(1400)
    expect(existsSync(socketPath)).toBe(false)
  } finally {
    closeHostSockets()
    server.close()
    rmSync(directory, { recursive: true, force: true })
  }
}, 15_000)

it('stops waiting at once for a socket left by a service that already exited', async () => {
  const { mkdtempSync, rmSync, existsSync } = await import('node:fs')
  const { spawn } = await import('node:child_process')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { closeHostSockets } = await import('@ramu/client-runtime')
  const { waitForRuntimeExit } = await import('../src/main/runtimeLauncher')
  const directory = mkdtempSync(join(tmpdir(), 'ramu-restart-stale-'))
  const socketPath = join(directory, 'left.sock')
  // Killed outright, the process never removes its socket file.
  const child = spawn(
    process.execPath,
    ['-e', `require('node:net').createServer().listen(${JSON.stringify(socketPath)})`],
    {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    },
  )
  while (!existsSync(socketPath)) await new Promise((resolve) => setTimeout(resolve, 20))
  child.kill('SIGKILL')
  await new Promise((resolve) => child.once('exit', resolve))
  const started = Date.now()
  try {
    expect(existsSync(socketPath)).toBe(true)
    await waitForRuntimeExit(socketPath, 10_000)
    expect(Date.now() - started).toBeLessThan(3000)
  } finally {
    closeHostSockets()
    rmSync(directory, { recursive: true, force: true })
  }
})
