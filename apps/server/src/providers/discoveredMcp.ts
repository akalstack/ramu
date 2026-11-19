import { createHash } from 'node:crypto'
import type { AgentScope, AgentMcpStatus, McpConnection } from '@ramu/shared/types'
import { claudeMcpServers } from './claudeMcp'
import type { DiscoveredMcpServer } from '../context'
import type { AgentProvider } from '@ramu/shared/types'
import { accountEnvironment, sharedSessionServers } from '../agent/projectSetup'
import { EXTERNAL_MCP_SERVER } from '../mcp/sessionTools'

type Wire = Record<string, any>
const text = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback)
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v) => typeof v === 'string') : [])
const record = (value: unknown): Record<string, string> =>
  Object.fromEntries(
    Object.entries(value && typeof value === 'object' && !Array.isArray(value) ? (value as Wire) : {}).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  )
/** Names go into provider config keys, so only plain ones are passed on. */
const plainName = (name: string) => /^[A-Za-z0-9_-]{1,64}$/.test(name)

export interface NormalizedMcp {
  name: string
  startupTimeoutMs?: number
  url?: string
  headers: Record<string, string>
  command?: string
  args: string[]
  env: Record<string, string>
}

/** The repositories' `.mcp.json` servers, deduplicated, in one shape each provider converts from. */
export function repoMcpServers(scope: AgentScope, configDirs: string[] = []): NormalizedMcp[] {
  // Claude-local repository MCPs are a shared tool source; provider model credentials remain native.
  return Object.entries(claudeMcpServers(scope, configDirs) as Record<string, DiscoveredMcpServer>)
    .filter(([name]) => plainName(name))
    .map(([name, s]) => ({
      name,
      startupTimeoutMs:
        typeof s.startup_timeout_sec === 'number' && Number.isFinite(s.startup_timeout_sec) && s.startup_timeout_sec > 0
          ? s.startup_timeout_sec * 1000
          : s.timeout &&
              typeof s.timeout === 'object' &&
              typeof (s.timeout as Wire).startup === 'number' &&
              Number.isFinite((s.timeout as Wire).startup) &&
              (s.timeout as Wire).startup > 0
            ? (s.timeout as Wire).startup
            : 60_000,
      ...(typeof s.url === 'string' ? { url: s.url } : { command: text(s.command) }),
      headers: record(s.headers),
      args: strings(s.args),
      env: record(s.env),
    }))
}

/**
 * Repository servers plus every server shared through Agent setup that this provider account does not already load
 * itself, so one setup reaches every provider and account.
 */
export function sessionMcpServers(
  scope: AgentScope,
  connection: McpConnection | undefined,
  provider: AgentProvider,
  accountId?: string,
  projectId?: string | null,
): NormalizedMcp[] {
  const configDirs = connection?.mcpConfigDirs ?? []
  const repo = repoMcpServers(scope, configDirs).filter((s) => s.name !== EXTERNAL_MCP_SERVER)
  const names = new Set(repo.map((s) => s.name))
  const dirs = [...new Set([scope.cwd, ...scope.additionalDirs, ...scope.covers, ...configDirs])]
  return [
    ...repo,
    ...sharedSessionServers(dirs, provider, accountEnvironment(provider, accountId), {
      projectId: projectId ?? connection?.sharingProjectId,
    })
      .filter((s) => !names.has(s.name) && s.name !== EXTERNAL_MCP_SERVER)
      .map((s): NormalizedMcp => ({
        name: s.name,
        startupTimeoutMs: 60_000,
        ...(s.transport.type === 'http' ? { url: s.transport.url } : { command: s.transport.command }),
        headers: s.headers,
        args: s.transport.type === 'stdio' ? s.transport.args : [],
        env: s.env,
      })),
    // Shared MCP tools: a separate server name from `ramu`, authorized again on the host for every list and call.
    ...(connection?.externalUrl
      ? [
          {
            name: EXTERNAL_MCP_SERVER,
            startupTimeoutMs: 60_000,
            url: connection.externalUrl,
            headers: { Authorization: `Bearer ${connection.token}` },
            args: [],
            env: {},
          },
        ]
      : []),
  ]
}

/**
 * A digest of the servers a session is launched with, values included but never kept: only whether something a runtime
 * would load has changed since it started.
 */
export function serversDigest(servers: readonly NormalizedMcp[]): string {
  const sorted = (values: Record<string, string>) => Object.entries(values).sort(([a], [b]) => a.localeCompare(b))
  return createHash('sha256')
    .update(
      JSON.stringify(
        servers.map((server) => [
          server.name,
          server.url ?? null,
          server.command ?? null,
          server.args,
          sorted(server.headers),
          sorted(server.env),
        ]),
      ),
    )
    .digest('hex')
}

/** Codex `-c` overrides; values are JSON strings, which TOML reads as basic strings. */
export function codexMcpConfig(servers: NormalizedMcp[]): string[] {
  const table = (values: Record<string, string>) =>
    `{${Object.entries(values)
      .map(([k, v]) => `${JSON.stringify(k)}=${JSON.stringify(v)}`)
      .join(',')}}`
  return servers.flatMap((s) => {
    const key = `mcp_servers.${s.name}`
    return [
      `${key}.startup_timeout_sec=${(s.startupTimeoutMs ?? 60_000) / 1000}`,
      ...(s.url
        ? [
            `${key}.url=${JSON.stringify(s.url)}`,
            ...(Object.keys(s.headers).length ? [`${key}.http_headers=${table(s.headers)}`] : []),
          ]
        : [
            `${key}.command=${JSON.stringify(s.command)}`,
            ...(s.args.length ? [`${key}.args=${JSON.stringify(s.args)}`] : []),
            ...(Object.keys(s.env).length ? [`${key}.env=${table(s.env)}`] : []),
          ]),
    ]
  })
}

/** ACP `mcpServers` entries. Remote servers need the runtime's HTTP support. */
export function acpMcpServers(servers: NormalizedMcp[], http: boolean): Wire[] {
  const pairs = (values: Record<string, string>) => Object.entries(values).map(([name, value]) => ({ name, value }))
  return servers.flatMap((s): Wire[] =>
    s.url
      ? http
        ? [{ type: 'http', name: s.name, url: s.url, headers: pairs(s.headers) }]
        : []
      : [{ name: s.name, command: s.command, args: s.args, env: pairs(s.env) }],
  )
}

/** OpenCode `mcp.servers` entries. */
export function openCodeMcpServers(servers: NormalizedMcp[]): Record<string, Wire> {
  return Object.fromEntries(
    servers.map((s) => [
      s.name,
      s.url
        ? {
            type: 'remote',
            timeout: { startup: s.startupTimeoutMs ?? 60_000 },
            url: s.url,
            ...(Object.keys(s.headers).length ? { headers: s.headers } : {}),
          }
        : {
            type: 'local',
            timeout: { startup: s.startupTimeoutMs ?? 60_000 },
            command: [s.command, ...s.args],
            ...(Object.keys(s.env).length ? { environment: s.env } : {}),
          },
    ]),
  )
}

/** Cursor takes Claude's shape. */
export function cursorMcpServers(servers: NormalizedMcp[]): Record<string, Wire> {
  return Object.fromEntries(
    servers.map((s) => [
      s.name,
      s.url
        ? { type: 'http', url: s.url, ...(Object.keys(s.headers).length ? { headers: s.headers } : {}) }
        : { command: s.command, args: s.args, ...(Object.keys(s.env).length ? { env: s.env } : {}) },
    ]),
  )
}

/** Inventory for runtimes without a live status API. Configured never implies connected. */
export function configuredMcpStatus(
  scope: AgentScope,
  connection?: McpConnection,
  http = true,
  session?: { provider: AgentProvider; accountId?: string },
): AgentMcpStatus {
  const servers = (
    session
      ? sessionMcpServers(scope, connection, session.provider, session.accountId, connection?.sharingProjectId)
      : repoMcpServers(scope, connection?.mcpConfigDirs)
  ).map((server) => ({
    name: server.name,
    status: server.url && !http ? 'unsupported' : 'configured',
  }))
  if (connection) servers.push({ name: 'ramu', status: http ? 'configured' : 'unsupported' })
  return { supported: true, live: false, source: 'configuration', servers }
}
