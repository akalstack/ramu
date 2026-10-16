// Extra standalone Ramu servers (`ramu serve`) next to the desktop app or on their own: other computers to pair with, or
// hosts for the phone transport. Each has its own profile and unix socket and stops when the spec file finishes.
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { join, resolve } from 'node:path'
import { after } from 'node:test'
import { socketInvoke } from './app.mjs'
import { until } from './util.mjs'

// One hook for the whole file: a hook registered inside a test would run when that test ends, before a later restart.
const servers = new Set()
after(() => Promise.all([...servers].map((server) => server.stop())))

const cli = join(resolve(import.meta.dirname, '..', '..'), 'apps', 'server', 'dist', 'cli.js')

/** A free loopback port. */
export async function freePort() {
  const listener = createServer()
  await new Promise((done) => listener.listen(0, '127.0.0.1', done))
  const { port } = listener.address()
  await new Promise((done) => listener.close(done))
  return port
}

/**
 * Starts `ramu serve` with the profile `<dir>/<name>` and waits until it answers on its socket:
 *
 *   const host = await startServer({ name: 'studio', dir: ramu.dir, listen: true })
 *   const offer = await host.invoke('network.pair')
 *
 * `listen`: omit for a socket-only server, `true` for a free loopback port, or a port / `host:port`.
 * `env` adds server environment. `stop()` ends the process and `start()` brings the same profile back (a restart);
 * `pair(name)` returns { token, deviceId } for a network client.
 */
export async function startServer({ name, dir, listen, env = {} }) {
  const profile = join(dir, name)
  const socket = join(dir, `${name}.sock`)
  const port = listen === true ? await freePort() : listen ? Number(String(listen).split(':').pop()) : null
  const address = listen === true ? String(port) : listen ? String(listen) : null
  const server = {
    name,
    profile,
    socket,
    port,
    url: port ? `http://127.0.0.1:${port}` : null,
    child: null,
    invoke: (method, ...args) => socketInvoke(socket, method, ...args),
    async start() {
      this.child = spawn(
        process.execPath,
        [cli, 'serve', '--data-dir', profile, ...(address ? ['--listen', address] : [])],
        {
          env: {
            ...process.env,
            RAMU_SOCKET: socket,
            RAMU_WORKTREES: join(profile, 'worktrees'),
            RAMU_FAKE_AGENT: '1',
            ...env,
          },
          stdio: 'ignore',
        },
      )
      await until(
        () =>
          this.invoke('background.status').then(
            () => true,
            () => false,
          ),
        `server "${name}" did not start`,
        { attempts: 120, interval: 250 },
      )
      return this
    },
    async stop() {
      const { child } = this
      if (!child || child.exitCode != null) return
      const exited = new Promise((done) => child.once('exit', done))
      child.kill('SIGTERM')
      // A server with connected clients can linger on shutdown.
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
      await exited
      clearTimeout(timer)
    },
    async pair(deviceName = 'E2E device') {
      const offer = await this.invoke('network.pair')
      const response = await fetch(`${this.url}/pair`, {
        method: 'POST',
        body: JSON.stringify({ code: offer.code, name: deviceName }),
      })
      return response.json()
    },
  }
  servers.add(server)
  return server.start()
}
