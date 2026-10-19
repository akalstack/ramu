import type { AgentScope } from '@ramu/shared/types'
import { discoverMcpServers, type DiscoveredMcpServer } from '../context'

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
  url?: string
  headers: Record<string, string>
  command?: string
  args: string[]
  env: Record<string, string>
}

/** The repositories' `.mcp.json` servers, deduplicated, in one shape each provider converts from. */
export function repoMcpServers(scope: AgentScope): NormalizedMcp[] {
  return Object.entries(discoverMcpServers(scope, ['ramu']) as Record<string, DiscoveredMcpServer>)
    .filter(([name]) => plainName(name))
    .map(([name, s]) => ({
      name,
      ...(typeof s.url === 'string' ? { url: s.url } : { command: text(s.command) }),
      headers: record(s.headers),
      args: strings(s.args),
      env: record(s.env),
    }))
}

/** Codex `-c` overrides; values are JSON strings, which TOML reads as basic strings. */
export function codexMcpConfig(servers: NormalizedMcp[]): string[] {
  const table = (values: Record<string, string>) =>
    `{${Object.entries(values)
      .map(([k, v]) => `${JSON.stringify(k)}=${JSON.stringify(v)}`)
      .join(',')}}`
  return servers.flatMap((s) => {
    const key = `mcp_servers.${s.name}`
    return s.url
      ? [
          `${key}.url=${JSON.stringify(s.url)}`,
          ...(Object.keys(s.headers).length ? [`${key}.http_headers=${table(s.headers)}`] : []),
        ]
      : [
          `${key}.command=${JSON.stringify(s.command)}`,
          ...(s.args.length ? [`${key}.args=${JSON.stringify(s.args)}`] : []),
          ...(Object.keys(s.env).length ? [`${key}.env=${table(s.env)}`] : []),
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
        ? { type: 'remote', url: s.url, ...(Object.keys(s.headers).length ? { headers: s.headers } : {}) }
        : {
            type: 'local',
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
