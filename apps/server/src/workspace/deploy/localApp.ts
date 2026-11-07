// An app run on this computer for demos and home use, reachable from the internet through a tunnel of its own.
// The review in docs/SHIP-AN-APP-PLAN.md holds here: by default the app runs in a Docker container with only its port
// published to loopback (no host network, no Ramu environment), the tunnel names exactly that port, and it gets a
// hostname of its own that shares nothing with Ramu's address or the artifacts' pages. Without Docker, and only when the
// person chooses it, a Node app runs as a program in its own process group, with none of Ramu's environment, on a
// loopback port; it has the person's own permissions, which the sheet says before it starts.
import { execFile, spawn } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { connect, createServer, type AddressInfo } from 'node:net'
import { join } from 'node:path'
import type { TunnelChoice } from '@ramu/shared/types'
import { DOCKER_MANIFESTS, exposedPort, serverDockerfile } from '@ramu/shared/serverDeploy'
import type { LocalAppMode, LocalAppStatus } from '@ramu/shared/types/deploy'
import { TunnelManager } from '../../remote/tunnel'
import { NamedTunnel, type LastingAddress, type LastingAddresses } from './namedTunnel'

const BUILD_TIMEOUT_MS = 15 * 60_000
const OUTPUT_TAIL = 2000
const MANIFEST_MAX_BYTES = 256 * 1024
const RESERVED = new Set(['PATH', 'HOME', 'DOCKER_HOST', 'DOCKER_CONFIG', 'DOCKER_CONTEXT'])
/** Set by Ramu for a program run without Docker, so the app listens where the tunnel goes. */
const PROCESS_RESERVED = new Set(['PATH', 'HOME', 'PORT', 'HOST', 'HOSTNAME', 'NODE_ENV'])
const START_TIMEOUT_MS = 90_000

/** Runs one command with no shell; `input` goes to its standard input. Resolves with its output. */
export type LocalRun = (
  argv: string[],
  options?: { cwd?: string; input?: string; timeout?: number; env?: Record<string, string> },
) => Promise<string>

export const runLocal: LocalRun = (argv, options = {}) =>
  new Promise((resolve, reject) => {
    const child = execFile(
      argv[0]!,
      argv.slice(1),
      {
        cwd: options.cwd,
        timeout: options.timeout ?? 60_000,
        maxBuffer: 32 * 1024 * 1024,
        // Docker needs only where it is and who is asking; nothing of Ramu's reaches the build or the app.
        env: {
          PATH: process.env.PATH ?? '',
          HOME: process.env.HOME ?? '',
          ...(process.env.DOCKER_HOST ? { DOCKER_HOST: process.env.DOCKER_HOST } : {}),
          ...options.env,
        },
      },
      (error, stdout, stderr) => {
        if (!error) return resolve(stdout)
        const output = `${stdout}${stderr}`.trim().slice(-OUTPUT_TAIL)
        reject(new Error(output || error.message))
      },
    )
    if (options.input !== undefined) child.stdin?.end(options.input)
    else child.stdin?.end()
  })

/** A Docker name for the project: letters, digits and dashes only. */
export function localAppName(projectId: string): string {
  return `ramu-local-${
    projectId
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'app'
  }`
}

/** The `docker run` arguments: only the app's port, published to loopback, with privileges dropped. */
export function localRunArgs(name: string, hostPort: number, appPort: number, variables: string[] = []): string[] {
  return [
    'docker',
    'run',
    '--detach',
    '--name',
    name,
    '--restart',
    'no',
    '--security-opt',
    'no-new-privileges',
    '--publish',
    `127.0.0.1:${hostPort}:${appPort}`,
    ...variables.flatMap((variable) => ['--env', variable]),
    name,
  ]
}

/** A program started without Docker: stopped with its whole process group. */
export interface LocalProcess {
  stop(): void
  /** Resolves when it exits, with the end of what it printed. */
  exited: Promise<string>
}

/** Starts one program with no shell in its own process group; nothing of Ramu's environment beyond `env` reaches it. */
export function startLocalProcess(argv: string[], options: { cwd: string; env: Record<string, string> }): LocalProcess {
  const child = spawn(argv[0]!, argv.slice(1), {
    cwd: options.cwd,
    env: options.env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  const keep = (chunk: Buffer) => (output = (output + chunk.toString()).slice(-OUTPUT_TAIL))
  child.stdout?.on('data', keep)
  child.stderr?.on('data', keep)
  const signal = (name: NodeJS.Signals) => {
    try {
      if (child.pid) process.kill(-child.pid, name)
    } catch {
      // Already gone.
    }
  }
  return {
    exited: new Promise((resolve) => {
      child.once('error', (error) => resolve(`${output}${error.message}`.slice(-OUTPUT_TAIL)))
      child.once('exit', () => resolve(output))
    }),
    stop: () => {
      signal('SIGTERM')
      setTimeout(() => signal('SIGKILL'), 5_000).unref()
    },
  }
}

/** Resolves once something answers on the loopback port, or rejects after `timeout`. */
function waitForPort(port: number, timeout: number): Promise<void> {
  const deadline = Date.now() + timeout
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = connect({ host: '127.0.0.1', port })
      socket.once('connect', () => {
        socket.destroy()
        resolve()
      })
      socket.once('error', () => {
        socket.destroy()
        if (Date.now() > deadline) reject(new Error(`The app did not start listening on port ${port}.`))
        else setTimeout(attempt, 500)
      })
    }
    attempt()
  })
}

/** The package manager a Node app's lockfile names. */
function packageManager(root: string): string {
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn'
  if (existsSync(join(root, 'bun.lock')) || existsSync(join(root, 'bun.lockb'))) return 'bun'
  return 'npm'
}

/** What runs the app's public address: a quick tunnel, or the named tunnel of its lasting address. */
type AppTunnel = Pick<TunnelManager, 'use' | 'stop' | 'address'> & {
  status(): { state: string; error: string | null }
}

interface Running {
  tunnel: AppTunnel
  since: number
  error: string | null
  state: LocalAppStatus['state']
  mode: LocalAppMode
  process?: LocalProcess
}

/** Where a published app's folder is and how it ran, kept so it starts again with Ramu. */
export interface SavedApp {
  root: string
  mode: LocalAppMode
}

/** Apps the person published from this computer, each in its own container (or program) behind its own tunnel. */
export class LocalApps {
  private readonly apps = new Map<string, Running>()
  /** The project's own variables the app reads, from this host's Environment variables; none until set. */
  private variables: (root: string) => Promise<Record<string, string>> = async () => ({})

  constructor(
    private readonly deps: {
      run?: LocalRun
      tunnels?: (changed: () => void) => TunnelManager
      /** Projects left published, with their folders and how they ran, so they start again with Ramu. */
      saved: { read(): Record<string, SavedApp>; write(apps: Record<string, SavedApp>): void }
      /** The tunnel kind this computer's pages opened to anyone use; never Ramu's own tunnel. */
      choice: () => TunnelChoice
      changed?: (projectId: string) => void
      freePort?: () => Promise<number>
      start?: typeof startLocalProcess
      /** Lasting addresses: a project with one runs at its fixed port and hostname instead of a quick tunnel. */
      addresses?: Pick<LastingAddresses, 'address' | 'hostname' | 'set' | 'remove'>
      listening?: (port: number, timeout: number) => Promise<void>
    },
  ) {}

  private get run() {
    return this.deps.run ?? runLocal
  }

  /** Reads the app's variables with `variables` from now on, then starts the apps left published. */
  async start(variables: (root: string) => Promise<Record<string, string>>) {
    this.variables = variables
    for (const [projectId, { root, mode }] of Object.entries(this.deps.saved.read()))
      await this.publish(projectId, root, mode).catch(() => {})
  }

  async publish(projectId: string, root: string, mode: LocalAppMode = 'container'): Promise<LocalAppStatus> {
    const choice = this.deps.choice()
    const lasting = (await this.deps.addresses?.address(projectId)) ?? null
    if (!lasting && choice.kind === 'tailscale')
      throw new Error('Tailscale Funnel would serve the app on this computer’s own name. Choose Cloudflare or ngrok.')
    if (!lasting && choice.kind === 'ngrok' && choice.domain)
      throw new Error('A fixed ngrok domain belongs to this computer. Use ngrok without a domain or Cloudflare.')
    if (this.apps.has(projectId)) return this.status(projectId)
    if (mode === 'process') return this.publishProcess(projectId, root, choice, lasting)
    try {
      await this.run(['docker', 'version', '--format', '{{.Server.Version}}'], { timeout: 15_000 })
    } catch {
      throw new Error(
        'Docker must be installed and running to publish from this computer: the app runs in a container so it cannot reach Ramu or your files. Start Docker Desktop and try again.',
      )
    }
    const { dockerfile, port } = this.dockerfile(root)
    const name = localAppName(projectId)
    const app: Running = {
      tunnel: this.tunnel(projectId, lasting),
      since: Date.now(),
      error: null,
      state: 'building',
      mode: 'container',
    }
    this.apps.set(projectId, app)
    this.deps.changed?.(projectId)
    try {
      await this.run(['docker', 'build', '--tag', name, '--file', dockerfile === null ? 'Dockerfile' : '-', '.'], {
        cwd: root,
        timeout: BUILD_TIMEOUT_MS,
        ...(dockerfile === null ? {} : { input: dockerfile }),
      })
      await this.run(['docker', 'rm', '--force', name]).catch(() => {})
      const hostPort = lasting?.port ?? (await (this.deps.freePort ?? freeLoopbackPort)())
      // Names docker itself relies on are never taken from the app's variables.
      const variables = Object.fromEntries(
        Object.entries(await this.variables(root)).filter(([key]) => !RESERVED.has(key)),
      )
      // Each value reaches docker in its own environment, named by `--env NAME`, never on a command line.
      await this.run(localRunArgs(name, hostPort, port, Object.keys(variables)), { env: variables })
      app.state = 'running'
      // The tunnel goes to the container's loopback port and nothing else.
      app.tunnel.use(choice, `http://127.0.0.1:${hostPort}`)
      this.deps.saved.write({ ...this.deps.saved.read(), [projectId]: { root, mode: 'container' } })
    } catch (error) {
      app.state = 'failed'
      app.error = error instanceof Error ? error.message.slice(-OUTPUT_TAIL) : String(error)
    }
    this.deps.changed?.(projectId)
    return this.status(projectId)
  }

  /**
   * A Node app run as a program: installed when it has no node_modules, built when it has a build script, then started
   * with its start script on a loopback port, which the tunnel names once something answers there.
   */
  private async publishProcess(
    projectId: string,
    root: string,
    choice: TunnelChoice,
    lasting: (LastingAddress & { tunnelToken: string }) | null,
  ): Promise<LocalAppStatus> {
    const manifest = existsSync(join(root, 'package.json'))
      ? (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts?: Record<string, string> })
      : null
    if (!manifest?.scripts?.start)
      throw new Error('Without Docker, Ramu runs a Node app with a start script. Use Docker for other apps.')
    const app: Running = {
      tunnel: this.tunnel(projectId, lasting),
      since: Date.now(),
      error: null,
      state: 'building',
      mode: 'process',
    }
    this.apps.set(projectId, app)
    this.deps.changed?.(projectId)
    const pm = packageManager(root)
    try {
      const variables = Object.fromEntries(
        Object.entries(await this.variables(root)).filter(([key]) => !PROCESS_RESERVED.has(key)),
      )
      if (!existsSync(join(root, 'node_modules')))
        await this.run([pm, 'install'], { cwd: root, timeout: BUILD_TIMEOUT_MS })
      if (manifest.scripts.build)
        await this.run([pm, 'run', 'build'], {
          cwd: root,
          timeout: BUILD_TIMEOUT_MS,
          env: { ...variables, NODE_ENV: 'production' },
        })
      const port = lasting?.port ?? (await (this.deps.freePort ?? freeLoopbackPort)())
      const started = (this.deps.start ?? startLocalProcess)([pm, 'run', 'start'], {
        cwd: root,
        env: {
          ...variables,
          PATH: process.env.PATH ?? '',
          HOME: process.env.HOME ?? '',
          PORT: String(port),
          HOST: '127.0.0.1',
          HOSTNAME: '127.0.0.1',
          NODE_ENV: 'production',
        },
      })
      app.process = started
      void started.exited.then((output) => {
        if (this.apps.get(projectId) !== app) return
        app.state = 'failed'
        app.error = output.trim() || 'The app stopped.'
        app.tunnel.stop()
        this.deps.changed?.(projectId)
      })
      await Promise.race([
        (this.deps.listening ?? waitForPort)(port, START_TIMEOUT_MS),
        started.exited.then((output) => Promise.reject(new Error(output.trim() || 'The app stopped.'))),
      ])
      app.state = 'running'
      app.tunnel.use(choice, `http://127.0.0.1:${port}`)
      this.deps.saved.write({ ...this.deps.saved.read(), [projectId]: { root, mode: 'process' } })
    } catch (error) {
      app.process?.stop()
      app.state = 'failed'
      app.error = error instanceof Error ? error.message.slice(-OUTPUT_TAIL) : String(error)
    }
    this.deps.changed?.(projectId)
    return this.status(projectId)
  }

  /** The app's lasting address while it is published and running there; null for a quick tunnel or a stopped app. */
  lastingUrl(projectId: string): string | null {
    const hostname = this.deps.addresses?.hostname(projectId)
    return hostname && this.apps.get(projectId)?.state === 'running' ? `https://${hostname}` : null
  }

  /** Gives the project a lasting address on the person's Cloudflare account; it applies from the next publish. */
  async setLasting(projectId: string, input: { hostname: string; token: string }): Promise<LocalAppStatus> {
    if (!this.deps.addresses) throw new Error('Update this host for lasting addresses.')
    if (this.apps.has(projectId)) throw new Error('Stop the app first, then give it a lasting address.')
    await this.deps.addresses.set(projectId, input)
    return this.status(projectId)
  }

  /** Removes the lasting address's tunnel and DNS record; the app goes back to a quick tunnel. */
  async removeLasting(projectId: string): Promise<LocalAppStatus> {
    if (this.apps.has(projectId)) throw new Error('Stop the app first.')
    await this.deps.addresses?.remove(projectId)
    return this.status(projectId)
  }

  /** Takes the app off the internet first, then stops its container or program. */
  async stop(projectId: string) {
    const app = this.apps.get(projectId)
    this.apps.delete(projectId)
    app?.tunnel.stop()
    const saved = this.deps.saved.read()
    delete saved[projectId]
    this.deps.saved.write(saved)
    if (app?.process) app.process.stop()
    else await this.run(['docker', 'rm', '--force', localAppName(projectId)]).catch(() => {})
    this.deps.changed?.(projectId)
  }

  status(projectId: string): LocalAppStatus {
    const app = this.apps.get(projectId)
    const hostname = this.deps.addresses?.hostname(projectId) ?? null
    if (!app) return { state: 'off', mode: null, url: null, error: null, since: null, lasting: hostname }
    const tunnel = app.tunnel.status()
    return {
      state: app.state === 'running' && tunnel.state === 'failed' ? 'failed' : app.state,
      mode: app.mode,
      lasting: hostname,
      url: app.tunnel.address(),
      error: app.error ?? tunnel.error,
      since: app.since,
    }
  }

  close() {
    for (const [projectId, app] of this.apps) {
      app.tunnel.stop()
      if (app.process) app.process.stop()
      else void this.run(['docker', 'stop', localAppName(projectId)]).catch(() => {})
    }
    this.apps.clear()
  }

  private tunnel(projectId: string, lasting: (LastingAddress & { tunnelToken: string }) | null = null): AppTunnel {
    const changed = () => this.deps.changed?.(projectId)
    if (lasting) return new NamedTunnel(lasting, changed)
    return this.deps.tunnels ? this.deps.tunnels(changed) : new TunnelManager({ changed })
  }

  /**
   * The project's own Dockerfile (null: build with it as it is) and the port it exposes, or one Ramu writes for the
   * stack and pipes to the build, so nothing is added to the repository.
   */
  private dockerfile(root: string): { dockerfile: string | null; port: number } {
    if (existsSync(join(root, 'Dockerfile'))) {
      const port = exposedPort(readFileSync(join(root, 'Dockerfile'), 'utf8'))
      if (!port) throw new Error('The Dockerfile names no port. Add an EXPOSE line with the port the app listens on.')
      return { dockerfile: null, port }
    }
    const files = readdirSync(root)
    const manifests: Partial<Record<(typeof DOCKER_MANIFESTS)[number], string>> = {}
    for (const manifest of DOCKER_MANIFESTS) {
      const path = join(root, manifest)
      if (existsSync(path) && statSync(path).size <= MANIFEST_MAX_BYTES)
        manifests[manifest] = readFileSync(path, 'utf8')
    }
    const generated = serverDockerfile({ files, manifests })
    if (!generated)
      throw new Error('Ramu cannot tell how this app starts. Ask an agent to add a Dockerfile with an EXPOSE line.')
    return { dockerfile: generated.content, port: generated.port }
  }
}

function freeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port
      server.close(() => resolve(port))
    })
  })
}
