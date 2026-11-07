// An app run on this computer for demos and home use, reachable from the internet through a tunnel of its own.
// The review in docs/SHIP-AN-APP-PLAN.md holds here: the app runs in a Docker container with only its port published to
// loopback (no host network, no Ramu environment), the tunnel names exactly that port, and it gets a hostname of its
// own that shares nothing with Ramu's address or the artifacts' pages.
import { execFile } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { createServer, type AddressInfo } from 'node:net'
import { join } from 'node:path'
import type { TunnelChoice } from '@ramu/shared/types'
import { DOCKER_MANIFESTS, exposedPort, serverDockerfile } from '@ramu/shared/serverDeploy'
import type { LocalAppStatus } from '@ramu/shared/types/deploy'
import { TunnelManager } from '../../remote/tunnel'

const BUILD_TIMEOUT_MS = 15 * 60_000
const OUTPUT_TAIL = 2000
const MANIFEST_MAX_BYTES = 256 * 1024

/** Runs one command with no shell; `input` goes to its standard input. Resolves with its output. */
export type LocalRun = (argv: string[], options?: { cwd?: string; input?: string; timeout?: number }) => Promise<string>

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
export function localRunArgs(name: string, hostPort: number, appPort: number): string[] {
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
    name,
  ]
}

interface Running {
  tunnel: TunnelManager
  since: number
  error: string | null
  state: LocalAppStatus['state']
}

/** Apps the person published from this computer, each in its own container behind its own tunnel. */
export class LocalApps {
  private readonly apps = new Map<string, Running>()

  constructor(
    private readonly deps: {
      run?: LocalRun
      tunnels?: (changed: () => void) => TunnelManager
      /** Projects left published, with their folders, so they start again with Ramu. */
      saved: { read(): Record<string, string>; write(apps: Record<string, string>): void }
      /** The tunnel kind this computer's pages opened to anyone use; never Ramu's own tunnel. */
      choice: () => TunnelChoice
      changed?: (projectId: string) => void
      freePort?: () => Promise<number>
    },
  ) {}

  private get run() {
    return this.deps.run ?? runLocal
  }

  async restore() {
    for (const [projectId, root] of Object.entries(this.deps.saved.read()))
      await this.publish(projectId, root).catch(() => {})
  }

  async publish(projectId: string, root: string): Promise<LocalAppStatus> {
    const choice = this.deps.choice()
    if (choice.kind === 'tailscale')
      throw new Error('Tailscale Funnel would serve the app on this computer’s own name. Choose Cloudflare or ngrok.')
    if (choice.kind === 'ngrok' && choice.domain)
      throw new Error('A fixed ngrok domain belongs to this computer. Use ngrok without a domain or Cloudflare.')
    if (this.apps.has(projectId)) return this.status(projectId)
    try {
      await this.run(['docker', 'version', '--format', '{{.Server.Version}}'], { timeout: 15_000 })
    } catch {
      throw new Error(
        'Docker must be installed and running to publish from this computer: the app runs in a container so it cannot reach Ramu or your files. Start Docker Desktop and try again.',
      )
    }
    const { dockerfile, port } = this.dockerfile(root)
    const name = localAppName(projectId)
    const app: Running = { tunnel: this.tunnel(projectId), since: Date.now(), error: null, state: 'building' }
    this.apps.set(projectId, app)
    this.deps.changed?.(projectId)
    try {
      await this.run(['docker', 'build', '--tag', name, '--file', dockerfile === null ? 'Dockerfile' : '-', '.'], {
        cwd: root,
        timeout: BUILD_TIMEOUT_MS,
        ...(dockerfile === null ? {} : { input: dockerfile }),
      })
      await this.run(['docker', 'rm', '--force', name]).catch(() => {})
      const hostPort = await (this.deps.freePort ?? freeLoopbackPort)()
      await this.run(localRunArgs(name, hostPort, port))
      app.state = 'running'
      // The tunnel goes to the container's loopback port and nothing else.
      app.tunnel.use(choice, `http://127.0.0.1:${hostPort}`)
      this.deps.saved.write({ ...this.deps.saved.read(), [projectId]: root })
    } catch (error) {
      app.state = 'failed'
      app.error = error instanceof Error ? error.message.slice(-OUTPUT_TAIL) : String(error)
    }
    this.deps.changed?.(projectId)
    return this.status(projectId)
  }

  /** Takes the app off the internet first, then stops its container. */
  async stop(projectId: string) {
    const app = this.apps.get(projectId)
    this.apps.delete(projectId)
    app?.tunnel.stop()
    const saved = this.deps.saved.read()
    delete saved[projectId]
    this.deps.saved.write(saved)
    await this.run(['docker', 'rm', '--force', localAppName(projectId)]).catch(() => {})
    this.deps.changed?.(projectId)
  }

  status(projectId: string): LocalAppStatus {
    const app = this.apps.get(projectId)
    if (!app) return { state: 'off', url: null, error: null, since: null }
    const tunnel = app.tunnel.status()
    return {
      state: app.state === 'running' && tunnel.state === 'failed' ? 'failed' : app.state,
      url: app.tunnel.address(),
      error: app.error ?? tunnel.error,
      since: app.since,
    }
  }

  close() {
    for (const [projectId, app] of this.apps) {
      app.tunnel.stop()
      void this.run(['docker', 'stop', localAppName(projectId)]).catch(() => {})
    }
    this.apps.clear()
  }

  private tunnel(projectId: string) {
    const changed = () => this.deps.changed?.(projectId)
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
