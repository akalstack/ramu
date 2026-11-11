import { randomUUID } from 'node:crypto'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import { toolDeploy } from '@ramu/shared/deployActions'
import type { SharedMcpConnection } from '@ramu/shared/mcp'
import { SharedMcpPolicy, sharedMcpCatalogRevision, type ExternalMcpSession } from './policy'
import { SharedMcpConnectionError } from './errors'

export interface ExternalMcpCall {
  id: string
  sessionId: string
  hostId: string
  connectionId: string
  serviceAccountId: string
  provider: ExternalMcpSession['provider']
  accountId: string
  projectId: string | null
  revision: string
  catalogRevision: string
  toolName: string
  action: 'read' | 'write'
  outcome: 'pending' | 'completed' | 'tool-error' | 'unknown'
}

interface Connection {
  client: Client
  revision: string
}

/** Dependencies belong to the execution host. No transport factory or approval resolver comes from tool arguments. */
export interface ExternalMcpGatewayHost {
  /** Create an isolated upstream session. Resolve secret refs on the host; never forward a provider bearer token. */
  connect(connection: SharedMcpConnection, session: ExternalMcpSession, signal: AbortSignal): Promise<Client>
  /** Persist before sending a write. Records omit arguments, results, URLs and credentials. */
  record(call: ExternalMcpCall): void
  /**
   * Asks the person. A production deploy asks even when the tool is set to Allow, offers nothing lasting, and runs the
   * project's migrations before it resolves; their failure throws, and nothing is called.
   */
  approve(input: {
    call: ExternalMcpCall
    serverName: string
    arguments: Record<string, unknown>
    signal: AbortSignal
    production: boolean
  }): Promise<boolean>
}

/** External discovery and invocation stay outside the trusted Ramu ToolRegistry.
 * A gateway instance belongs to exactly one execution-server session, including helpers/background jobs.
 * It never retries a call: a lost write response is an unknown outcome, not a failed write to replay. */
export class ExternalMcpGateway {
  private connections = new Map<string, Connection>()
  private closed = false
  private abort = new AbortController()
  private tails = new Map<string, Promise<void>>()
  private waiting = 0

  constructor(
    private readonly sessionId: string,
    private readonly session: ExternalMcpSession,
    private readonly policy: SharedMcpPolicy,
    private readonly host: ExternalMcpGatewayHost,
  ) {
    // A caller retaining its session object cannot widen the gateway after construction.
    this.session = structuredClone(session)
  }

  private definition(connectionId: string) {
    const connection = this.policy.snapshot().connections.find((entry) => entry.id === connectionId)
    if (!connection) throw new Error('Unknown Shared MCP connection')
    // Before upstream discovery, reject out-of-scope and restricted sessions. An approval may still be pending.
    const access = this.policy.access(this.session, connectionId)
    if (access.status !== 'not-checked')
      throw new Error('reason' in access ? access.reason : 'Recheck Shared MCP access')
    return connection
  }

  private signal(signal?: AbortSignal) {
    if (this.closed) throw new Error('Shared MCP session is closed')
    const combined = AbortSignal.any([this.abort.signal, AbortSignal.timeout(60_000), ...(signal ? [signal] : [])])
    combined.throwIfAborted()
    return combined
  }

  private async connect(connection: SharedMcpConnection, signal: AbortSignal) {
    const existing = this.connections.get(connection.id)
    if (existing?.revision === connection.revision) return existing
    if (existing) {
      this.connections.delete(connection.id)
      await existing.client.close()
    }
    let client: Client
    try {
      client = await this.host.connect(connection, structuredClone(this.session), signal)
    } catch (error) {
      if (error instanceof SharedMcpConnectionError) throw error
      // eslint-disable-next-line preserve-caught-error -- upstream causes may contain credentials
      throw new Error('Unable to connect to the external service. Check its setup and sign-in.')
    }
    try {
      signal.throwIfAborted()
      if (this.definition(connection.id).revision !== connection.revision)
        throw new Error('Connection changed during setup')
      const entry = { client, revision: connection.revision }
      // An upstream that exits or drops its stream is forgotten, so the next call starts a fresh session instead of
      // writing into a closed one.
      const previous = client.onclose
      client.onclose = () => {
        previous?.()
        if (this.connections.get(connection.id) === entry) this.connections.delete(connection.id)
      }
      this.connections.set(connection.id, entry)
      return entry
    } catch (error) {
      await client.close().catch(() => {})
      throw error
    }
  }

  private async catalog(connection: SharedMcpConnection, entry: Connection, signal: AbortSignal) {
    const tools: Tool[] = []
    const names = new Set<string>()
    const cursors = new Set<string>()
    let cursor: string | undefined
    for (let page = 0; page < 20; page++) {
      const result = await entry.client.listTools(cursor ? { cursor } : {}, { signal, timeout: 15_000 }).catch(() => {
        throw new Error('Unable to read external tools. Check the connection.')
      })
      for (const tool of result.tools) {
        if (names.has(tool.name)) throw new Error('Upstream returned duplicate tool names')
        names.add(tool.name)
        tools.push(tool)
      }
      if (tools.length > 2000 || Buffer.byteLength(JSON.stringify(tools)) > 2 * 1024 * 1024)
        throw new Error('Upstream catalog exceeds Shared MCP limits')
      if (!result.nextCursor) {
        // Stable ordering avoids invalidating grants just because pages were reordered.
        tools.sort((a, b) => a.name.localeCompare(b.name))
        const revision = sharedMcpCatalogRevision(tools)
        if (this.definition(connection.id).revision !== connection.revision)
          throw new Error('Connection changed while reading tools')
        return { tools, revision }
      }
      if (cursors.has(result.nextCursor)) throw new Error('Upstream repeated a catalog cursor')
      cursors.add(result.nextCursor)
      cursor = result.nextCursor
    }
    throw new Error('Upstream catalog has too many pages')
  }

  /** Host administration uses this only after explicit Connect/Check; it does not approve tools. */
  async inspect(connectionId: string, signal?: AbortSignal) {
    return this.exclusive(connectionId, async () => {
      const requestSignal = this.signal(signal)
      const connection = this.definition(connectionId)
      const entry = await this.connect(connection, requestSignal)
      const catalog = await this.catalog(connection, entry, requestSignal)
      return { connectionId, revision: connection.revision, catalogRevision: catalog.revision, tools: catalog.tools }
    })
  }

  /** Session discovery reveals only tools with current grants, using the same policy as invocation. */
  async discover(connectionId: string, signal?: AbortSignal) {
    const catalog = await this.inspect(connectionId, signal)
    const tools = catalog.tools.filter((tool) => {
      try {
        this.policy.authorize(this.session, connectionId, catalog.catalogRevision, tool.name)
        return true
      } catch {
        return false
      }
    })
    return { ...catalog, tools }
  }

  /**
   * Operations on one connection run one after another, so a provider's parallel calls queue instead of failing and
   * two never connect or read the catalog at once. At most eight wait across the session.
   */
  private async exclusive<T>(connectionId: string, work: () => Promise<T>): Promise<T> {
    this.signal()
    if (this.waiting >= 8) throw new Error('Shared MCP session is busy')
    this.waiting++
    const run = (this.tails.get(connectionId) ?? Promise.resolve()).then(work)
    const tail = run.then(
      () => undefined,
      () => undefined,
    )
    this.tails.set(connectionId, tail)
    try {
      return await run
    } finally {
      this.waiting--
      if (this.tails.get(connectionId) === tail) this.tails.delete(connectionId)
    }
  }

  async invoke(
    connectionId: string,
    catalogRevision: string,
    toolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<CallToolResult> {
    // Do not pass a mutable arguments object to an asynchronous approval or upstream call.
    const argumentsCopy = structuredClone(args)
    if (Buffer.byteLength(JSON.stringify(argumentsCopy)) > 256 * 1024)
      throw new Error('Tool arguments exceed Shared MCP limits')
    return this.exclusive(connectionId, async () => {
      const requestSignal = this.signal(signal)
      const connection = this.definition(connectionId)
      this.policy.authorize(this.session, connectionId, catalogRevision, toolName)
      const entry = await this.connect(connection, requestSignal)
      const current = await this.catalog(connection, entry, requestSignal)
      if (current.revision !== catalogRevision)
        throw new Error('Upstream tools changed; review Shared MCP access again')
      const tool = current.tools.find((entry) => entry.name === toolName)
      if (!tool) throw new Error('Unknown upstream tool')
      const permission = this.policy.authorize(this.session, connectionId, catalogRevision, toolName)
      const production = toolDeploy(tool, argumentsCopy) === 'production'
      const asks = permission.requiresApproval || production
      const call: ExternalMcpCall = {
        id: randomUUID(),
        sessionId: this.sessionId,
        hostId: this.session.hostId,
        connectionId,
        serviceAccountId: connection.serviceAccountId,
        provider: this.session.provider,
        accountId: this.session.accountId,
        projectId: this.session.projectId,
        revision: connection.revision,
        catalogRevision,
        toolName,
        action: permission.action,
        outcome: 'pending',
      }
      if (
        asks &&
        !(await this.host.approve({
          call: structuredClone(call),
          serverName: connection.name,
          arguments: structuredClone(argumentsCopy),
          signal: requestSignal,
          production,
        }))
      )
        throw new Error('Shared MCP tool approval was declined')
      requestSignal.throwIfAborted()
      if (asks) {
        const afterApproval = await this.catalog(connection, entry, requestSignal)
        if (afterApproval.revision !== catalogRevision)
          throw new Error('Upstream tools changed during approval; review Shared MCP access again')
      }
      // Approval can take time; repeat revision, scope and grant checks at dispatch.
      const checked = this.policy.authorize(this.session, connectionId, catalogRevision, toolName)
      if (
        checked.revision !== call.revision ||
        checked.action !== permission.action ||
        checked.requiresApproval !== permission.requiresApproval
      )
        throw new Error('Connection or tool permissions changed during approval')
      this.host.record(structuredClone(call))
      let result: CallToolResult
      try {
        result = (await entry.client.callTool({ name: toolName, arguments: argumentsCopy }, undefined, {
          signal: requestSignal,
          timeout: 60_000,
        })) as CallToolResult
        if (Buffer.byteLength(JSON.stringify(result)) > 2 * 1024 * 1024)
          throw new Error('Tool output exceeds Shared MCP limits')
      } catch {
        // Do not surface upstream messages: they can contain headers, URLs, arguments or credentials.
        // The durable pending record still identifies an uncertain call if updating it fails.
        try {
          this.host.record({ ...call, outcome: 'unknown' })
        } catch {
          // Never let a bookkeeping failure turn an unknown write into a retryable failure.
        }
        throw new Error(
          permission.action === 'write'
            ? 'The write outcome is unknown. Inspect the service before trying again.'
            : 'The external tool did not return a usable response. Check the connection.',
        )
      }
      try {
        this.host.record({ ...call, outcome: result.isError ? 'tool-error' : 'completed' })
      } catch {
        throw new Error(
          'The service responded, but its outcome could not be saved. Inspect the service before trying again.',
        )
      }
      return result
    })
  }

  async close() {
    this.closed = true
    this.abort.abort()
    const connections = [...this.connections.values()]
    this.connections.clear()
    await Promise.allSettled(connections.map((entry) => entry.client.close()))
  }
}
