import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import type { AgentProvider } from '@ramu/shared/types'
import type {
  ProjectMcpServer,
  ProjectSetup,
  ProjectSetupSource,
  ProjectSkill,
  SharedMcpConnection,
} from '@ramu/shared/mcp'
import { AGENT_PROVIDERS } from '@ramu/shared/providers/providers'
import { skillMcpTools, skillMetadata } from '../memory/skillFiles'
import { providerAccountEnv, providerAccountHome } from '../providers/providerBinaries'

const MAX_FILE = 1024 * 1024
const MAX_SKILLS_PER_DIR = 200
type Json = Record<string, unknown>
type Transport = ProjectMcpServer['transport']
/** One server as a file declares it. Env and header values stay on the host; the read model gets names only. */
export interface Declared {
  name: string
  transport: Transport
  env: Record<string, string>
  headers: Record<string, string>
  enabled: boolean
  /** Codex runs relative commands from its own folder; they cannot move to another provider. */
  cwd?: string
  /** When the declaring file last changed (ms), so a running thread can be told its copy is out of date. */
  changedAt?: number
}

const object = (value: unknown): Json | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : null
const strings = (value: unknown) =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
const record = (value: unknown): Record<string, string> =>
  Object.fromEntries(
    Object.entries(object(value) ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )

function readBounded(path: string): string | null {
  const stat = lstatSync(path, { throwIfNoEntry: false })
  if (!stat) return null
  if (!stat.isFile()) throw new Error('Not a regular file.')
  if (stat.size > MAX_FILE) throw new Error('File is larger than 1 MiB.')
  return readFileSync(path, 'utf8')
}

/** JSON with comments and trailing commas, as OpenCode and VS Code-style configs allow. */
/** What each provider last reported that no readable file declares, by provider. Names only, from live threads. */
export const PROVIDER_MANAGED_KEY = 'mcp.providerManaged'
export type ProviderManaged = Partial<Record<AgentProvider, string[]>>

export function parseJsonc(text: string): unknown {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (c === '"') {
      const start = i
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === '\\') i++
      out += text.slice(start, i + 1)
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
      out += '\n'
    } else if (c === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2)
      if (i < 0) throw new Error('Unclosed comment.')
      i++
    } else out += c
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'))
}

/** Claude, Cursor and repository `.mcp.json` entries: `{ command, args, env }` or `{ url, headers }`. */
/** Called for an entry that cannot be used (no URL or command) so the rest of its file still loads. */
type Skip = (name: string, reason: string) => void
const NO_TRANSPORT = 'has neither a url nor a command, so Ramu cannot share it.'

function standardServers(entries: unknown, skip?: Skip): Declared[] {
  return Object.entries(object(entries) ?? {}).flatMap(([name, value]) => {
    const c = object(value)
    if (!c || name === 'ramu') return []
    const transport: Transport | null =
      typeof c.url === 'string'
        ? { type: 'http', url: c.url }
        : typeof c.command === 'string'
          ? { type: 'stdio', command: c.command, args: strings(c.args) }
          : null
    if (!transport) {
      if (!skip) throw new Error(`Server "${name}" has neither a url nor a command.`)
      skip(name, NO_TRANSPORT)
      return []
    }
    return [{ name, transport, env: record(c.env), headers: record(c.headers), enabled: c.disabled !== true }]
  })
}

/** OpenCode's `mcp` map: `{ type: 'local', command: [...], environment }` or `{ type: 'remote', url, headers }`. */
function openCodeServers(entries: unknown, skip?: Skip): Declared[] {
  return Object.entries(object(entries) ?? {}).flatMap(([name, value]) => {
    const c = object(value)
    if (!c || name === 'ramu') return []
    const command = strings(c.command)
    const transport: Transport | null =
      typeof c.url === 'string'
        ? { type: 'http', url: c.url }
        : command.length
          ? { type: 'stdio', command: command[0]!, args: command.slice(1) }
          : null
    if (!transport) {
      if (!skip) throw new Error(`Server "${name}" has neither a url nor a command.`)
      skip(name, NO_TRANSPORT)
      return []
    }
    return [{ name, transport, env: record(c.environment), headers: record(c.headers), enabled: c.enabled !== false }]
  })
}

/**
 * Codex `[mcp_servers.<name>]` tables from config.toml: strings, string arrays, booleans and the `env` /
 * `http_headers` string tables, which is all a server definition uses. Other tables are skipped.
 */
export function codexServers(toml: string, env: NodeJS.ProcessEnv = process.env, skip?: Skip): Declared[] {
  const servers = new Map<string, Json & { env: Record<string, string>; headers: Record<string, string> }>()
  const server = (name: string) => {
    let entry = servers.get(name)
    if (!entry) servers.set(name, (entry = { env: {}, headers: {} }))
    return entry
  }
  const unquote = (part: string): string =>
    part.startsWith('"') ? (JSON.parse(part) as string) : part.startsWith("'") ? part.slice(1, -1) : part
  const tablePath = (header: string) => header.match(/"(?:[^"\\]|\\.)*"|'[^']*'|[^.\s]+/g)?.map(unquote) ?? []
  const STRING = /"(?:[^"\\]|\\.)*"|'[^']*'/g
  const value = (raw: string): unknown => {
    raw = raw.trim()
    if (raw === 'true' || raw === 'false') return raw === 'true'
    if (raw.startsWith('"') || raw.startsWith("'")) return unquote(raw.match(STRING)?.[0] ?? '""')
    if (raw.startsWith('[')) return (raw.match(STRING) ?? []).map(unquote)
    return undefined
  }
  const inlineTable = (raw: string) =>
    Object.fromEntries(
      [...raw.matchAll(/([A-Za-z0-9_.-]+|"(?:[^"\\]|\\.)*")\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')/g)].map((m) => [
        unquote(m[1]!),
        unquote(m[2]!),
      ]),
    )
  let table: string[] = []
  const lines = toml.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim()
    if (!line || line.startsWith('#')) continue
    const header = /^\[\[?\s*(.+?)\s*\]\]?$/.exec(line)
    if (header) {
      table = line.startsWith('[[') ? [] : tablePath(header[1]!)
      continue
    }
    if (table[0] !== 'mcp_servers' || !table[1]) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = unquote(line.slice(0, eq).trim())
    let raw = line.slice(eq + 1).trim()
    // A multi-line array or inline table continues until it closes.
    while (/^[[{]/.test(raw) && !/[\]}]\s*(#.*)?$/.test(raw) && i + 1 < lines.length) raw += ' ' + lines[++i]!.trim()
    const entry = server(table[1])
    if (table.length === 3 && (table[2] === 'env' || table[2] === 'http_headers')) {
      const text = value(raw)
      if (typeof text === 'string') entry[table[2] === 'env' ? 'env' : 'headers'][key] = text
    } else if (table.length === 2) {
      if (key === 'env' || key === 'http_headers')
        Object.assign(entry[key === 'env' ? 'env' : 'headers'], inlineTable(raw))
      else entry[key] = value(raw)
    }
  }
  return [...servers].flatMap(([name, c]) => {
    if (name === 'ramu') return []
    const transport: Transport | null =
      typeof c.url === 'string'
        ? { type: 'http', url: c.url }
        : typeof c.command === 'string'
          ? { type: 'stdio', command: c.command, args: strings(c.args) }
          : null
    if (!transport) {
      skip?.(name, NO_TRANSPORT)
      return []
    }
    const headers = { ...c.headers }
    // Codex can read a bearer token from an environment variable; other providers need the header itself.
    if (typeof c.bearer_token_env_var === 'string' && env[c.bearer_token_env_var])
      headers.Authorization ??= `Bearer ${env[c.bearer_token_env_var]}`
    return [
      {
        name,
        transport,
        env: c.env,
        headers,
        enabled: c.enabled !== false,
        ...(typeof c.cwd === 'string' ? { cwd: c.cwd } : {}),
      },
    ]
  })
}

/** Providers accept looser frontmatter than Ramu's installer does, so listing falls back to the plain fields. */
function lenientSkillMetadata(raw: string, folder: string) {
  try {
    return skillMetadata(raw)
  } catch {
    const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw)?.[1]
    if (!front) throw new Error('SKILL.md has no frontmatter.')
    const field = (key: string) =>
      new RegExp(`^${key}:\\s*(.+)$`, 'm')
        .exec(front)?.[1]
        ?.replace(/^["']|["']$/g, '')
        .trim()
    return { name: field('name') || folder, description: (field('description') ?? '').slice(0, 1000) }
  }
}

export const mcpServerKey = (transport: Transport) =>
  createHash('sha256').update(JSON.stringify(transport)).digest('hex').slice(0, 16)

/** Names go into provider config keys, so only plain ones can be shared. */
const plainName = (name: string) => /^[A-Za-z0-9_-]{1,64}$/.test(name)
/** Why a declared server cannot be given to other providers, if it cannot. */
export function shareBlocker(server: Declared): string | undefined {
  if (!plainName(server.name)) return 'Its name has characters other providers do not accept.'
  if (server.transport.type === 'stdio') {
    const { command } = server.transport
    if (server.cwd || (!isAbsolute(command) && command.includes('/')))
      return 'It runs a command relative to one provider’s folder.'
  }
  return undefined
}

/** Remote servers are shared unless turned off; local commands only once turned on. */
export const sharedByDefault = (transport: Transport) => transport.type === 'http'

type Origin = Omit<ProjectSetupSource, 'enabled'>
/** Every declaration found, grouped by server. Keeps values for session delivery; never sent to clients as is. */
interface Collected {
  servers: Map<
    string,
    { name: string; declared: Declared[]; sources: ProjectSetupSource[]; providers: Set<AgentProvider> }
  >
  diagnostics: ProjectSetup['diagnostics']
}

/** The provider config files Ramu knows, in the provider's own default locations unless `env` points elsewhere. */
function userConfigFiles(env: NodeJS.ProcessEnv, home: string) {
  return {
    claude: join(env.CLAUDE_CONFIG_DIR ?? home, '.claude.json'),
    codex: join(env.CODEX_HOME ?? join(home, '.codex'), 'config.toml'),
    cursor: join(home, '.cursor', 'mcp.json'),
    opencode: ['opencode.json', 'opencode.jsonc'].map((name) =>
      join(env.XDG_CONFIG_HOME ?? join(home, '.config'), 'opencode', name),
    ),
  }
}

function collect(roots: { label: string; path: string }[], env: NodeJS.ProcessEnv, home: string): Collected {
  const result: Collected = { servers: new Map(), diagnostics: [] }
  const display = (path: string) =>
    path === home || path.startsWith(home + '/') ? '~' + path.slice(home.length) : path
  // The declaring file's modification time travels with each server it declares.
  let changedAt = 0
  const touch = (file: string) => {
    changedAt = statSync(file, { throwIfNoEntry: false })?.mtimeMs ?? 0
  }
  const attempt = (file: string, work: () => void) => {
    touch(file)
    try {
      work()
    } catch (error) {
      result.diagnostics.push({ file: display(file), message: error instanceof Error ? error.message : String(error) })
    }
  }
  // One unusable entry is reported on its own and never costs the rest of its file.
  const skip =
    (file: string): Skip =>
    (name, reason) =>
      result.diagnostics.push({ file: display(file), message: `Server "${name}" ${reason}` })
  const add = (declared: Declared[], origin: Origin, forwarded = false) => {
    for (const server of declared) {
      const key = mcpServerKey(server.transport)
      const entry = result.servers.get(key) ?? { name: server.name, declared: [], sources: [], providers: new Set() }
      result.servers.set(key, entry)
      entry.declared.push({ ...server, changedAt })
      entry.sources.push({ ...origin, enabled: server.enabled })
      if (!server.enabled) continue
      // Ramu forwards repository and Claude local-scope servers to every provider session in this project.
      for (const provider of forwarded ? AGENT_PROVIDERS : [origin.provider!]) entry.providers.add(provider)
    }
  }
  const readJson = (path: string, jsonc = false) => {
    const raw = readBounded(path)
    return raw === null ? null : object(jsonc ? parseJsonc(raw) : JSON.parse(raw))
  }
  const files = userConfigFiles(env, home)

  let claudeProjects: Json = {}
  attempt(files.claude, () => {
    const config = readJson(files.claude)
    claudeProjects = object(config?.projects) ?? {}
    add(standardServers(config?.mcpServers, skip(files.claude)), {
      scope: 'user',
      label: 'Claude',
      file: display(files.claude),
      provider: 'claude-code',
    })
  })
  attempt(files.codex, () => {
    const raw = readBounded(files.codex)
    if (raw !== null)
      add(codexServers(raw, env, skip(files.codex)), {
        scope: 'user',
        label: 'Codex',
        file: display(files.codex),
        provider: 'codex',
      })
  })
  attempt(files.cursor, () =>
    add(standardServers(readJson(files.cursor)?.mcpServers, skip(files.cursor)), {
      scope: 'user',
      label: 'Cursor',
      file: display(files.cursor),
      provider: 'cursor',
    }),
  )
  for (const file of files.opencode)
    attempt(file, () =>
      add(openCodeServers(readJson(file, true)?.mcp, skip(file)), {
        scope: 'user',
        label: 'OpenCode',
        file: display(file),
        provider: 'opencode',
      }),
    )

  for (const { label, path } of roots) {
    const at = (file: string) => join(path, file)
    const origin = (file: string, provider?: AgentProvider): Origin => ({
      scope: 'project',
      label,
      file,
      ...(provider ? { provider } : {}),
    })
    attempt(at('.mcp.json'), () => {
      const config = readJson(at('.mcp.json'))
      if (config && !object(config.mcpServers)) throw new Error('Expected an "mcpServers" object.')
      add(standardServers(config?.mcpServers, skip(at('.mcp.json'))), origin('.mcp.json'), true)
    })
    const local = object(claudeProjects[path])
    if (local) {
      touch(files.claude)
      const disabled = strings(local.disabledMcpServers)
      add(
        standardServers(local.mcpServers, skip(files.claude)).map((s) => ({
          ...s,
          enabled: s.enabled && !disabled.includes(s.name),
        })),
        origin(`${display(files.claude)} (local)`),
        true,
      )
    }
    attempt(at('.cursor/mcp.json'), () =>
      add(
        standardServers(readJson(at('.cursor/mcp.json'))?.mcpServers, skip(at('.cursor/mcp.json'))),
        origin('.cursor/mcp.json', 'cursor'),
      ),
    )
    attempt(at('.codex/config.toml'), () => {
      const raw = readBounded(at('.codex/config.toml'))
      if (raw !== null)
        add(codexServers(raw, env, skip(at('.codex/config.toml'))), origin('.codex/config.toml', 'codex'))
    })
    for (const name of ['opencode.json', 'opencode.jsonc'])
      attempt(at(name), () =>
        add(openCodeServers(readJson(at(name), true)?.mcp, skip(at(name))), origin(name, 'opencode')),
      )
  }

  return result
}

/** Host choices about which declared servers Ramu gives to every provider and account. Keyed by `mcpServerKey`. */
export type McpSharing = Record<string, boolean>
export const MCP_SHARING_KEY = 'agent-setup:mcp-sharing:v1'
/**
 * Imported connections by ID: the declared server each came from, whether Ramu was sharing it, and whether the swap has
 * happened. It happens at the connection's first approval, never before, so every provider keeps the server until the
 * Shared MCP copy actually works; removing the connection gives the old sharing back.
 */
export const MCP_IMPORTS_KEY = 'agent-setup:mcp-imports:v1'
export type McpImports = Record<string, { key: string; wasShared: boolean; applied: boolean }>
/** A project's own choice sits beside the host-wide one under `<projectId>/<key>` and wins inside that project. */
export const projectSharingKey = (projectId: string, key: string) => `${projectId}/${key}`
const isShared = (key: string, transport: Transport, sharing: McpSharing, projectId?: string | null) =>
  (projectId ? sharing[projectSharingKey(projectId, key)] : undefined) ?? sharing[key] ?? sharedByDefault(transport)
/** Where the choice that applies in a project was made. */
const shareScope = (key: string, sharing: Record<string, boolean>, projectId: string | null | undefined) =>
  projectId && sharing[projectSharingKey(projectId, key)] !== undefined
    ? ('project' as const)
    : sharing[key] !== undefined
      ? ('host' as const)
      : ('default' as const)

/** With no project in view, how many projects chose differently from the all-projects setting, when any did. */
function exceptionsOf(
  projectId: string | null,
  key: string,
  sharing: Record<string, boolean>,
  everywhere: boolean,
): { exceptions?: number } {
  if (projectId) return {}
  const exceptions = Object.entries(sharing).filter(
    ([entry, value]) =>
      entry.endsWith(`/${key}`) && entry.indexOf('/') === entry.length - key.length - 1 && value !== everywhere,
  ).length
  return exceptions ? { exceptions } : {}
}

const order = (providers: Iterable<AgentProvider>) => AGENT_PROVIDERS.filter((p) => [...providers].includes(p))

/**
 * What agents get in one project: servers and skills from each provider's user configuration, Claude's local
 * project scope, and the files in the workspace folder and every repository. Reads known files only and never
 * executes anything. The same server declared for several providers or repositories becomes one entry listing every
 * source. Env and header values never leave the host; the result carries their names only.
 */
export function discoverProjectSetup(
  projectId: string | null,
  roots: { label: string; path: string }[],
  managed: { id: string; transport: SharedMcpConnection['transport'] }[] = [],
  sharing: McpSharing = {},
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
  skillSharing: SkillSharing = {},
): ProjectSetup {
  const found = collect(roots, env, home)
  const skillsFound = collectSkills(roots, env, home)
  const servers = [...found.servers].map(([key, entry]): ProjectMcpServer => {
    const declared = entry.declared.find((d) => d.enabled) ?? entry.declared[0]!
    const blocked = shareBlocker(declared)
    const enabled = entry.declared.some((d) => d.enabled)
    const shared = enabled && !blocked && isShared(key, declared.transport, sharing, projectId)
    return {
      key,
      name: entry.name,
      transport: declared.transport,
      envKeys: [...new Set(entry.declared.flatMap((d) => Object.keys(d.env)))].sort(),
      headerKeys: [...new Set(entry.declared.flatMap((d) => Object.keys(d.headers)))].sort(),
      providers: shared ? [...AGENT_PROVIDERS] : order(entry.providers),
      nativeProviders: order(entry.providers),
      // Anything in the person's own files is theirs everywhere, even when a project repeats it.
      scope: entry.sources.some((s) => s.scope === 'user') ? 'user' : 'project',
      sources: entry.sources,
      nameConflict: false,
      shared,
      shareScope: shareScope(key, sharing, projectId),
      ...(blocked ? { shareBlocked: blocked } : {}),
      ...exceptionsOf(projectId, key, sharing, sharing[key] ?? sharedByDefault(declared.transport)),
      managedConnectionId: managed.find(({ transport: m }) =>
        declared.transport.type === 'http'
          ? m.type === 'http' && m.url === declared.transport.url
          : m.type === 'stdio' &&
            m.command === declared.transport.command &&
            JSON.stringify(m.args) === JSON.stringify(declared.transport.args),
      )?.id,
    }
  })
  const byName = new Map<string, number>()
  for (const server of servers) byName.set(server.name, (byName.get(server.name) ?? 0) + 1)
  return {
    projectId,
    roots,
    mcp: servers
      .map((server) => ({ ...server, nameConflict: (byName.get(server.name) ?? 0) > 1 }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    skills: [...skillsFound.skills.values()]
      .map(({ digests, folders: _folders, providers, ...skill }): ProjectSkill => {
        const blocked =
          /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill.name) && skill.name.length <= 64
            ? undefined
            : 'Its name must be lowercase words joined by hyphens.'
        const shared = !blocked && isSkillShared(skill.name, skillSharing, projectId)
        return {
          ...(blocked ? { shareBlocked: blocked } : {}),
          ...skill,
          nativeProviders: order(providers),
          providers: shared ? [...AGENT_PROVIDERS] : order(providers),
          nameConflict: digests.size > 1,
          shared,
          shareScope: shareScope(skill.name, skillSharing, projectId),
          ...exceptionsOf(projectId, skill.name, skillSharing, skillSharing[skill.name] === true),
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name)),
    diagnostics: [...found.diagnostics, ...skillsFound.diagnostics],
  }
}

/** Names a provider account already loads from its own configuration, so Ramu does not add a second copy. */
function nativeNames(provider: AgentProvider, dirs: string[], accountEnv: NodeJS.ProcessEnv, home: string) {
  const found = collect(
    dirs.map((path) => ({ label: path, path })),
    accountEnv,
    home,
  )
  const names = new Set<string>()
  for (const entry of found.servers.values())
    entry.sources.forEach((source, index) => {
      // Claude also loads repository `.mcp.json` and its local scope itself; others get those from Ramu already.
      const native =
        source.provider === provider || (provider === 'claude-code' && !source.provider && source.scope === 'project')
      // A copy the provider has turned off does not count; sharing means the server is on everywhere.
      if (native && source.enabled && entry.declared[index]) names.add(entry.declared[index].name)
    })
  return names
}

let sharingSource: (() => McpSharing) | undefined
/**
 * Set once at host startup so provider runners can read the sharing choices without a service reference. Until then
 * nothing is shared, so embedded runners and tests never pick up the machine's own provider configuration.
 */
export function configureMcpSharing(read: () => McpSharing) {
  sharingSource = read
}

/**
 * Servers Ramu adds to one provider session so every provider and account gets the same tools: each shared server
 * declared in any provider's user configuration (read from its default location, not the account's) or in the
 * session's folders, minus anything this account already loads natively. Values come from the declaring file at
 * launch and are never stored by Ramu.
 */
export function sharedSessionServers(
  dirs: string[],
  provider: AgentProvider,
  accountEnv: NodeJS.ProcessEnv,
  options: { env?: NodeJS.ProcessEnv; home?: string; sharing?: McpSharing; projectId?: string | null } = {},
): Declared[] {
  const env = options.env ?? process.env,
    home = options.home ?? homedir(),
    sharing = options.sharing ?? sharingSource?.()
  if (!sharing) return []
  const roots = dirs.map((path) => ({ label: path, path }))
  const found = collect(roots, env, home)
  const skip = nativeNames(provider, dirs, accountEnv, home)
  const result: Declared[] = []
  for (const [key, entry] of found.servers) {
    const declared = entry.declared.find((d) => d.enabled)
    if (!declared || shareBlocker(declared) || !isShared(key, declared.transport, sharing, options.projectId)) continue
    if (skip.has(declared.name) || result.some((s) => s.name === declared.name)) continue
    result.push(declared)
  }
  return result
}

/** Where each provider loads skills by itself: user folders (following `env` to an account's own folder) and folders
 * relative to a project. Ramu's own `ramu-*` links in these folders are not listed as skills. */
function nativeSkillDirs(provider: AgentProvider, env: NodeJS.ProcessEnv, home: string) {
  const agents = join(home, '.agents', 'skills'),
    claude = join(home, '.claude', 'skills')
  switch (provider) {
    case 'claude-code':
      return { user: [join(env.CLAUDE_CONFIG_DIR ?? join(home, '.claude'), 'skills')], project: ['.claude/skills'] }
    case 'codex':
      return {
        user: [join(env.CODEX_HOME ?? join(home, '.codex'), 'skills'), agents],
        project: ['.agents/skills', '.codex/skills'],
      }
    case 'opencode':
      return {
        user: [join(env.XDG_CONFIG_HOME ?? join(home, '.config'), 'opencode', 'skills'), claude, agents],
        project: ['.opencode/skills', '.claude/skills', '.agents/skills'],
      }
    case 'cursor':
      return { user: [join(home, '.cursor', 'skills')], project: ['.cursor/skills'] }
    case 'antigravity':
      return { user: [join(home, '.gemini', 'skills')], project: ['.gemini/skills'] }
  }
}

/** SKILL.md paths Codex has turned off with `[[skills.config]] enabled = false`. */
export function codexDisabledSkills(toml: string): Set<string> {
  const disabled = new Set<string>()
  let block: { path?: string; enabled?: boolean } | null = null
  const flush = () => {
    if (block?.path && block.enabled === false) disabled.add(block.path)
  }
  for (const raw of toml.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith('[')) {
      flush()
      block = line === '[[skills.config]]' ? {} : null
      continue
    }
    if (!block) continue
    const path = /^path\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')/.exec(line)?.[1]
    if (path) block.path = path.startsWith('"') ? (JSON.parse(path) as string) : path.slice(1, -1)
    if (/^enabled\s*=\s*false\b/.test(line)) block.enabled = false
  }
  flush()
  return disabled
}

interface FoundSkill extends Omit<
  ProjectSkill,
  'providers' | 'nativeProviders' | 'shared' | 'shareScope' | 'nameConflict'
> {
  providers: Set<AgentProvider>
  digests: Set<string>
  /** Real skill folders, project copies first; the first is the one shared with other providers. */
  folders: string[]
}

/** Skills in every folder any provider loads them from, grouped by name, with the providers that load each copy. */
function collectSkills(roots: { label: string; path: string }[], env: NodeJS.ProcessEnv, home: string) {
  const skills = new Map<string, FoundSkill>()
  const diagnostics: ProjectSetup['diagnostics'] = []
  const display = (path: string) =>
    path === home || path.startsWith(home + '/') ? '~' + path.slice(home.length) : path
  let codexDisabled = new Set<string>()
  try {
    const raw = readBounded(userConfigFiles(env, home).codex)
    if (raw) codexDisabled = codexDisabledSkills(raw)
  } catch {
    /* The MCP pass reports an unreadable Codex config. */
  }
  // Each real folder once, with every provider that reads it.
  const folders = new Map<
    string,
    { path: string; scope: 'user' | 'project'; label: string; prefix: string; readers: Set<AgentProvider> }
  >()
  const folder = (path: string, scope: 'user' | 'project', label: string, prefix: string, provider: AgentProvider) => {
    let real: string
    try {
      real = realpathSync(path)
    } catch {
      return // The folder does not exist.
    }
    const entry = folders.get(real) ?? { path, scope, label, prefix, readers: new Set() }
    folders.set(real, entry)
    entry.readers.add(provider)
  }
  for (const provider of AGENT_PROVIDERS) {
    const dirs = nativeSkillDirs(provider, env, home)
    for (const dir of dirs.user) folder(dir, 'user', 'User', `${display(dir)}/`, provider)
    for (const root of roots)
      for (const rel of dirs.project) folder(join(root.path, rel), 'project', root.label, `${rel}/`, provider)
  }
  // Project folders first, so the copy that is shared is the project's own.
  const ordered = [...folders.values()].sort((a, b) => Number(a.scope === 'user') - Number(b.scope === 'user'))
  for (const { path, scope, label, prefix, readers } of ordered) {
    let names: string[]
    try {
      names = readdirSync(path, { withFileTypes: true })
        .filter(
          (entry) =>
            !entry.name.startsWith('.') &&
            !entry.name.startsWith('ramu-') &&
            (entry.isDirectory() || entry.isSymbolicLink()),
        )
        .map((entry) => entry.name)
        .sort()
        .slice(0, MAX_SKILLS_PER_DIR)
    } catch {
      continue
    }
    for (const name of names) {
      const file = join(path, name, 'SKILL.md')
      try {
        const raw = readBounded(file)
        if (raw === null) continue
        const meta = lenientSkillMetadata(raw, name)
        const entry: FoundSkill = skills.get(meta.name) ?? {
          name: meta.name,
          description: meta.description,
          scope,
          sources: [],
          providers: new Set(),
          digests: new Set(),
          folders: [],
        }
        skills.set(meta.name, entry)
        const enabled = !codexDisabled.has(file) || readers.size > 1
        entry.sources.push({ scope, label, file: `${prefix}${name}/SKILL.md`, enabled })
        if (scope === 'user') entry.scope = 'user'
        entry.digests.add(createHash('sha256').update(raw).digest('hex'))
        entry.folders.push(realpathSync(join(path, name)))
        for (const provider of readers)
          if (!(provider === 'codex' && codexDisabled.has(file))) entry.providers.add(provider)
      } catch (error) {
        diagnostics.push({ file: display(file), message: error instanceof Error ? error.message : String(error) })
      }
    }
  }
  return { skills, diagnostics }
}

/** Host choices about which skills Ramu gives to every provider and account, by skill name. Off unless turned on. */
export type SkillSharing = Record<string, boolean>
export const SKILL_SHARING_KEY = 'agent-setup:skill-sharing:v1'
/** Skills are off unless turned on; a project's own choice wins inside that project. */
const isSkillShared = (name: string, sharing: SkillSharing, projectId?: string | null) =>
  (projectId ? sharing[projectSharingKey(projectId, name)] : undefined) ?? sharing[name] === true

/**
 * Skill folders Ramu adds to one provider account's skill export: each shared skill this account does not already
 * load from its own folders. The folder is copied at launch, so edits to the original reach new threads.
 */
export function sharedSessionSkills(
  dirs: string[],
  provider: AgentProvider,
  accountEnv: NodeJS.ProcessEnv,
  sharing: SkillSharing,
  options: { env?: NodeJS.ProcessEnv; home?: string; projectId?: string | null } = {},
): { name: string; dir: string; changedAt: number; tools: string[] }[] {
  if (!Object.values(sharing).some(Boolean)) return []
  const env = options.env ?? process.env,
    home = options.home ?? homedir()
  const roots = dirs.map((path) => ({ label: path, path }))
  const all = collectSkills(roots, env, home).skills
  // What this account loads itself, read through its own folders.
  const own = collectSkills(roots, accountEnv, home).skills
  return [...all.values()].flatMap((skill) =>
    isSkillShared(skill.name, sharing, options.projectId) && !own.get(skill.name)?.providers.has(provider)
      ? [
          {
            name: skill.name,
            dir: skill.folders[0]!,
            changedAt: statSync(join(skill.folders[0]!, 'SKILL.md'), { throwIfNoEntry: false })?.mtimeMs ?? 0,
            tools: skillMcpTools(readBounded(join(skill.folders[0]!, 'SKILL.md')) ?? ''),
          },
        ]
      : [],
  )
}

/** The environment that points a provider at one account's own configuration. */
export function accountEnvironment(provider: AgentProvider, accountId = 'default'): NodeJS.ProcessEnv {
  if (accountId === 'default') return process.env
  try {
    return { ...process.env, ...providerAccountEnv(provider, providerAccountHome(provider, accountId)) }
  } catch {
    return process.env
  }
}
