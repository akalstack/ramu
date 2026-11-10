import { createHash } from 'node:crypto'
import type { PermissionOptions } from '../agent/userRequests'
import { connectionApplies } from './policy'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from '@modelcontextprotocol/sdk/types.js'
import type { SharedMcpConnection } from '@ramu/shared/mcp'
import { redactSecrets } from '../memory/secrets'
import type { ExternalMcpGateway } from './gateway'
import type { ExternalMcpSession } from './policy'
import type { SharedMcpService } from './service'

/**
 * Provider-side server name. It deliberately does not start with `ramu`: permission modes and the ACP and OpenCode
 * tool-name rewrites trust that prefix, and an external tool must never inherit it.
 */
export const EXTERNAL_MCP_SERVER = 'shared_mcp'
/** Claude limits a full tool name to 64 characters; `mcp__shared_mcp__` takes 19 of them. */
const NAME_BUDGET = 64 - `mcp__${EXTERNAL_MCP_SERVER}__`.length

const safe = (value: string) => value.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '')
const short = (value: string, length = 6) => createHash('sha256').update(value).digest('hex').slice(0, length)

/**
 * A deterministic provider-safe name. The connection ID, never its display name, keeps two servers with the same
 * name apart; the hash of the original tool name keeps two tools that sanitize to the same text apart.
 */
export function externalToolName(connection: Pick<SharedMcpConnection, 'id' | 'name'>, toolName: string) {
  const prefix = `${(safe(connection.name) || 'server').slice(0, 12)}-${short(connection.id)}`
  const room = NAME_BUDGET - prefix.length - 2
  const clean = safe(toolName)
  const tool =
    clean === toolName && clean.length <= room ? clean : `${clean.slice(0, Math.max(room - 7, 1))}-${short(toolName)}`
  return `${prefix}__${tool}`.slice(0, NAME_BUDGET)
}

/**
 * The connections a thread has already called, read from the names of the tools it used. A tool name carries the short
 * hash of its connection's id (see `externalToolName`), whatever prefix a provider adds in front of it.
 */
export function connectionsUsed(toolNames: Iterable<string>, connectionIds: Iterable<string>): Set<string> {
  const marks = [...connectionIds].map((id) => [id, `-${short(id)}__`] as const)
  const used = new Set<string>()
  for (const name of toolNames) for (const [id, mark] of marks) if (name.includes(mark)) used.add(id)
  return used
}

export interface ExternalToolEntry {
  name: string
  connectionId: string
  catalogRevision: string
  tool: Tool
}

export interface ExternalSessionSource {
  sessionId: string
  hostId: string
  provider: ExternalMcpSession['provider']
  accountId: string
  projectId: string | null
  role: ExternalMcpSession['role']
  externalToolsAllowed: boolean
  /** The chat's own narrowing of the connections it may use; undefined inherits project policy. */
  connectionIds?: string[]
}

/** Whether a launch for this provider and project has any connection worth offering. Contacts nothing. */
export function hasExternalConnections(service: SharedMcpService, source: ExternalSessionSource) {
  if (source.role === 'restricted' || !source.externalToolsAllowed) return false
  return service.policy
    .snapshot()
    .connections.some(
      (connection) =>
        connection.enabled &&
        connection.providers.includes(source.provider) &&
        (source.connectionIds === undefined || source.connectionIds.includes(connection.id)) &&
        connectionApplies(connection, source.projectId),
    )
}

const IDLE_MS = 10 * 60_000
const RECENT_MS = 20_000

/**
 * Serves each chat's approved external tools on a separate MCP endpoint. Every list and call goes through the same
 * per-session gateway and policy, so a forged tool name or a stale catalog never reaches an upstream.
 */
export class ExternalSessionTools {
  private recent = new Map<string, { at: number; entries: ExternalToolEntry[] }>()
  private gateways = new Map<string, { gateway: ExternalMcpGateway; timer: ReturnType<typeof setTimeout> }>()

  constructor(
    private readonly service: () => SharedMcpService,
    /** Asks the person through the chat's existing approval card; resolves true only when they allow it. */
    private readonly approve: (
      sessionId: string,
      title: string,
      detail: string,
      signal: AbortSignal,
      options: PermissionOptions,
    ) => Promise<boolean>,
  ) {}

  private session(source: ExternalSessionSource): ExternalMcpSession {
    return {
      hostId: source.hostId,
      provider: source.provider,
      accountId: source.accountId,
      projectId: source.projectId,
      role: source.role,
      externalToolsAllowed: source.externalToolsAllowed,
      ...(source.connectionIds ? { connectionIds: source.connectionIds } : {}),
    }
  }

  /** A gateway is bound to one provider login and project, so a switch within a chat never reuses another's access. */
  private key(source: ExternalSessionSource) {
    return JSON.stringify([
      source.sessionId,
      source.provider,
      source.accountId,
      source.projectId,
      source.role,
      source.connectionIds ?? null,
    ])
  }

  private gateway(source: ExternalSessionSource) {
    const service = this.service()
    const key = this.key(source)
    const existing = this.gateways.get(key)
    if (existing) {
      clearTimeout(existing.timer)
      existing.timer = this.expire(key)
      return existing.gateway
    }
    // A chat that switched login, provider or project no longer uses its earlier gateway: close it now, which also
    // stops any local server it started, rather than leaving it running until the idle timer.
    for (const other of [...this.gateways.keys()])
      if (other !== key && JSON.parse(other)[0] === source.sessionId) void this.closeKey(other)
    const gateway = service.gateway(
      source.sessionId,
      this.session(source),
      async ({ call, serverName, arguments: args, signal }) =>
        this.approve(
          source.sessionId,
          `${serverName}: ${call.toolName}`,
          [
            `Server: ${serverName}`,
            `Service account: ${call.serviceAccountId}`,
            `Provider login: ${call.accountId}`,
            `Action: ${call.action === 'write' ? 'may change data' : 'read'}`,
            `Arguments: ${redactSecrets(JSON.stringify(args)).slice(0, 2000)}`,
          ].join('\n'),
          signal,
          { always: () => service.allowTool(call.connectionId, call.toolName) },
        ),
    )
    this.gateways.set(key, { gateway, timer: this.expire(key) })
    return gateway
  }

  private expire(key: string) {
    const timer = setTimeout(() => void this.closeKey(key), IDLE_MS)
    timer.unref()
    return timer
  }

  private async closeKey(key: string) {
    const entry = this.gateways.get(key)
    if (!entry) return
    this.gateways.delete(key)
    this.recent.delete(key)
    clearTimeout(entry.timer)
    await entry.gateway.close()
  }

  /** Ends every upstream session a chat holds; called when it stops, fails or is deleted. */
  async closeSession(sessionId: string) {
    await Promise.allSettled(
      [...this.gateways.keys()].filter((key) => JSON.parse(key)[0] === sessionId).map((key) => this.closeKey(key)),
    )
  }

  async close() {
    await Promise.allSettled([...this.gateways.keys()].map((key) => this.closeKey(key)))
  }

  /** Every approved tool across the connections this chat may use. A connection that fails is skipped, not fatal. */
  async list(source: ExternalSessionSource, signal?: AbortSignal): Promise<ExternalToolEntry[]> {
    const gateway = this.gateway(source)
    const entries: ExternalToolEntry[] = []
    const taken = new Set<string>()
    for (const connection of this.service().policy.snapshot().connections) {
      if (!connection.enabled || !connection.providers.includes(source.provider)) continue
      try {
        const found = await gateway.discover(connection.id, signal)
        for (const tool of found.tools) {
          let name = externalToolName(connection, tool.name)
          // A residual collision never merges two upstream tools under one name.
          if (taken.has(name)) name = `${name.slice(0, NAME_BUDGET - 7)}-${short(`${connection.id}:${tool.name}`)}`
          taken.add(name)
          entries.push({ name, connectionId: connection.id, catalogRevision: found.catalogRevision, tool })
        }
      } catch {
        // Not approved, out of scope, offline or signed out: the thread's setup list reports why.
      }
    }
    this.recent.set(this.key(source), { at: Date.now(), entries })
    return entries
  }

  /**
   * One approved tool called for Ramu itself (an ability mapped to it), through the chat's own gateway: the same grant,
   * catalog and approval checks as when the agent calls it. `build` turns the tool's input schema into its arguments.
   */
  async callTool(
    source: ExternalSessionSource,
    connectionId: string,
    toolName: string,
    build: (inputSchema: Record<string, unknown>) => Record<string, unknown>,
    signal?: AbortSignal,
  ) {
    const entry = (await this.list(source, signal)).find(
      (item) => item.connectionId === connectionId && item.tool.name === toolName,
    )
    if (!entry)
      throw new Error('That Shared MCP tool is not approved for this thread. Review access in Settings → Agent setup.')
    const server =
      this.service()
        .policy.snapshot()
        .connections.find((connection) => connection.id === connectionId)?.name ?? 'Shared MCP'
    const result = await this.gateway(source).invoke(
      connectionId,
      entry.catalogRevision,
      toolName,
      build(entry.tool.inputSchema as Record<string, unknown>),
      signal,
    )
    return { server, result }
  }

  private build(source: ExternalSessionSource) {
    const server = new Server({ name: EXTERNAL_MCP_SERVER, version: '0.1.0' }, { capabilities: { tools: {} } })
    server.setRequestHandler(ListToolsRequestSchema, async (_request, extra) => ({
      tools: (await this.list(source, extra.signal)).map((entry) => {
        const connection = this.service()
          .policy.snapshot()
          .connections.find((item) => item.id === entry.connectionId)
        return {
          name: entry.name,
          description: `[${connection?.name ?? 'External server'}] ${entry.tool.description ?? entry.tool.name}`.slice(
            0,
            4000,
          ),
          inputSchema: entry.tool.inputSchema,
        }
      }),
    }))
    server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const failure = (message: string) => ({ isError: true, content: [{ type: 'text' as const, text: message }] })
      try {
        // Parallel calls resolve their tool from the list the model just saw; only a miss reads the catalogs again.
        // The gateway re-checks the catalog revision and the grant on every call either way.
        const key = this.key(source)
        const recent = this.recent.get(key)
        let entry =
          recent && Date.now() - recent.at < RECENT_MS
            ? recent.entries.find((item) => item.name === request.params.name)
            : undefined
        if (!entry) entry = (await this.list(source, extra.signal)).find((item) => item.name === request.params.name)
        if (!entry) return failure('Unknown or unapproved external tool. Review access in Settings → Agent setup.')
        return await this.gateway(source).invoke(
          entry.connectionId,
          entry.catalogRevision,
          entry.tool.name,
          (request.params.arguments ?? {}) as Record<string, unknown>,
          extra.signal,
        )
      } catch (error) {
        // Gateway errors are already sanitized; never copy anything else upstream-shaped.
        return failure(error instanceof Error ? error.message : 'The external tool could not be called.')
      }
    })
    return server
  }

  /** One stateless request, like the Ramu endpoint. */
  async serve(source: ExternalSessionSource, req: IncomingMessage, res: ServerResponse, body: unknown) {
    const server = this.build(source)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    res.on('close', () => {
      void transport.close()
      void server.close()
    })
    try {
      await server.connect(transport)
      await transport.handleRequest(req, res, body)
    } catch {
      if (!res.headersSent) res.writeHead(500).end()
    }
  }
}
