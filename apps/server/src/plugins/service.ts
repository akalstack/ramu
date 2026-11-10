// Installed plugins on this host. A plugin is read into a review first, and nothing is saved until the person confirms
// it; then its parts go where each kind already lives (Installed skills, Shared MCP servers, Custom agents, Rules), each
// tagged with the plugin so Remove takes them all out together. Credentials stay in the host's credential store and reach
// only the plugin's own MCP servers, CLI and data sources.
import { randomUUID } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, realpathSync, rmSync, watch, type FSWatcher } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { AGENT_PROVIDERS } from '@ramu/shared/providers/providers'
import type { CustomAgent } from '@ramu/shared/customAgents'
import type { SharedMcpConnection } from '@ramu/shared/mcp'
import type { AppPreferences, ManagedSkill } from '@ramu/shared/types'
import type { Rule, RuleInput } from '@ramu/shared/types/rules'
import { newerVersion } from '@ramu/shared/version'
import {
  CLAUDE_PLUGIN_INDEX,
  DEFAULT_PLUGIN_INDEX,
  checkQuery,
  dataSourceRows,
  fillBody,
  fillTemplate,
  readMarketplace,
  readPath,
  resolveIndexSource,
  type IndexEntry,
  type InstalledPlugin,
  type PluginContents,
  type PluginCredential,
  type PluginIndexInfo,
  type PluginListing,
  type PluginMcpServer,
  type PluginReview,
  type PluginScope,
  type PluginSourceInfo,
  type PluginUpdate,
  type RamuExtension,
} from '@ramu/shared/plugins'
import { RAMU_EXTENSION, UNUSED_PART_NAMES } from '@ramu/shared/plugins'
import { HostCredentialStore } from '../credentials/store'
import { skillMetadata } from '../memory/skillFiles'
import { SavedCredential } from '../workspace/forge/savedCredential'
import { platformCli } from '../workspace/deploy/signIn'
import { gh } from '../workspace/forge/github'
import { git } from '../workspace/git'
import type { AbilityMcpTool } from '@ramu/shared/providers/abilities'
import { mapPluginAbilities } from './abilities'
import { pluginChanges, readPluginFolder, type PluginFingerprint, type PluginFolder } from './folder'
import { fetchGitSource, latestCommit, signerName, signingKey, verifyCommit } from './source'

const STATE_KEY = 'plugins:v1'
const STAGE_MS = 30 * 60_000
const UPDATE_EVERY_MS = 24 * 60 * 60_000
const ROOT_VARIABLES = /\$\{(?:CLAUDE_PLUGIN_ROOT|PLUGIN_ROOT|CODEX_PLUGIN_ROOT)\}/g

/** The value saved for one credential slot. `fields` holds the slot's extra values (an address, a region). */
export interface PluginSecret {
  token: string
  fields: Record<string, string>
  account: string
  refreshToken?: string
  expiresAt?: number
  clientId?: string
  sandbox?: boolean
}

interface PluginRecord {
  id: string
  name: string
  contents: PluginContents
  source: PluginSourceInfo
  scope: PluginScope
  installedAt: number
  updatedAt: number
  enabled: boolean
  includeScripts: boolean
  fingerprint: PluginFingerprint
  extension: RamuExtension
  mcpServers: Record<string, PluginMcpServer>
  parts: { skills: string[]; mcp: Record<string, string>; agents: string[]; rule: string | null }
  /** The installed copy's folder; for a Development plugin, the person's own folder. */
  root: string
  ref: string | null
  signingKey: string | null
  byRamu: boolean
  update: PluginUpdate | null
  credentials: Record<
    string,
    {
      account: string | null
      failed: string | null
      /** Values kept for single identities, by identity id, beside the one for every identity. */
      identities?: Record<string, string>
    }
  >
}

interface State {
  plugins: PluginRecord[]
  indexes: { url: string; name: string }[]
}

interface Staged {
  review: PluginReview
  folder: PluginFolder
  cleanup: () => Promise<void>
  expires: number
  signingKey: string | null
  ref: string | null
}

export interface PluginHost {
  getState<T>(key: string, fallback: T): T
  setState(key: string, value: unknown): void
  /** Where installed copies and clones are kept. */
  dir: string
  ramuVersion: string
  skills: { list(): ManagedSkill[]; write(skill: ManagedSkill): void; remove(id: string): void }
  mcp: {
    connections(): SharedMcpConnection[]
    save(input: Omit<SharedMcpConnection, 'id' | 'hostId' | 'revision'>, id?: string): SharedMcpConnection
    remove(id: string): Promise<void> | void
    setSecret(id: string, kind: 'header' | 'env', name: string, value: string): Promise<void>
    /** The connection's account for one identity, made on first use. */
    splitFor?(id: string, identityId: string): SharedMcpConnection
  }
  /** The identity a project acts as once there are two or more, for credentials split per identity. */
  identityOf?(projectId: string | null): string | null
  agents: {
    list(): CustomAgent[]
    save(input: Omit<CustomAgent, 'id' | 'updatedAt'> & { id?: string }): CustomAgent
    remove(id: string): void
  }
  rules: { save(input: RuleInput): Rule; remove(id: string): void }
  projects(): { id: string }[]
  /** Whether a plugin may reach a project under that project's identity; every plugin is for every identity by default. */
  identityAllows?(pluginId: string, projectId: string | null): boolean
  /** App preferences, for pointing Auto at a plugin's ability tools. */
  preferences?: { load(): AppPreferences; save(preferences: AppPreferences): void }
  changed(): void
  credentials?: HostCredentialStore
  fetch?: typeof fetch
  /** The Akalstack key the built-in index's commits are signed with. */
  indexKey?: string
}

/**
 * The command's folder with its links followed, keeping the command's own name: version managers such as fnm put a
 * per-shell folder first on PATH that is gone after a restart, while the folder it points to stays.
 */
function lastingPath(executable: string) {
  try {
    return join(realpathSync(dirname(executable)), basename(executable))
  } catch {
    return executable
  }
}

/** One index as last read: its entries, or the error that stopped the read (keeping the entries from before). */
interface IndexListing {
  at: number
  entries: IndexEntry[]
  name: string
  error: string | null
  commit: string | null
  skipped?: number
  pluginRoot?: string
}

/** Whether installing gives agents anything: a plugin of only hooks or language servers would add nothing here. */
const usable = (contents: PluginContents) =>
  contents.skills.length > 0 ||
  contents.credentials.length > 0 ||
  contents.mcpServers.length > 0 ||
  contents.agents.length > 0 ||
  !!contents.rule ||
  !!contents.cli ||
  contents.abilities.length > 0 ||
  contents.dataSources.length > 0

/** An MCP address without its query, so a plugin's `?utm_source=plugin` still matches the same server. */
function serverAddress(url: string) {
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname.replace(/\/$/, '')}`
  } catch {
    return url
  }
}

export class PluginService {
  private staged = new Map<string, Staged>()
  private watchers = new Map<string, FSWatcher>()
  private listings = new Map<string, IndexListing>()
  private readonly credentials: HostCredentialStore
  private readonly fetcher: typeof fetch

  constructor(private readonly host: PluginHost) {
    this.credentials = host.credentials ?? new HostCredentialStore()
    this.fetcher = host.fetch ?? fetch
    mkdirSync(host.dir, { recursive: true, mode: 0o700 })
  }

  private state(): State {
    const saved = this.host.getState<Partial<State> | null>(STATE_KEY, null)
    return { plugins: saved?.plugins ?? [], indexes: saved?.indexes ?? [] }
  }

  private save(state: State) {
    this.host.setState(STATE_KEY, state)
    this.host.changed()
  }

  private record(id: string): PluginRecord {
    const found = this.state().plugins.find((plugin) => plugin.id === id)
    if (!found) throw new Error('That plugin is not installed.')
    return found
  }

  list(): InstalledPlugin[] {
    return this.state().plugins.map((plugin) => this.view(plugin))
  }

  private view(plugin: PluginRecord): InstalledPlugin {
    return {
      id: plugin.id,
      name: plugin.name,
      contents: plugin.contents,
      source: plugin.source,
      scope: plugin.scope,
      installedAt: plugin.installedAt,
      updatedAt: plugin.updatedAt,
      enabled: plugin.enabled,
      mcpConnections: Object.entries(plugin.parts.mcp).map(([name, id]) => ({ name, id })),
      credentials: plugin.extension.credentials.map((slot) => {
        const saved = plugin.credentials[slot.id]
        return {
          id: slot.id,
          label: slot.label,
          state: saved?.failed
            ? 'failed'
            : saved?.account !== undefined && saved.account !== null
              ? 'saved'
              : 'missing',
          account: saved?.account ?? null,
          identities: Object.keys(saved?.identities ?? {}),
        }
      }),
      update: plugin.update,
      byRamu: plugin.byRamu,
    }
  }

  // ---- Review ----

  /**
   * Reads a plugin into a review: a Git URL (`ref` a branch, tag or commit), a folder on this host, or a listing in an
   * index. Nothing is saved; the review expires after 30 minutes.
   */
  async stage(input: {
    source: string
    ref?: string
    path?: string
    index?: string
    replaces?: string
  }): Promise<PluginReview> {
    this.sweep()
    if (this.staged.size >= 20) throw new Error('Too many plugin reviews are open. Finish or cancel one first.')
    const listing = input.index ? await this.listing(input.index, input.source) : null
    const location = listing?.url ?? input.source
    const path = listing?.path ?? input.path ?? ''
    const ref = listing?.sha ?? listing?.ref ?? input.ref
    const folder = !listing && (location.startsWith('/') || location.startsWith('~')) && !location.endsWith('.git')
    let dir: string
    let commit: string | null = null
    let cleanup = async () => {}
    let signedBy: string | null = null
    if (folder) {
      dir = resolve(location.replace(/^~(?=\/|$)/, process.env.HOME ?? '~'))
    } else {
      const fetched = await fetchGitSource(join(this.host.dir, 'staging'), location, ref)
      dir = fetched.dir
      commit = fetched.commit
      cleanup = fetched.cleanup
      if (listing?.signingKey) {
        const key = signingKey(listing.signingKey)
        if (!(await verifyCommit(fetched.dir, fetched.commit, key))) {
          await cleanup()
          throw new Error(
            `${listing.entry.name}'s commit ${fetched.commit.slice(0, 7)} is not signed by its author's key.`,
          )
        }
        signedBy = signerName(key, listing.entry.author?.name ?? listing.entry.name)
      }
    }
    let read: PluginFolder
    try {
      read = readPluginFolder(path ? join(dir, path) : dir)
    } catch (error) {
      await cleanup()
      throw error
    }
    const old = input.replaces
      ? this.record(input.replaces)
      : this.state().plugins.find((plugin) => plugin.name === read.manifest.name)
    if (old && !input.replaces) throw new Error(`${read.manifest.name} is already installed. Use Update on its card.`)
    if (old && old.name !== read.manifest.name) throw new Error('That source is a different plugin.')
    const keyChanged = !!old && (old.signingKey ?? null) !== (listing?.signingKey ?? old.signingKey ?? null)
    const diff = old ? pluginChanges(old.fingerprint, read.fingerprint) : { changes: [], needsApproval: true }
    for (const replaced of this.replacedServers(read.mcpServers))
      diff.changes.push(`Takes over your ${replaced.name} MCP server; turn its tools on again after installing`)
    if (keyChanged) diff.changes.unshift('The author’s signing key changed')
    const requires = read.extension.requires?.ramu
    const blocked =
      requires && newerVersion(requires, this.host.ramuVersion)
        ? `This plugin needs Ramu ${requires} or newer. Update Ramu first.`
        : read.contents.problems.length
          ? `Fix ${read.contents.problems.length === 1 ? 'one problem' : `${read.contents.problems.length} problems`} first.`
          : !usable(read.contents)
            ? `Nothing in this plugin works in Ramu: it only has ${read.contents.unused.map((part) => UNUSED_PART_NAMES[part].toLowerCase()).join(', ') || 'nothing Ramu reads'}.`
            : this.dataSourceClash(read, old?.id)
    const stageId = randomUUID()
    const review: PluginReview = {
      stageId,
      contents: read.contents,
      source: {
        kind: folder ? 'folder' : 'git',
        location: folder ? dir : location,
        path,
        commit,
        index: input.index ?? null,
        signedBy,
      },
      replaces: old?.id ?? null,
      changes: diff.changes,
      needsApproval: diff.needsApproval || keyChanged,
      byRamu: !!listing?.byRamu,
      blocked,
    }
    this.staged.set(stageId, {
      review,
      folder: read,
      cleanup,
      expires: Date.now() + STAGE_MS,
      signingKey: listing?.signingKey ?? old?.signingKey ?? null,
      ref: listing ? (listing.ref ?? null) : (input.ref ?? null),
    })
    return review
  }

  private dataSourceClash(read: PluginFolder, except?: string): string | null {
    const taken = new Map(
      this.state()
        .plugins.filter((plugin) => plugin.id !== except)
        .flatMap((plugin) => plugin.extension.dataSources.map((source) => [source.id, plugin.name] as const)),
    )
    const clash = read.extension.dataSources.find((source) => taken.has(source.id))
    return clash ? `${taken.get(clash.id)} already provides the data source ${clash.id}.` : null
  }

  review(stageId: string): PluginReview {
    return this.stagedFor(stageId).review
  }

  private stagedFor(stageId: string): Staged {
    const staged = this.staged.get(stageId)
    if (!staged || staged.expires < Date.now()) throw new Error('This review expired. Open the plugin again.')
    return staged
  }

  async cancel(stageId: string) {
    const staged = this.staged.get(stageId)
    this.staged.delete(stageId)
    await staged?.cleanup()
  }

  private sweep() {
    for (const [id, staged] of this.staged)
      if (staged.expires < Date.now()) {
        this.staged.delete(id)
        void staged.cleanup()
      }
  }

  // ---- Install ----

  /** Saves every part of a reviewed plugin. Scripts in skills come only with their second approval. */
  async confirm(
    stageId: string,
    options: {
      scope: PluginScope
      includeScripts: boolean
      development?: boolean
      /** A Development plugin the person asked an agent to make: its abilities are offered to Auto at once. */
      offerAbilities?: boolean
    },
  ): Promise<InstalledPlugin> {
    const staged = this.stagedFor(stageId)
    if (staged.review.blocked) throw new Error(staged.review.blocked)
    const scope = options.scope
    if (scope.kind === 'project' && !this.host.projects().some((project) => project.id === scope.projectId))
      throw new Error('Choose a project on this host.')
    const { folder, review } = staged
    const old = review.replaces ? this.record(review.replaces) : null
    const id = old?.id ?? randomUUID()
    const development = !!options.development
    let root = folder.root
    if (!development) {
      root = join(this.host.dir, 'installed', id, review.source.commit ?? String(Date.now()))
      rmSync(root, { recursive: true, force: true })
      mkdirSync(root, { recursive: true, mode: 0o700 })
      cpSync(folder.root, root, { recursive: true, filter: (path) => !/[\\/]\.git(?:[\\/]|$)/.test(path) })
    }
    const now = Date.now()
    const record: PluginRecord = {
      id,
      name: folder.manifest.name,
      contents: folder.contents,
      source: { ...review.source, kind: development ? 'development' : review.source.kind },
      scope: options.scope,
      installedAt: old?.installedAt ?? now,
      updatedAt: now,
      enabled: true,
      includeScripts: options.includeScripts,
      fingerprint: folder.fingerprint,
      extension: folder.extension,
      mcpServers: folder.mcpServers,
      parts: { skills: [], mcp: {}, agents: [], rule: null },
      root,
      ref: staged.ref,
      signingKey: staged.signingKey,
      byRamu: review.byRamu,
      update: null,
      credentials: old?.credentials ?? {},
    }
    try {
      await this.apply(record, folder, old)
    } catch (error) {
      await this.removeParts(record, old)
      if (!development) rmSync(root, { recursive: true, force: true })
      throw error
    }
    const state = this.state()
    this.save({ ...state, plugins: [...state.plugins.filter((plugin) => plugin.id !== id), record] })
    if (old && old.root !== root && old.source.kind !== 'development')
      rmSync(old.root, { recursive: true, force: true })
    this.staged.delete(stageId)
    if (!development) await staged.cleanup()
    if (development) this.watch(record)
    await this.refillSecrets(record)
    // A Development plugin's abilities are not offered to Auto until it is installed normally, unless the person asked
    // for it to be made for this.
    const tools = development && !options.offerAbilities ? [] : this.abilityTools(id)
    const before = old ? Object.values(old.parts.mcp) : []
    this.mapAbilities(
      tools,
      before.filter((connection) => !Object.values(record.parts.mcp).includes(connection)),
    )
    return this.view(record)
  }

  private mapAbilities(tools: ({ ability: string } & AbilityMcpTool)[], removed: string[]) {
    if (this.host.preferences) mapPluginAbilities(this.host.preferences, tools, removed)
  }

  private projectIdOf(scope: PluginScope) {
    return scope.kind === 'project' ? scope.projectId : null
  }

  /** Writes the plugin's parts, replacing the previous version's in place so their ids (and approvals) carry over. */
  private async apply(record: PluginRecord, folder: PluginFolder, old: PluginRecord | null) {
    const projectId = this.projectIdOf(record.scope)
    const existingSkills = new Map(
      this.host.skills
        .list()
        .filter((skill) => old?.parts.skills.includes(skill.id))
        .map((skill) => [skill.name, skill]),
    )
    for (const skill of folder.skills) {
      const clash = this.host.skills
        .list()
        .find(
          (entry) =>
            entry.name === skill.name && entry.projectId === projectId && !old?.parts.skills.includes(entry.id),
        )
      if (clash) throw new Error(`A skill named ${skill.name} already exists. Remove or rename it first.`)
      const previous = existingSkills.get(skill.name)
      const markdown = Buffer.from(skill.files['SKILL.md']!, 'base64').toString('utf8')
      const now = Date.now()
      const managed: ManagedSkill = {
        id: previous?.id ?? randomUUID(),
        projectId,
        name: skill.name,
        description: skill.description,
        content: skillMetadata(markdown).content,
        pinned: true,
        status: previous?.status ?? 'active',
        revision: (previous?.revision ?? 0) + 1,
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
        lastUsedAt: previous?.lastUsedAt ?? null,
        useCount: previous?.useCount ?? 0,
        sourceSessionId: '',
        sourceSeq: 0,
        changedBy: 'user',
        installation: {
          source: `plugin:${record.name}`,
          skill: skill.name,
          cliVersion: 'plugin',
          markdown,
          files: Object.fromEntries(
            Object.entries(skill.files).filter(([path]) => record.includeScripts || !skill.scripts.includes(path)),
          ),
        },
      }
      this.host.skills.write(managed)
      record.parts.skills.push(managed.id)
    }
    for (const stale of existingSkills.values())
      if (!folder.skills.some((skill) => skill.name === stale.name)) this.host.skills.remove(stale.id)

    const scope = projectId ? { hostWide: false, projectIds: [projectId] } : { hostWide: true, projectIds: [] }
    // A server the person added by hand at the same address becomes the plugin's, instead of a second copy beside it.
    for (const replaced of this.replacedServers(folder.mcpServers)) await this.host.mcp.remove(replaced.id)
    const taken = new Set(
      this.host.mcp
        .connections()
        .filter((connection) => !Object.values(old?.parts.mcp ?? {}).includes(connection.id))
        .map((connection) => connection.name),
    )
    for (const [name, server] of Object.entries(folder.mcpServers)) {
      const shown = taken.has(name) ? `${record.name}-${name}` : name
      if (taken.has(shown)) throw new Error(`An MCP server named ${shown} already exists.`)
      const connection = this.host.mcp.save(
        {
          name: shown,
          serviceAccountId: `plugin-${record.id}`,
          enabled: true,
          scope,
          providers: [...AGENT_PROVIDERS],
          transport: this.transport(server, record.root),
        },
        old?.parts.mcp[name],
      )
      record.parts.mcp[name] = connection.id
    }
    for (const [name, connectionId] of Object.entries(old?.parts.mcp ?? {}))
      if (!folder.mcpServers[name]) await this.host.mcp.remove(connectionId)

    const previousAgents = this.host.agents.list().filter((agent) => old?.parts.agents.includes(agent.id))
    for (const agent of folder.agents) {
      const previous = previousAgents.find((entry) => entry.name === agent.name)
      const saved = this.host.agents.save({
        ...(previous ? { id: previous.id } : {}),
        name: agent.name,
        description: agent.description,
        instructions: agent.instructions,
        readOnly: agent.readOnly,
        model: null,
      })
      record.parts.agents.push(saved.id)
    }
    for (const stale of previousAgents) if (!record.parts.agents.includes(stale.id)) this.host.agents.remove(stale.id)

    if (old?.parts.rule) this.host.rules.remove(old.parts.rule)
    if (folder.rule?.trim()) {
      const input: RuleInput = {
        name: `${record.name} plugin`,
        body: folder.rule.trim().slice(0, 8000),
        projectId,
        providers: [],
        activation: 'always',
        paths: [],
        enabled: true,
      }
      let rule: Rule
      try {
        rule = this.host.rules.save(input)
      } catch {
        // The always-on budget is full: keep it for the person to apply.
        rule = this.host.rules.save({ ...input, activation: 'manual' })
      }
      record.parts.rule = rule.id
    }
  }

  private transport(server: PluginMcpServer, root: string): SharedMcpConnection['transport'] {
    const fill = (value: string) => value.replace(ROOT_VARIABLES, root)
    if ('url' in server) return { type: 'http', url: fill(server.url), headerSecretRefs: {} }
    const command = fill(server.command)
    const found = command.startsWith('/') ? command : platformCli(command)
    if (!found) throw new Error(`${server.command} is not installed on this host. Install it, then try again.`)
    return {
      type: 'stdio',
      command: lastingPath(found),
      args: server.args.map(fill),
      cwd: server.cwd ? resolve(root, fill(server.cwd)) : root,
      envSecretRefs: {},
    }
  }

  /**
   * Puts the plugin's environment and headers on its MCP servers: plain values from `.mcp.json`, `${VAR}` filled from
   * the saved credentials, and every slot's value under its own variable. A server whose credential is missing waits.
   */
  private async refillSecrets(record: PluginRecord, identity: string | null = null) {
    const values: Record<string, string> = {}
    for (const slot of record.extension.credentials) {
      const secret = await this.secretFor(record.id, slot.id, identity).catch(() => null)
      if (!secret) continue
      values[slot.env] = secret.token
      for (const field of slot.fields) if (secret.fields[field.id]) values[field.env] = secret.fields[field.id]!
    }
    const fill = (value: string) =>
      value
        .replace(ROOT_VARIABLES, record.root)
        .replace(/\$\{([A-Z][A-Z0-9_]*)\}/g, (whole, name: string) => values[name] ?? whole)
    for (const [name, server] of Object.entries(record.mcpServers)) {
      const base = record.parts.mcp[name]
      if (!base) continue
      // An identity's own values go to that identity's account on the server, which its projects use instead.
      const connectionId = identity ? this.host.mcp.splitFor?.(base, identity).id : base
      if (!connectionId) continue
      const entries =
        'url' in server
          ? Object.entries(server.headers).map(([key, value]) => ['header', key, fill(value)] as const)
          : [
              ...Object.entries(values).map(([key, value]) => ['env', key, value] as const),
              ...Object.entries(server.env).map(([key, value]) => ['env', key, fill(value)] as const),
            ]
      for (const [kind, key, value] of entries)
        if (!/\$\{[A-Z]/.test(value)) await this.host.mcp.setSecret(connectionId, kind, key, value)
    }
  }

  // ---- Credentials ----

  private saved(pluginId: string, slotId: string, identity: string | null = null) {
    const suffix = identity ? `@${identity}` : ''
    return new SavedCredential<PluginSecret>(
      {
        key: `plugin-credential:${pluginId}:${slotId}${suffix}`,
        connectionId: `plugin-${pluginId}-${slotId}${suffix}`,
        shown: 'account',
      },
      (key, fallback) => this.host.getState(key, fallback),
      (key, value) => this.host.setState(key, value),
      this.credentials,
    )
  }

  private slot(record: PluginRecord, slotId: string): PluginCredential {
    const slot = record.extension.credentials.find((entry) => entry.id === slotId)
    if (!slot) throw new Error('That plugin has no such credential.')
    return slot
  }

  /** The saved value for a slot of the installed plugin named `name`, for a Ramu feature built on that service. */
  async credentialOf(name: string, slotId: string): Promise<PluginSecret | null> {
    const plugin = this.state().plugins.find((entry) => entry.name === name && entry.enabled)
    return plugin && plugin.extension.credentials.some((slot) => slot.id === slotId)
      ? this.secret(plugin.id, slotId)
      : null
  }

  /** Whether a slot of the installed plugin named `name` has a value saved, without reading it. */
  hasCredential(name: string, slotId: string): boolean {
    const plugin = this.state().plugins.find((entry) => entry.name === name && entry.enabled)
    return !!plugin?.credentials[slotId]?.account
  }

  /**
   * The value a project uses: its identity's own when the slot was split for it, otherwise the one for every identity.
   * An identity is never given another identity's value.
   */
  async secret(pluginId: string, slotId: string, projectId?: string | null): Promise<PluginSecret | null> {
    const identity = projectId === undefined ? null : (this.host.identityOf?.(projectId) ?? null)
    const own = identity && this.record(pluginId).credentials[slotId]?.identities?.[identity] ? identity : null
    return this.secretFor(pluginId, slotId, own)
  }

  /** The saved value for a slot (one identity's, or the shared one), renewing a sign-in that is about to expire. */
  private async secretFor(pluginId: string, slotId: string, identity: string | null): Promise<PluginSecret | null> {
    const record = this.record(pluginId)
    const slot = this.slot(record, slotId)
    const saved = this.saved(pluginId, slotId, identity)
    const value = await saved.read()
    if (!value) return null
    if (slot.kind === 'sign-in' && value.refreshToken && value.expiresAt && value.expiresAt - Date.now() < 5 * 60_000) {
      const renewed = await this.renew(slot, value)
      await saved.save(renewed)
      return renewed
    }
    return value
  }

  /** Checks a pasted value with the slot's check request, then keeps it; a failed check keeps nothing. */
  async setCredential(
    pluginId: string,
    slotId: string,
    input: { token: string; fields: Record<string, string> },
    /** Keep it for one identity, splitting the slot: that identity's projects use it, the others the shared one. */
    identity: string | null = null,
  ) {
    const record = this.record(pluginId)
    const slot = this.slot(record, slotId)
    if (slot.kind !== 'token') throw new Error('This credential is a sign-in. Use Sign in.')
    const token = input.token.trim()
    if (!token || token.length > 16_000) throw new Error('Paste the token.')
    if (slot.pattern && !new RegExp(slot.pattern).test(token))
      throw new Error(`That does not look like a ${slot.label}.`)
    const fields = this.checkFields(slot, input.fields)
    const account = await this.check(slot, { token, fields })
    await this.saved(pluginId, slotId, identity).save({ token, fields, account })
    const current = this.record(pluginId).credentials[slotId]
    this.mark(
      pluginId,
      slotId,
      identity
        ? {
            account: current?.account ?? null,
            failed: current?.failed ?? null,
            identities: { ...(current?.identities ?? {}), [identity]: account },
          }
        : { account, failed: null, ...(current?.identities ? { identities: current.identities } : {}) },
    )
    await this.refillSecrets(this.record(pluginId), identity)
    return this.view(this.record(pluginId))
  }

  private checkFields(slot: PluginCredential, input: Record<string, string>): Record<string, string> {
    const fields: Record<string, string> = {}
    for (const field of slot.fields) {
      const value = (input[field.id] ?? field.default ?? '').trim()
      if (!value) continue
      if (value.length > 2000) throw new Error(`${field.label} is too long.`)
      if (field.values && !field.values.includes(value)) throw new Error(`Choose ${field.label} from the list.`)
      if (field.pattern && !new RegExp(field.pattern).test(value)) throw new Error(`Check ${field.label}.`)
      if (field.kind === 'url') {
        let url: URL
        try {
          url = new URL(value)
        } catch {
          throw new Error(`${field.label} must be an address.`)
        }
        if (url.protocol !== 'https:') throw new Error(`${field.label} must be an https address.`)
        fields[field.id] = url.origin
        continue
      }
      fields[field.id] = value
    }
    return fields
  }

  /** Runs the slot's check, returning who the value belongs to; with no check, the slot's label. */
  private async check(
    slot: PluginCredential,
    values: { token: string; fields: Record<string, string> },
  ): Promise<string> {
    if (!slot.check) return slot.label
    const response = await this.request(slot, slot.check.request, values, {})
    const identity = slot.check.identity ? readPath(response, slot.check.identity) : null
    return typeof identity === 'string' && identity ? identity.slice(0, 200) : slot.label
  }

  private mark(pluginId: string, slotId: string, value: PluginRecord['credentials'][string]) {
    const state = this.state()
    this.save({
      ...state,
      plugins: state.plugins.map((plugin) =>
        plugin.id === pluginId ? { ...plugin, credentials: { ...plugin.credentials, [slotId]: value } } : plugin,
      ),
    })
  }

  async removeCredential(pluginId: string, slotId: string, identity: string | null = null) {
    const record = this.record(pluginId)
    this.slot(record, slotId)
    if (identity) {
      await this.saved(pluginId, slotId, identity).remove()
      const current = record.credentials[slotId]
      const { [identity]: _gone, ...others } = current?.identities ?? {}
      this.mark(pluginId, slotId, {
        account: current?.account ?? null,
        failed: current?.failed ?? null,
        identities: others,
      })
      return this.view(this.record(pluginId))
    }
    await this.saved(pluginId, slotId).remove()
    const { [slotId]: removed, ...rest } = record.credentials
    // Values kept for single identities stay; only the shared one goes.
    if (removed?.identities && Object.keys(removed.identities).length)
      rest[slotId] = { account: null, failed: null, identities: removed.identities }
    const state = this.state()
    this.save({
      ...state,
      plugins: state.plugins.map((plugin) => (plugin.id === pluginId ? { ...plugin, credentials: rest } : plugin)),
    })
    return this.view(this.record(pluginId))
  }

  /**
   * One HTTPS request with a slot's value, to the origin the slot or manifest names, bounded in size and time. The
   * value is sent only in the headers or body the template asks for, never logged, and replaced in any error text.
   */
  async request(
    slot: PluginCredential,
    template: { method: 'GET' | 'POST'; url: string; headers: Record<string, string>; body?: unknown },
    values: { token: string; fields: Record<string, string> },
    query: Record<string, unknown>,
  ): Promise<unknown> {
    const filled = { token: values.token, fields: values.fields, query }
    // The origin is fixed in the template or comes from a url field; every value after it is encoded.
    const lead = /^\{field\.([a-z][a-z0-9_-]*)\}/.exec(template.url)
    const rest = lead ? template.url.slice(lead[0].length) : template.url
    const split = rest.indexOf('?')
    const path = split < 0 ? rest : rest.slice(0, split)
    const search = split < 0 ? '' : rest.slice(split + 1)
    const origin = lead ? (values.fields[lead[1]!] ?? '') : ''
    const url = new URL(`${origin}${fillTemplate(path, filled, encodeURIComponent)}`)
    for (const pair of search.split('&').filter(Boolean)) {
      const at = pair.indexOf('=')
      const key = decodeURIComponent(at < 0 ? pair : pair.slice(0, at))
      url.searchParams.set(key, at < 0 ? '' : fillTemplate(decodeURIComponent(pair.slice(at + 1)), filled))
    }
    const allowed = new Set<string>()
    for (const field of slot.fields)
      if (field.kind === 'url' && values.fields[field.id]) allowed.add(new URL(values.fields[field.id]!).origin)
    if (slot.signIn?.instanceField && values.fields.instance) allowed.add(new URL(values.fields.instance).origin)
    if (!lead) allowed.add(new URL(template.url.replace(/\{[^}]*\}/g, 'x')).origin)
    if (url.protocol !== 'https:' || !allowed.has(url.origin))
      throw new Error(`${slot.label} may only call the address it names.`)
    const headers: Record<string, string> = { Accept: 'application/json' }
    // With no headers named, the value goes as a bearer token, the way most APIs take it.
    const named = Object.keys(template.headers).length ? template.headers : { Authorization: 'Bearer {token}' }
    for (const [key, value] of Object.entries(named)) headers[key] = fillTemplate(value, filled)
    let body: string | undefined
    if (template.method === 'POST') {
      body = JSON.stringify(fillBody(template.body ?? {}, filled))
      headers['Content-Type'] = 'application/json'
    }
    const scrub = (text: string) => (values.token ? text.split(values.token).join('[token]') : text)
    let response: Response
    try {
      response = await this.fetcher(url, {
        method: template.method,
        headers,
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
      })
    } catch (error) {
      // The cause can carry the request, credential included, so only the scrubbed message travels.
      // eslint-disable-next-line preserve-caught-error
      throw new Error(`Could not reach ${url.host}: ${scrub((error as Error).message).slice(0, 200)}`)
    }
    const text = await readBounded(response, 8 * 1024 * 1024)
    if (!response.ok)
      throw new Error(
        response.status === 401 || response.status === 403
          ? `${slot.label} was refused (${response.status}). Check it in Customize → Plugins.`
          : `${url.host} answered ${response.status}: ${scrub(text).slice(0, 200)}`,
      )
    try {
      return JSON.parse(text) as unknown
    } catch {
      throw new Error(`${url.host} did not answer with JSON.`)
    }
  }

  // ---- Sign-in ----

  /** The authorize URL for a sign-in slot, with PKCE; `complete` exchanges the code the loopback callback received. */
  async startSignIn(
    pluginId: string,
    slotId: string,
    input: { clientId: string; sandbox: boolean; redirectUri: string },
  ) {
    const record = this.record(pluginId)
    const slot = this.slot(record, slotId)
    if (slot.kind !== 'sign-in' || !slot.signIn) throw new Error('This credential is a token. Paste it instead.')
    const clientId = input.clientId.trim()
    if (!/^[\w.~-]{1,500}$/.test(clientId)) throw new Error('Paste the client id.')
    const { createHash, randomBytes } = await import('node:crypto')
    const verifier = randomBytes(32).toString('base64url')
    const state = randomBytes(16).toString('base64url')
    const endpoints = input.sandbox && slot.signIn.sandbox ? slot.signIn.sandbox : slot.signIn
    const url = new URL(endpoints.authorizeUrl)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('client_id', clientId)
    url.searchParams.set('redirect_uri', input.redirectUri)
    url.searchParams.set('code_challenge', createHash('sha256').update(verifier).digest('base64url'))
    url.searchParams.set('code_challenge_method', 'S256')
    url.searchParams.set('state', state)
    if (slot.signIn.scopes.length) url.searchParams.set('scope', slot.signIn.scopes.join(' '))
    this.signIns.set(state, {
      pluginId,
      slotId,
      verifier,
      clientId,
      sandbox: input.sandbox,
      redirectUri: input.redirectUri,
      expires: Date.now() + 10 * 60_000,
    })
    return { url: url.toString(), state }
  }

  private signIns = new Map<
    string,
    {
      pluginId: string
      slotId: string
      verifier: string
      clientId: string
      sandbox: boolean
      redirectUri: string
      expires: number
    }
  >()

  async completeSignIn(state: string, code: string) {
    const pending = this.signIns.get(state)
    this.signIns.delete(state)
    if (!pending || pending.expires < Date.now()) throw new Error('This sign-in expired. Start it again.')
    const record = this.record(pending.pluginId)
    const slot = this.slot(record, pending.slotId)
    const endpoints = pending.sandbox && slot.signIn!.sandbox ? slot.signIn!.sandbox : slot.signIn!
    const tokens = await this.tokenCall(endpoints.tokenUrl, {
      grant_type: 'authorization_code',
      code,
      client_id: pending.clientId,
      redirect_uri: pending.redirectUri,
      code_verifier: pending.verifier,
    })
    const value = this.fromTokens(slot, tokens, { clientId: pending.clientId, sandbox: pending.sandbox })
    value.account = await this.check(slot, value).catch(() => slot.label)
    await this.saved(record.id, slot.id).save(value)
    this.mark(record.id, slot.id, { account: value.account, failed: null })
    await this.refillSecrets(this.record(record.id))
    return this.view(this.record(record.id))
  }

  private async tokenCall(url: string, params: Record<string, string>) {
    const response = await this.fetcher(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(params).toString(),
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
    })
    const text = await readBounded(response, 256 * 1024)
    let parsed: Record<string, unknown> = {}
    try {
      parsed = JSON.parse(text) as Record<string, unknown>
    } catch {
      // Reported below.
    }
    if (!response.ok || typeof parsed.access_token !== 'string')
      throw new Error(
        `The sign-in was refused: ${String(parsed.error_description ?? parsed.error ?? response.status).slice(0, 200)}`,
      )
    return parsed
  }

  private fromTokens(
    slot: PluginCredential,
    tokens: Record<string, unknown>,
    context: { clientId: string; sandbox: boolean; previous?: PluginSecret },
  ): PluginSecret {
    const instanceField = slot.signIn?.instanceField
    const instance = instanceField && typeof tokens[instanceField] === 'string' ? String(tokens[instanceField]) : null
    const expiresIn = typeof tokens.expires_in === 'number' ? tokens.expires_in : Number(tokens.expires_in)
    return {
      token: String(tokens.access_token),
      fields: { ...(context.previous?.fields ?? {}), ...(instance ? { instance: new URL(instance).origin } : {}) },
      account: context.previous?.account ?? slot.label,
      refreshToken: typeof tokens.refresh_token === 'string' ? tokens.refresh_token : context.previous?.refreshToken,
      // A token response without a lifetime (Salesforce's) is renewed hourly, the shortest session it allows.
      expiresAt: Date.now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn * 1000 : 60 * 60_000),
      clientId: context.clientId,
      sandbox: context.sandbox,
    }
  }

  private async renew(slot: PluginCredential, value: PluginSecret): Promise<PluginSecret> {
    const endpoints = value.sandbox && slot.signIn!.sandbox ? slot.signIn!.sandbox : slot.signIn!
    const tokens = await this.tokenCall(endpoints.tokenUrl, {
      grant_type: 'refresh_token',
      refresh_token: value.refreshToken!,
      client_id: value.clientId ?? '',
    })
    return this.fromTokens(slot, tokens, { clientId: value.clientId ?? '', sandbox: !!value.sandbox, previous: value })
  }

  // ---- Updates and removal ----

  /** Checks each Git plugin's source for a newer commit, at most once a day per plugin unless forced. */
  async checkUpdates(force = false) {
    for (const plugin of this.state().plugins) {
      if (plugin.source.kind !== 'git') continue
      if (!force && plugin.update && Date.now() - plugin.update.checkedAt < UPDATE_EVERY_MS) continue
      try {
        const listing = plugin.source.index
          ? await this.listing(plugin.source.index, plugin.name).catch(() => null)
          : null
        const commit =
          listing?.sha ?? (await latestCommit(listing?.url ?? plugin.source.location, plugin.ref ?? undefined))
        if (commit === plugin.source.commit) {
          this.setUpdate(plugin.id, null)
          continue
        }
        const review = await this.stage({
          source: plugin.source.index ? plugin.name : plugin.source.location,
          index: plugin.source.index ?? undefined,
          ref: commit,
          path: plugin.source.path,
          replaces: plugin.id,
        })
        this.setUpdate(plugin.id, {
          commit,
          checkedAt: Date.now(),
          changes: review.changes,
          needsApproval: review.needsApproval,
        })
        await this.cancel(review.stageId)
      } catch {
        // A source that cannot be reached today is checked again tomorrow.
      }
    }
  }

  private setUpdate(id: string, update: PluginUpdate | null) {
    const state = this.state()
    this.save({ ...state, plugins: state.plugins.map((plugin) => (plugin.id === id ? { ...plugin, update } : plugin)) })
  }

  /** A review of the update the daily check found: the same review as an install, naming what changed. */
  updateReview(id: string) {
    const plugin = this.record(id)
    if (plugin.source.kind !== 'git') throw new Error('Only plugins installed from Git update.')
    return this.stage({
      source: plugin.source.index ? plugin.name : plugin.source.location,
      index: plugin.source.index ?? undefined,
      ref: plugin.update?.commit ?? plugin.ref ?? undefined,
      path: plugin.source.path,
      replaces: plugin.id,
    })
  }

  private async removeParts(record: PluginRecord, keep: PluginRecord | null) {
    const kept = (list: string[], value: string) => keep && list.includes(value)
    for (const id of record.parts.skills) if (!kept(keep?.parts.skills ?? [], id)) this.host.skills.remove(id)
    for (const id of Object.values(record.parts.mcp))
      if (!kept(Object.values(keep?.parts.mcp ?? {}), id))
        await Promise.resolve(this.host.mcp.remove(id)).catch(() => {})
    for (const id of record.parts.agents) if (!kept(keep?.parts.agents ?? [], id)) this.host.agents.remove(id)
    if (record.parts.rule && record.parts.rule !== keep?.parts.rule) this.host.rules.remove(record.parts.rule)
  }

  /** Takes out every skill, server, agent, rule and credential the plugin added. */
  async remove(id: string) {
    const record = this.record(id)
    this.watchers.get(id)?.close()
    this.watchers.delete(id)
    await this.removeParts(record, null)
    this.mapAbilities([], Object.values(record.parts.mcp))
    for (const slot of record.extension.credentials)
      for (const identity of [null, ...Object.keys(record.credentials[slot.id]?.identities ?? {})])
        await this.saved(id, slot.id, identity)
          .remove()
          .catch(() => {})
    if (record.source.kind !== 'development')
      rmSync(join(this.host.dir, 'installed', id), { recursive: true, force: true })
    const state = this.state()
    this.save({ ...state, plugins: state.plugins.filter((plugin) => plugin.id !== id) })
  }

  setEnabled(id: string, enabled: boolean) {
    const record = this.record(id)
    for (const connectionId of Object.values(record.parts.mcp)) {
      const connection = this.host.mcp.connections().find((entry) => entry.id === connectionId)
      if (connection) {
        const { id: _id, hostId: _hostId, revision: _revision, ...definition } = connection
        this.host.mcp.save({ ...definition, enabled }, connectionId)
      }
    }
    for (const skill of this.host.skills.list().filter((entry) => record.parts.skills.includes(entry.id)))
      this.host.skills.write({ ...skill, status: enabled ? 'active' : 'disabled', updatedAt: Date.now() })
    const state = this.state()
    this.save({
      ...state,
      plugins: state.plugins.map((plugin) => (plugin.id === id ? { ...plugin, enabled } : plugin)),
    })
    return this.view(this.record(id))
  }

  // ---- Development ----

  /** Installs a folder as a Development plugin, reloaded whenever one of its files changes. */
  async dev(folder: string): Promise<InstalledPlugin> {
    const root = resolve(folder)
    const existing = this.state().plugins.find((plugin) => plugin.source.kind === 'development' && plugin.root === root)
    const review = await this.stage({ source: root, ...(existing ? { replaces: existing.id } : {}) })
    return this.confirm(review.stageId, {
      scope: existing?.scope ?? { kind: 'all' },
      includeScripts: true,
      development: true,
    })
  }

  /**
   * Shares a Development plugin: its folder becomes a repository on the person's own GitHub account (private, through
   * their `gh` sign-in) and is pushed, so they can open a pull request to an index from there. Later shares push again.
   */
  async share(id: string): Promise<{ url: string }> {
    const record = this.record(id)
    if (record.source.kind !== 'development') throw new Error('Only a Development plugin is shared from its folder.')
    const root = record.root
    if (!existsSync(join(root, '.git'))) await git(root, ['init', '-b', 'main'])
    await git(root, ['add', '--all'])
    if ((await git(root, ['status', '--porcelain'])).trim())
      await git(root, ['commit', '-m', `${record.name} ${record.contents.version ?? ''}`.trim()])
    const remotes = (await git(root, ['remote'])).split('\n').filter(Boolean)
    if (remotes.includes('origin')) await git(root, ['push', '--set-upstream', 'origin', 'HEAD'])
    else await gh(root, ['repo', 'create', record.name, '--private', '--source', '.', '--remote', 'origin', '--push'])
    return { url: (await git(root, ['remote', 'get-url', 'origin'])).trim() }
  }

  /** Watches every Development plugin again after a restart. */
  start() {
    for (const plugin of this.state().plugins) if (plugin.source.kind === 'development') this.watch(plugin)
    this.settleCommands()
    void this.checkUpdates().catch(() => {})
    const timer = setInterval(() => void this.checkUpdates().catch(() => {}), 60 * 60_000)
    timer.unref?.()
  }

  /** Hand-added MCP servers at the same address as one of these, which installing them would duplicate. */
  private replacedServers(servers: Record<string, PluginMcpServer>) {
    const owned = new Set(this.state().plugins.flatMap((plugin) => Object.values(plugin.parts.mcp)))
    const addresses = new Set(
      Object.values(servers).flatMap((server) => ('url' in server ? [serverAddress(server.url)] : [])),
    )
    return this.host.mcp
      .connections()
      .filter(
        (connection) =>
          !owned.has(connection.id) &&
          !connection.split &&
          connection.transport.type === 'http' &&
          addresses.has(serverAddress(connection.transport.url)),
      )
  }

  /** A server saved with a per-shell path while that path still exists gets the lasting one, before it disappears. */
  private settleCommands() {
    const owned = new Set(this.state().plugins.flatMap((plugin) => Object.values(plugin.parts.mcp)))
    for (const connection of this.host.mcp.connections()) {
      if (!owned.has(connection.id) || connection.transport.type !== 'stdio') continue
      const lasting = lastingPath(connection.transport.command)
      if (lasting === connection.transport.command) continue
      const { id, hostId: _hostId, revision: _revision, ...definition } = connection
      this.host.mcp.save({ ...definition, transport: { ...connection.transport, command: lasting } }, id)
    }
  }

  private watch(record: PluginRecord) {
    this.watchers.get(record.id)?.close()
    if (!existsSync(record.root)) return
    let timer: ReturnType<typeof setTimeout> | null = null
    try {
      const watcher = watch(record.root, { recursive: true }, (_event, file) => {
        if (file && /(^|[\\/])(\.git|node_modules)([\\/]|$)/.test(String(file))) return
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => void this.dev(record.root).catch(() => {}), 400)
      })
      watcher.unref?.()
      this.watchers.set(record.id, watcher)
    } catch {
      // Recursive watching is unavailable on this platform; `ramu plugin dev` again reloads it.
    }
  }

  close() {
    for (const watcher of this.watchers.values()) watcher.close()
    this.watchers.clear()
  }

  // ---- What the agent and dashboards use ----

  /** Installed, enabled plugins that apply to a project. */
  forProject(projectId: string | null) {
    return this.state().plugins.filter(
      (plugin) =>
        plugin.enabled &&
        (plugin.scope.kind === 'all' || (plugin.scope.kind === 'project' && plugin.scope.projectId === projectId)) &&
        (this.host.identityAllows?.(plugin.id, projectId) ?? true),
    )
  }

  /**
   * The CLIs of plugins that apply to a project, with the slot that signs each in. A plugin with no credential slot
   * runs a local tool (a game engine) that has nothing to sign in.
   */
  clis(projectId: string | null) {
    return this.forProject(projectId).flatMap((plugin) => {
      const cli = plugin.extension.cli
      const slot = plugin.extension.credentials.find(
        (entry) => entry.id === (cli?.credential ?? plugin.extension.credentials[0]?.id),
      )
      return cli
        ? [
            {
              plugin: plugin.name,
              pluginId: plugin.id,
              development: plugin.source.kind === 'development',
              cli,
              ...(slot ? { slot } : {}),
            },
          ]
        : []
    })
  }

  /** The data source a dashboard names, with its plugin and slot. */
  dataSource(id: string) {
    for (const plugin of this.state().plugins) {
      if (!plugin.enabled) continue
      const source = plugin.extension.dataSources.find((entry) => entry.id === id)
      if (source) return { plugin, source, slot: this.slot(plugin, source.credential) }
    }
    return null
  }

  /**
   * Runs a data source's query with its plugin's saved credential: the fields are checked against what the source
   * declares, the request goes only to the origin it names, and the rows are the columns the table asks for.
   */
  async query(
    id: string,
    input: Record<string, unknown>,
    columns: readonly string[],
    limit: number,
    /** The dashboard's project, whose identity's value of the credential is used when it has one. */
    projectId?: string | null,
  ) {
    const found = this.dataSource(id)
    if (!found) throw new Error(`No installed plugin provides ${id}. Install its plugin in Customize → Plugins.`)
    const checked = checkQuery(found.source.query, input)
    if (!checked.ok) throw new Error(`${found.source.label}: ${checked.error}`)
    const secret = await this.secret(found.plugin.id, found.slot.id, projectId ?? null)
    if (!secret)
      throw new Error(
        `${found.slot.label} for ${found.plugin.name} is not saved on this host. Add it in Customize → Plugins.`,
      )
    const response = await this.request(found.slot, found.source.request, secret, checked.query)
    return dataSourceRows(response, found.source.rows, columns, limit, checked.query)
  }

  dataSources() {
    return this.state().plugins.flatMap((plugin) =>
      plugin.enabled
        ? plugin.extension.dataSources.map((source) => ({ id: source.id, label: source.label, plugin: plugin.name }))
        : [],
    )
  }

  /** Ability mappings of installed plugins, as Shared MCP connection and tool. */
  abilityTools(id: string) {
    const record = this.record(id)
    return Object.entries(record.extension.abilities).flatMap(([ability, target]) => {
      const connectionId = target ? record.parts.mcp[target.server] : undefined
      return connectionId && target
        ? [
            {
              ability,
              connectionId,
              tool: target.tool,
              ...(target.status ? { status: target.status } : {}),
              ...(target.balance ? { balance: target.balance } : {}),
              ...(target.fromImage ? { fromImage: target.fromImage } : {}),
              ...(target.refine ? { refine: target.refine } : {}),
              ...(target.downloads?.length ? { downloads: target.downloads } : {}),
            },
          ]
        : []
    })
  }

  // ---- Indexes ----

  indexes(): PluginIndexInfo[] {
    const all = [
      { url: DEFAULT_PLUGIN_INDEX, name: 'ramu-plugins', builtIn: true },
      { url: CLAUDE_PLUGIN_INDEX, name: 'claude-plugins-official', builtIn: true },
      ...this.state()
        .indexes.filter((entry) => entry.url !== CLAUDE_PLUGIN_INDEX)
        .map((entry) => ({ ...entry, builtIn: false })),
    ]
    return all.map((entry) => {
      const cached = this.listings.get(entry.url)
      return {
        url: entry.url,
        name: cached?.name ?? entry.name,
        builtIn: entry.builtIn,
        checkedAt: cached?.at ?? null,
        error: cached?.error ?? null,
        count: cached?.entries.length ?? 0,
        skipped: cached?.skipped ?? 0,
      }
    })
  }

  async addIndex(url: string) {
    const trimmed = url.trim().replace(/\/$/, '')
    if (this.indexes().some((entry) => entry.url === trimmed)) throw new Error('That index is already listed.')
    const read = await this.readIndex(trimmed, true)
    const state = this.state()
    this.save({ ...state, indexes: [...state.indexes, { url: trimmed, name: read.name }] })
    return this.indexes()
  }

  removeIndex(url: string) {
    if (url === DEFAULT_PLUGIN_INDEX || url === CLAUDE_PLUGIN_INDEX)
      throw new Error('The built-in indexes cannot be removed.')
    const state = this.state()
    this.save({ ...state, indexes: state.indexes.filter((entry) => entry.url !== url) })
    this.listings.delete(url)
    return this.indexes()
  }

  private async readIndex(url: string, force = false): Promise<IndexListing> {
    const cached = this.listings.get(url)
    if (cached && !force && Date.now() - cached.at < 60 * 60_000 && !cached.error) return cached
    let fetched: Awaited<ReturnType<typeof fetchGitSource>> | null = null
    try {
      fetched = await fetchGitSource(join(this.host.dir, 'indexes'), url)
      if (url === DEFAULT_PLUGIN_INDEX && this.host.indexKey) {
        if (!(await verifyCommit(fetched.dir, fetched.commit, signingKey(this.host.indexKey))))
          throw new Error('The Ramu index is not signed by Akalstack’s key. Nothing from it was read.')
      }
      const { readFileSync } = await import('node:fs')
      const file = ['.claude-plugin/marketplace.json', 'marketplace.json']
        .map((path) => join(fetched!.dir, path))
        .find((path) => existsSync(path))
      if (!file) throw new Error('This repository has no .claude-plugin/marketplace.json.')
      const parsed = readMarketplace(JSON.parse(readFileSync(file, 'utf8')))
      const entry = {
        at: Date.now(),
        entries: parsed.plugins,
        name: parsed.name,
        error: null,
        commit: fetched.commit,
        skipped: parsed.skipped.length,
        ...(parsed.pluginRoot ? { pluginRoot: parsed.pluginRoot } : {}),
      }
      this.listings.set(url, entry)
      return entry
    } catch (error) {
      const failed = {
        at: Date.now(),
        entries: cached?.entries ?? [],
        name: cached?.name ?? url,
        error: (error as Error).message.slice(0, 300),
        commit: null,
        ...(cached?.pluginRoot ? { pluginRoot: cached.pluginRoot } : {}),
      }
      this.listings.set(url, failed)
      if (force) throw error
      return failed
    } finally {
      await fetched?.cleanup()
    }
  }

  /** Every listed plugin across indexes, matching `query` in its name, description or keywords. */
  async browse(query = ''): Promise<PluginListing[]> {
    const installed = new Set(this.state().plugins.map((plugin) => plugin.name))
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    const out: PluginListing[] = []
    for (const index of this.indexes()) {
      const read = await this.readIndex(index.url)
      for (const entry of read.entries) {
        const ramu = entry.extensions?.[RAMU_EXTENSION]
        const keywords = [...(entry.keywords ?? []), ...(entry.tags ?? [])]
        const haystack = [entry.name, entry.description ?? '', ...keywords, ...(ramu?.stacks ?? [])]
          .join(' ')
          .toLowerCase()
        if (words.length && !words.every((word) => haystack.includes(word))) continue
        const source = resolveIndexSource(entry.source, { url: index.url })
        out.push({
          index: index.url,
          indexName: read.name,
          name: entry.name,
          description: entry.description ?? '',
          source: source.path ? `${source.url}/${source.path}` : source.url,
          commit: source.sha ?? null,
          byRamu: !!ramu?.byRamu && index.url === DEFAULT_PLUGIN_INDEX,
          signed:
            !!ramu?.signingKey ||
            (index.url === DEFAULT_PLUGIN_INDEX && !!this.host.indexKey && source.url === index.url),
          stacks: ramu?.stacks ?? [],
          keywords,
          category: entry.category ?? null,
          installed: installed.has(entry.name),
          alternatives: [],
        })
      }
    }
    // One card per plugin name: the first index's listing (Ramu's own before Claude's), the others offered on it.
    const byName = new Map<string, PluginListing>()
    for (const listing of out) {
      const first = byName.get(listing.name)
      if (first) first.alternatives.push({ index: listing.index, indexName: listing.indexName, source: listing.source })
      else byName.set(listing.name, listing)
    }
    return [...byName.values()].slice(0, 1000)
  }

  /** One index entry, resolved to the Git URL, folder and pinned commit to fetch. */
  private async listing(indexUrl: string, name: string) {
    const read = await this.readIndex(indexUrl)
    if (read.error && !read.entries.length) throw new Error(read.error)
    const entry = read.entries.find((candidate) => candidate.name === name)
    if (!entry) throw new Error(`${name} is not listed in ${read.name}.`)
    const ramu = entry.extensions?.[RAMU_EXTENSION]
    const source = resolveIndexSource(entry.source, {
      url: indexUrl,
      pluginRoot: read.pluginRoot,
    })
    // A plugin kept inside the index itself is pinned by the index's own signed commit.
    const inIndex = source.url === indexUrl
    const signing = ramu?.signingKey ?? (inIndex && indexUrl === DEFAULT_PLUGIN_INDEX ? this.host.indexKey : undefined)
    if (indexUrl === DEFAULT_PLUGIN_INDEX && !signing)
      throw new Error(`${name} is listed without a signing key. The Ramu index installs signed plugins only.`)
    return {
      entry,
      url: source.url,
      path: source.path,
      ref: source.ref,
      sha: source.sha ?? (inIndex ? (read.commit ?? undefined) : undefined),
      signingKey: signing ?? null,
      byRamu: !!ramu?.byRamu && indexUrl === DEFAULT_PLUGIN_INDEX,
    }
  }
}

async function readBounded(response: Response, limit: number): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      await reader.cancel().catch(() => {})
      throw new Error(`The answer was larger than ${Math.round(limit / 1024 / 1024)} MB.`)
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}
