import { expect, it } from 'vitest'
import { pinnedRuntime, systemdUnit } from '../src/main/runtimeLauncher'

it('does not snapshot a development Electron.app with a daemon outside its bundle', () => {
  const dir = '/tmp/ramu-user-data'
  const daemonPath = '/project/out/main/daemon.js',
    executable = '/project/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
  expect(pinnedRuntime(dir, daemonPath, executable)).toEqual({ daemonPath, executable })
})

it('does not snapshot a development Electron on Linux, whose daemon is in the repository', () => {
  const daemonPath = '/project/apps/desktop/out/main/daemon.js',
    executable = '/project/node_modules/electron/dist/electron'
  expect(pinnedRuntime('/tmp/ramu-user-data', daemonPath, executable, 'linux')).toEqual({ daemonPath, executable })
})

it('keeps relative symlinks relative when snapshotting a macOS bundle, so its code signature stays valid', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, readlinkSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const root = mkdtempSync(join(tmpdir(), 'ramu-pin-'))
  try {
    const app = join(root, 'Install', 'Ramu.app')
    const framework = join(app, 'Contents', 'Frameworks', 'Electron Framework.framework')
    mkdirSync(join(framework, 'Versions', 'A'), { recursive: true })
    mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true })
    mkdirSync(join(app, 'Contents', 'Resources'), { recursive: true })
    writeFileSync(join(framework, 'Versions', 'A', 'Electron Framework'), '')
    symlinkSync('A', join(framework, 'Versions', 'Current'))
    symlinkSync('Versions/Current/Electron Framework', join(framework, 'Electron Framework'))
    writeFileSync(join(app, 'Contents', 'MacOS', 'Ramu'), '')
    writeFileSync(join(app, 'Contents', 'Resources', 'daemon.js'), '')
    const pinned = pinnedRuntime(
      join(root, 'data'),
      join(app, 'Contents', 'Resources', 'daemon.js'),
      join(app, 'Contents', 'MacOS', 'Ramu'),
      'darwin',
    )
    const copy = pinned.executable.slice(0, pinned.executable.indexOf('/Contents/MacOS/'))
    expect(copy).not.toBe(app)
    const copied = join(copy, 'Contents', 'Frameworks', 'Electron Framework.framework')
    expect(readlinkSync(join(copied, 'Electron Framework'))).toBe('Versions/Current/Electron Framework')
    expect(readlinkSync(join(copied, 'Versions', 'Current'))).toBe('A')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

it('writes a systemd user service that restarts only a crashed service and keeps paths with spaces and % intact', () => {
  const unit = systemdUnit(
    '/home/me/Ramu Data/Ramu',
    '/home/me/Ramu Data/resources/daemon.js',
    { RAMU_USER_DATA: '/home/me/100% "Ramu"' },
    '/home/me/Ramu Data/background.log',
  )
  expect(unit).toContain('ExecStart="/home/me/Ramu Data/Ramu" "/home/me/Ramu Data/resources/daemon.js"')
  expect(unit).toContain('Environment="RAMU_USER_DATA=/home/me/100%% \\"Ramu\\""')
  expect(unit).toContain('Restart=on-failure')
  expect(unit).toContain('WantedBy=default.target')
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

it('reports a service that exits during startup at once instead of waiting out the start timeout', async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { ensureRuntime } = await import('../src/main/runtimeLauncher')
  const directory = mkdtempSync(join(tmpdir(), 'ramu-failed-startup-'))
  try {
    const daemon = join(directory, 'daemon.js')
    writeFileSync(daemon, 'process.exit(1)')
    const started = Date.now()
    await expect(ensureRuntime(directory, daemon, process.execPath, 60_000)).rejects.toThrow(
      'Background service could not start',
    )
    expect(Date.now() - started).toBeLessThan(5_000)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
