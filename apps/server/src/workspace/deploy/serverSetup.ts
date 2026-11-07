// Connecting the person's own server and setting a project up on it. Connecting signs in with a key Ramu creates (or
// one the person pastes), pins the server's host key on that first contact and keeps both in the host's credential
// store. Setting up checks Docker, writes the app's Caddy site, puts the SSH details in the repository's GitHub Actions
// secrets and opens one pull request with the Dockerfile and deploy job the repository lacks.
import { loadProjectConfig } from '../projectConfig'
import { domainName } from '@ramu/shared/domains'
import {
  DOCKER_MANIFESTS,
  DOCKERIGNORE,
  exposedPort,
  serverAppName,
  serverDockerfile,
  serverWorkflow,
  SERVER_SECRETS,
  SERVER_WORKFLOW_PATH,
} from '@ramu/shared/serverDeploy'
import type { DeployLinkResult, ServerStatus } from '@ramu/shared/types/deploy'
import { HostCredentialStore } from '../../credentials/store'
import { factsAt } from '../ci/setup'
import { SavedCredential } from '../forge/savedCredential'
import { commitBranchInfo, fetchedBranch, git } from '../git'
import { existsAt, proposeFile, type ProposedChange } from '../proposeFile'
import { DeployError, type RepositoryLink } from './adapter'
import type { HostingAccounts } from './accounts'
import type { EnvTarget } from './envSync'
import {
  probeResult,
  PROBE_SCRIPT,
  serverConnection,
  SETUP_SCRIPT,
  WHOAMI_SCRIPT,
  type ServerConnection,
} from './server'
import type { DeployService } from './service'
import {
  generateKeyPair,
  hostKeyFingerprint,
  readPrivateKey,
  remoteCommand,
  runSsh,
  sshHost,
  SSH_USER,
  type SshRunner,
  type SshTarget,
} from './ssh'

/** What setting a project up needs from the workspace. */
export interface ServerSetupHost {
  /** A repository of the project on GitHub, and its checkout on this host. */
  repository(projectId: string, repoId: string): Promise<{ link: RepositoryLink; root: string }>
  /** The repository's GitHub Actions secrets, where the deploy job reads the SSH details. */
  actionsSecrets(root: string): EnvTarget
}

/** A key pair made on this host and not used yet; the public line is shown, the private one never leaves the host. */
interface PendingKey {
  token: string
  publicKey: string
}

type State = ConstructorParameters<typeof SavedCredential>[1]
type SetState = ConstructorParameters<typeof SavedCredential>[2]

const BRANCH = 'ramu/deploy-to-server'
const CI_PATH = '.github/workflows/ci.yml'

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

export class ServerSetup {
  private readonly pending: SavedCredential<PendingKey>

  constructor(
    getState: State,
    setState: SetState,
    private readonly accounts: HostingAccounts,
    private readonly service: DeployService,
    private readonly host: ServerSetupHost,
    credentials = new HostCredentialStore(),
    private readonly ssh: SshRunner = runSsh,
  ) {
    this.pending = new SavedCredential<PendingKey>(
      { key: 'server-pending-key', connectionId: 'server-pending-key', shown: 'publicKey' },
      getState,
      setState,
      credentials,
    )
  }

  private async connection(): Promise<ServerConnection | null> {
    if (!this.accounts.connected('server')) return null
    return serverConnection((await this.accounts.auth('server')).auth.token)
  }

  /** Runs a fixed script on the server; a failing script reports its error output. */
  private async remote(target: SshTarget, script: string, values: string[], what: string) {
    const result = await this.ssh(target, remoteCommand(script, values), '')
    if (result.code !== 0)
      throw new DeployError(
        `The server failed while ${what}: ${result.stderr.trim().split('\n').slice(-6).join('\n')}`,
        null,
      )
    return result
  }

  /** The connected server, and with `check` whether Docker can run apps there. */
  async status(check: boolean): Promise<ServerStatus> {
    const base: ServerStatus = {
      connection: null,
      pendingKey: this.pending.savedField()?.shown ?? null,
      docker: null,
      dockerVersion: null,
      portsBusy: false,
      error: null,
    }
    let connection: ServerConnection | null
    try {
      connection = await this.connection()
    } catch (error) {
      return { ...base, error: message(error) }
    }
    if (!connection) return base
    const shown: ServerStatus = {
      ...base,
      connection: {
        host: connection.host,
        port: connection.port,
        user: connection.user,
        fingerprint: hostKeyFingerprint(connection.knownHosts),
        publicKey: connection.publicKey,
      },
    }
    if (!check) return shown
    try {
      const probe = probeResult((await this.remote(connection, PROBE_SCRIPT, [], 'checking Docker')).stdout)
      return { ...shown, docker: probe.docker, dockerVersion: probe.version, portsBusy: probe.portsBusy }
    } catch (error) {
      return { ...shown, error: message(error) }
    }
  }

  /** The public line of a key pair for the server, made once and kept until a connection uses it. */
  async createKey(): Promise<string> {
    const saved = this.pending.savedField()?.shown
    if (saved) return saved
    const { privateKey, publicKey } = generateKeyPair('ramu')
    await this.pending.save({ token: privateKey, publicKey })
    return publicKey
  }

  /**
   * Signs in to the server and keeps the connection. The server's host key is learned on first contact and pinned;
   * reconnecting the same address keeps the pinned key, so a changed one is refused rather than learned again.
   */
  async connect(input: { host: string; port: number; user: string; privateKey: string | null }): Promise<ServerStatus> {
    const host = sshHost(input.host)
    if (!host) throw new Error('Enter the server’s address, such as 203.0.113.10 or server.example.com.')
    if (!SSH_USER.test(input.user)) throw new Error('Enter the user Ramu signs in as, such as deploy.')
    let key: { privateKey: string; publicKey: string | null }
    if (input.privateKey) key = readPrivateKey(input.privateKey)
    else {
      const pending = await this.pending.read()
      if (!pending) throw new Error('Create a key first, then add its public line to the server.')
      key = { privateKey: pending.token, publicKey: pending.publicKey }
    }
    const previous = await this.connection().catch(() => null)
    const pinned = previous?.host === host && previous.port === input.port ? previous.knownHosts : null
    const first = await this.remote(
      { host, port: input.port, user: input.user, privateKey: key.privateKey, knownHosts: pinned },
      WHOAMI_SCRIPT,
      [],
      'signing in',
    )
    if (!first.knownHosts) throw new Error('The server did not show a host key Ramu could pin.')
    const connection: ServerConnection = {
      host,
      port: input.port,
      user: input.user,
      privateKey: key.privateKey,
      publicKey: key.publicKey,
      knownHosts: first.knownHosts,
    }
    await this.accounts.save('server', { token: JSON.stringify(connection) }, 'token')
    if (!input.privateKey) await this.pending.remove()
    return this.status(true)
  }

  /** The files the default branch lacks, and the port the app listens on. */
  private async plan(root: string, ref: string, defaultBranch: string, app: string) {
    const facts = await factsAt(root, ref, DOCKER_MANIFESTS)
    const files: ProposedChange['files'] = []
    const notes: string[] = []
    let port: number
    if (facts.files.includes('Dockerfile')) {
      const existing = await git(root, ['cat-file', 'blob', `${ref}:Dockerfile`]).catch(() => '')
      const exposed = exposedPort(existing)
      if (!exposed)
        throw new Error('The Dockerfile names no port. Add an EXPOSE line with the port the app listens on.')
      port = exposed
    } else {
      const dockerfile = serverDockerfile(facts)
      if (!dockerfile)
        throw new Error(
          'Ramu cannot tell how this app starts. Ask an agent to add a Dockerfile with an EXPOSE line, then set up the server again.',
        )
      port = dockerfile.port
      files.push({ path: 'Dockerfile', content: dockerfile.content })
      notes.push(`\`Dockerfile\` ${dockerfile.summary}.`)
      if (!facts.files.includes('.dockerignore')) {
        files.push({ path: '.dockerignore', content: DOCKERIGNORE })
        notes.push('`.dockerignore` keeps `.env` files and installed dependencies out of the image.')
      }
    }
    const workflow = await git(root, ['cat-file', 'blob', `${ref}:${SERVER_WORKFLOW_PATH}`]).catch(() => null)
    if (workflow === null) {
      const afterCi = await existsAt(root, ref, CI_PATH)
      files.push({ path: SERVER_WORKFLOW_PATH, content: serverWorkflow({ app, defaultBranch, afterCi }) })
      notes.push(
        `\`${SERVER_WORKFLOW_PATH}\` ${afterCi ? 'runs after CI passes' : 'runs on every push'} on \`${defaultBranch}\`: it builds the image, pushes it to GitHub’s container registry tagged with the commit, and restarts the app on the server over SSH. If the new version stops right after starting, the previous one is put back.`,
      )
    } else if (!workflow.includes(SERVER_SECRETS.key))
      throw new Error(`${SERVER_WORKFLOW_PATH} already exists and is not Ramu’s deploy job. Rename it, then try again.`)
    return { files, notes, port }
  }

  /**
   * Sets a project up on the connected server for `domain`: the Caddy site, the deploy job's secrets, the pull
   * request with the files the repository lacks, then the binding. Each step can run again safely.
   */
  async link(projectId: string, repoId: string, input: string): Promise<DeployLinkResult> {
    const domain = domainName(input)
    if (!domain) throw new Error('Enter a domain name such as app.example.com.')
    const connection = await this.connection()
    if (!connection) throw new DeployError('Connect your server first.', 'signed-out')
    const { link, root } = await this.host.repository(projectId, repoId)
    const repository = `${link.owner}/${link.name}`
    const app = serverAppName(repository)
    const probe = probeResult((await this.remote(connection, PROBE_SCRIPT, [], 'checking Docker')).stdout)
    if (probe.docker === 'missing')
      throw new Error('Install Docker on the server first; the Deploy sheet lists the steps.')
    if (probe.docker === 'no-permission')
      throw new Error(
        `${connection.user} cannot use Docker on the server. Add the user to the docker group, sign in again, and check that Docker is running.`,
      )
    if (probe.portsBusy)
      throw new Error(
        'Another web server already uses port 80 or 443 on the server. Stop it so Caddy can serve HTTPS, then try again.',
      )
    const defaultBranch = (await commitBranchInfo(root)).defaultBranch ?? link.productionBranch
    const { ref } = await fetchedBranch(root, defaultBranch)
    const plan = await this.plan(root, ref, defaultBranch, app)
    const healthPath = loadProjectConfig(root).config.stack?.healthPath ?? '/'
    await this.remote(connection, SETUP_SCRIPT, [app, String(plan.port), domain, healthPath], 'setting up Caddy')
    await this.host.actionsSecrets(root).set('ci', {
      [SERVER_SECRETS.key]: connection.privateKey,
      [SERVER_SECRETS.knownHosts]: connection.knownHosts,
      [SERVER_SECRETS.host]: connection.host,
      [SERVER_SECRETS.user]: connection.user,
      [SERVER_SECRETS.port]: String(connection.port),
    })
    const { url } = await proposeFile(root, BRANCH, async () => ({
      files: plan.files,
      commit: `ci: deploy to your own server\n\n${plan.files.map((file) => `Adds ${file.path}.`).join('\n')}\n`,
      title: 'Deploy to your own server',
      body: [
        ...plan.notes,
        `The SSH key, address and pinned host key are in this repository’s Actions secrets (${Object.values(SERVER_SECRETS).join(', ')}). The app’s variables live on the server, not in the image.`,
        'Merge this to deploy; every later merge deploys again.',
      ].join('\n\n'),
    }))
    const { accountId } = await this.accounts.auth('server')
    this.service.bind(projectId, {
      platform: 'server',
      siteId: repository,
      siteName: domain,
      repository,
      productionBranch: defaultBranch,
      accountId: accountId ?? `${connection.user}@${connection.host}:${connection.port}`,
      scope: null,
    })
    return { deployment: await this.service.project(projectId), pullRequest: url }
  }
}
