// A project's databases: creating one on the person's own account, keeping its connection values in the credential
// store, and the migrations that run before a production deploy. Connection values reach the app only through secrets
// sync: production's to the platform's production variables, the preview branch's everywhere else.
import { execFile } from 'node:child_process'
import { commandLine } from '@ramu/shared/stacks'
import {
  RESOURCE_KINDS,
  RESOURCE_PROVIDERS,
  type ProjectResource,
  type ProjectResources,
  type HostingPlatform,
  type ResourceKind,
  type ResourceProvider,
  type UsageReport,
} from '@ramu/shared/types/deploy'
import type { EnvEnvironment } from '@ramu/shared/envSync'
import { HostCredentialStore } from '../../credentials/store'
import { SavedCredential } from '../forge/savedCredential'
import { currentBranch, git } from '../git'
import { DeployError, ReplyLostError, tail } from './adapter'
import type { HostingAccounts } from './accounts'
import { resourceAdapter, type ResourceAdapter } from './resource'
import { usageReport } from './usage'

/** The variable names a database's connection uses, which a project's code reading them also signals. */
export const DATABASE_VARIABLES = ['DATABASE_URL', 'DATABASE_URL_UNPOOLED']
/** The branch previews and this host use, so they never write to production's data. */
const PREVIEW_BRANCH = 'preview'
const MIGRATE_TIMEOUT_MS = 10 * 60_000
const OUTPUT_LINES = 60

interface ResourceBinding {
  provider: ResourceProvider
  kind: ResourceKind
  id: string
  name: string
  accountId: string
  previewBranch: boolean
}

/** Connection values, in the credential store. `token` holds the resource id they belong to. */
interface ResourceSecrets {
  token: string
  name: string
  production: Record<string, string>
  preview: Record<string, string>
}

/** What the service needs from the workspace, so tests can give it a project without a database. */
export interface ResourceHost {
  getState<T>(key: string, fallback: T): T
  setState(key: string, value: unknown): void
  /** The project's `ramu.json` stack facts. */
  stack(projectId: string): Record<ResourceKind, boolean> & { migrate: string[] | null }
  /** The platform the project deploys to, whose own database the sheet can point to. */
  platform?(projectId: string): string | null
}

/** A migration that failed: its output tail, for the person and the thread. */
export class MigrationError extends Error {
  constructor(
    message: string,
    readonly output: string,
  ) {
    super(message)
  }
}

/** Runs one argument list with only the variables a migration needs: no Ramu secrets, no agent markers. */
export type MigrationRunner = (
  argv: string[],
  cwd: string,
  variables: Record<string, string>,
) => Promise<{ ok: boolean; output: string }>

export const runMigration: MigrationRunner = (argv, cwd, variables) =>
  new Promise((resolve) => {
    const keep = ['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TMPDIR', 'SHELL', 'SystemRoot']
    const env = {
      ...Object.fromEntries(keep.flatMap((key) => (process.env[key] ? [[key, process.env[key]]] : []))),
      ...variables,
    }
    execFile(
      argv[0]!,
      argv.slice(1),
      { cwd, env, timeout: MIGRATE_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => resolve({ ok: !error, output: `${stdout}\n${stderr}` }),
    )
  })

const KIND_NAMES: Record<ResourceKind, string> = { database: 'a database' }

const key = (projectId: string) => `resources:${projectId}`
const branchKey = (projectId: string) => `resource-branches:${projectId}`
/** Open pull requests with a database branch of their own; past this, they share the preview branch. */
const BRANCHES_MAX = 4
/** A provider branch name for a git branch: lowercase letters, digits and dashes. */
export const pullRequestBranch = (gitBranch: string) =>
  `pr-${
    gitBranch
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'branch'
  }`

export class ResourceService {
  constructor(
    private readonly host: ResourceHost,
    private readonly accounts: HostingAccounts,
    private readonly credentials = new HostCredentialStore(),
    private readonly adapter: (provider: ResourceProvider) => ResourceAdapter = resourceAdapter,
    private readonly migrate: MigrationRunner = runMigration,
  ) {}

  private bindings(projectId: string): ResourceBinding[] {
    return this.host.getState<ResourceBinding[]>(key(projectId), [])
  }

  private secrets(projectId: string, kind: ResourceKind) {
    return new SavedCredential<ResourceSecrets>(
      { key: `resource-${projectId}-${kind}`, connectionId: `resource-${projectId}-${kind}`, shown: 'name' },
      (name, fallback) => this.host.getState(name, fallback),
      (name, value) => this.host.setState(name, value),
      this.credentials,
    )
  }

  /** The account a call runs as, refused when another account is connected than the one that made the resource. */
  private async auth(provider: ResourceProvider, accountId?: string) {
    const { auth, accountId: connected } = await this.accounts.auth(provider)
    if (accountId && connected && connected !== accountId)
      throw new DeployError(
        `This database was made under another ${this.adapter(provider).name} account. Connect that account again.`,
        'missing-permission',
      )
    return { auth, accountId: connected ?? (await this.adapter(provider).account(auth)).id }
  }

  /** The project's resource of a kind, as kept. */
  binding(projectId: string, kind: ResourceKind): ResourceBinding | null {
    return this.bindings(projectId).find((entry) => entry.kind === kind) ?? null
  }

  /** The project's database, when its provider can make and remove branches for pull requests. */
  private branchable(projectId: string): ResourceBinding | null {
    const binding = this.bindings(projectId).find((entry) => entry.kind === 'database' && entry.previewBranch)
    if (!binding) return null
    const adapter = this.adapter(binding.provider)
    return adapter.branch && adapter.removeBranch ? binding : null
  }

  /** Git branches whose pull request has a database branch of its own. */
  branchesOf(projectId: string): string[] {
    return this.host.getState<string[]>(branchKey(projectId), [])
  }

  canBranch(projectId: string): boolean {
    return !!this.branchable(projectId)
  }

  /**
   * A database branch for a pull request's git branch, copied from production; its connection values, or null when it
   * has one already, the project cannot branch, or as many pull requests as allowed have one.
   */
  async openBranch(projectId: string, gitBranch: string): Promise<Record<string, string> | null> {
    const binding = this.branchable(projectId)
    const open = this.branchesOf(projectId)
    if (!binding || open.includes(gitBranch) || open.length >= BRANCHES_MAX) return null
    const { auth } = await this.auth(binding.provider, binding.accountId)
    const values = await this.adapter(binding.provider).branch!(auth, binding.id, pullRequestBranch(gitBranch))
    this.host.setState(branchKey(projectId), [...this.branchesOf(projectId), gitBranch])
    return values
  }

  /** Deletes a closed pull request's database branch; the variable names it set, for removing them on the platform. */
  async closeBranch(projectId: string, gitBranch: string): Promise<string[]> {
    if (!this.branchesOf(projectId).includes(gitBranch)) return []
    const binding = this.bindings(projectId).find((entry) => entry.kind === 'database')
    if (binding) {
      const { auth } = await this.auth(binding.provider, binding.accountId)
      await this.adapter(binding.provider).removeBranch?.(auth, binding.id, pullRequestBranch(gitBranch))
    }
    this.host.setState(
      branchKey(projectId),
      this.branchesOf(projectId).filter((branch) => branch !== gitBranch),
    )
    const secrets = binding ? await this.secrets(projectId, binding.kind).read() : null
    return Object.keys(secrets?.preview ?? {})
  }

  async status(projectId: string, appVariables: string[]): Promise<ProjectResources> {
    const stack = this.host.stack(projectId)
    const resources = await Promise.all(
      this.bindings(projectId).map(async (binding): Promise<ProjectResource> => {
        const adapter = this.adapter(binding.provider)
        const secrets = await this.secrets(projectId, binding.kind)
          .read()
          .catch(() => null)
        return {
          provider: binding.provider,
          kind: binding.kind,
          id: binding.id,
          name: binding.name,
          variables: Object.keys(secrets?.production ?? {}),
          previewBranch: binding.previewBranch,
          page: adapter.page(binding.id),
        }
      }),
    )
    return {
      needs: RESOURCE_KINDS.filter((kind) => stack[kind] || appVariables.includes('DATABASE_URL')),
      platform: (this.host.platform?.(projectId) ?? null) as HostingPlatform | null,
      providers: RESOURCE_PROVIDERS.map((provider) => {
        const adapter = this.adapter(provider)
        return {
          provider,
          name: adapter.name,
          kind: adapter.kind,
          connected: this.accounts.connected(provider),
          plans: adapter.plans,
        }
      }),
      resources,
      migrate: stack.migrate ? commandLine(stack.migrate) : null,
    }
  }

  /**
   * Creates the project's database on the connected account, with a preview branch where the provider has branching,
   * and keeps the values in the credential store. Returns the values this host's development uses. A provision whose
   * reply is lost looks for the database by name before anything is created again.
   */
  async provision(
    projectId: string,
    provider: ResourceProvider,
    plan: string,
    name: string,
  ): Promise<Record<string, string>> {
    const adapter = this.adapter(provider)
    if (!adapter.plans.some((entry) => entry.id === plan)) throw new Error('Choose one of the offered plans.')
    if (this.bindings(projectId).some((binding) => binding.kind === adapter.kind))
      throw new Error(`This project already has ${KIND_NAMES[adapter.kind]}. Manage it on the provider’s page.`)
    const { auth, accountId } = await this.auth(provider)
    let made
    try {
      made = await adapter.provision(auth, { name }, plan)
    } catch (error) {
      if (!(error instanceof ReplyLostError)) throw error
      made = await adapter.find(auth, name)
      if (!made)
        throw new Error(`${adapter.name} did not answer, and nothing named ${name} is listed. Try again.`, {
          cause: error,
        })
    }
    const preview = adapter.branch ? await adapter.branch(auth, made.id, PREVIEW_BRANCH) : made.variables
    await this.secrets(projectId, adapter.kind).save({
      token: made.id,
      name: made.name,
      production: made.variables,
      preview,
    })
    this.host.setState(key(projectId), [
      ...this.bindings(projectId),
      {
        provider,
        kind: adapter.kind,
        id: made.id,
        name: made.name,
        accountId,
        previewBranch: !!adapter.branch,
      } satisfies ResourceBinding,
    ])
    return preview
  }

  /** What each of the project's resources used this billing period, as far as its provider reports it. */
  async usage(projectId: string): Promise<UsageReport[]> {
    return Promise.all(
      this.bindings(projectId).map(async (binding) => {
        const adapter = this.adapter(binding.provider)
        return usageReport(
          binding.provider,
          adapter.name,
          adapter.usage &&
            (async () => {
              const { auth } = await this.auth(binding.provider, binding.accountId)
              return adapter.usage!(auth, binding.id)
            }),
        )
      }),
    )
  }

  /** The variables each environment gets: production's values for production, the preview branch's elsewhere. */
  async environmentValues(projectId: string): Promise<Partial<Record<EnvEnvironment, Record<string, string>>>> {
    const values: Partial<Record<EnvEnvironment, Record<string, string>>> = {}
    for (const binding of this.bindings(projectId)) {
      const secrets = await this.secrets(projectId, binding.kind).read()
      if (!secrets) continue
      values.production = { ...values.production, ...secrets.production }
      for (const environment of ['preview', 'development', 'ci'] as const)
        values[environment] = { ...values[environment], ...secrets.preview }
    }
    return values
  }

  /**
   * Runs the project's migrate command against production's database before a production deploy, in the repository's
   * checkout of the production branch at the commit the platform will build. Nothing to migrate is not a failure.
   */
  async migrateProduction(projectId: string, root: string, branch: string, commit?: string | null): Promise<void> {
    const argv = this.host.stack(projectId).migrate
    const binding = this.bindings(projectId).find((entry) => entry.kind === 'database')
    if (!argv || !binding) return
    const secrets = await this.secrets(projectId, binding.kind).read()
    if (!secrets) throw new Error('This host lost the database’s connection values. Provision it again on this host.')
    if ((await currentBranch(root)) !== branch)
      throw new Error(`Check out ${branch} in the repository so its migrations run before the deploy.`)
    await git(root, ['fetch', '--quiet', 'origin', branch])
    const [local, remote] = await Promise.all([
      git(root, ['rev-parse', 'HEAD']),
      git(root, ['rev-parse', `origin/${branch}`]),
    ])
    if (local.trim() !== remote.trim())
      throw new Error(`Push or pull ${branch} first, so the migrations that run match what deploys.`)
    // A held build is made live only with the migrations of its own commit; a newer push has its own build.
    if (commit && local.trim().toLowerCase() !== commit.toLowerCase())
      throw new Error(`The checkout of ${branch} is not at ${commit.slice(0, 7)}, the commit this build is from.`)
    const result = await this.migrate(argv, root, secrets.production)
    if (!result.ok) {
      const output = tail(result.output, OUTPUT_LINES)
      throw new MigrationError(
        `The migration (${commandLine(argv)}) failed, so nothing was deployed.\n${output}`,
        output,
      )
    }
  }
}
