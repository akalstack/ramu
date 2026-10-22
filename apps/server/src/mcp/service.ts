import type {
  SharedMcpConnection,
  SharedMcpGrant,
  SharedMcpInspection,
  SharedMcpAccountReadiness,
  SharedMcpManagement,
  SharedMcpPolicyState,
  SharedMcpProviderAccount,
  SharedMcpSelection,
} from '@ramu/shared/mcp'
import { HostCredentialStore } from '../credentials/store'
import { SharedMcpPolicy, type ExternalMcpSession } from './policy'
import { ExternalMcpGateway, type ExternalMcpGatewayHost } from './gateway'
import { connectSharedMcpStdio } from './stdio'
import { connectSharedMcpHttp } from './http'
import { SharedMcpConnectionError } from './errors'
import { SharedMcpStorage } from './storage'

type Health = SharedMcpManagement['connections'][number]

/** The host manager is shared by Settings and, separately, authenticated provider sessions. */
export class SharedMcpService {
  readonly policy: SharedMcpPolicy
  private checks = new Map<
    string,
    { revision: string; status: Health['status']; checkedAt: number | null; reason?: string; toolCount?: number }
  >()
  private inspections = new Map<string, SharedMcpInspection>()
  private management = new Map<string, ExternalMcpGateway>()
  private busy = new Set<string>()
  private epochs = new Map<string, symbol>()
  private idle = new Map<string, ReturnType<typeof setTimeout>>()
  private closed = false

  constructor(
    readonly storage: SharedMcpStorage,
    readonly credentials = new HostCredentialStore(),
    private readonly changed = () => {},
    private readonly connect: ExternalMcpGatewayHost['connect'] = (connection, _session, signal) =>
      (connection.transport.type === 'http' ? connectSharedMcpHttp : connectSharedMcpStdio)(connection, signal, {
        read: (input) =>
          credentials.read(
            {
              hostId: input.hostId,
              integration: 'mcp',
              connectionId: input.connectionId,
              accountId: input.serviceAccountId,
            },
            input.reference,
          ),
      }),
  ) {
    this.policy = new SharedMcpPolicy(storage.hostId, storage)
  }

  list(): SharedMcpManagement {
    const state = this.policy.snapshot()
    return {
      hostId: this.storage.hostId,
      credentialStore: this.credentials.status(),
      accounts: state.accounts,
      connections: state.connections.map((connection) => {
        const check = this.checks.get(connection.id)
        return {
          connection,
          status: !connection.enabled
            ? 'disabled'
            : check?.revision === connection.revision
              ? check.status
              : 'not-connected',
          checkedAt: check?.checkedAt ?? null,
          ...(check?.revision === connection.revision ? { reason: check.reason, toolCount: check.toolCount } : {}),
        }
      }),
      readiness: this.readiness(state),
      uncertainCalls: this.storage.outcomes().filter((call) => call.outcome === 'unknown').length,
    }
  }

  /** The connections that could reach a login: enabled and offered for its provider. */
  private applicable(state: SharedMcpPolicyState, provider: SharedMcpProviderAccount['provider']) {
    return state.connections.filter((connection) => connection.enabled && connection.providers.includes(provider))
  }

  /** Readiness per set-up login, from the last verified catalog and the approvals; nothing is contacted here. */
  private readiness(state: SharedMcpPolicyState): SharedMcpAccountReadiness[] {
    return state.accounts.map((account) => {
      const connections = this.applicable(state, account.provider).map((connection) => {
        const check = this.checks.get(connection.id)
        const current = check?.revision === connection.revision ? check : undefined
        const inspection = this.inspections.get(connection.id)
        let status: SharedMcpAccountReadiness['status'] = 'not-checked'
        if (current?.status === 'sign-in-required' || current?.status === 'insufficient-permission')
          status = 'sign-in-required'
        else if (current?.status === 'unsupported') status = 'unsupported'
        else if (current?.status === 'connected' && inspection?.revision === connection.revision)
          status = this.policy.hasApproval(
            account.provider,
            account.accountId,
            connection.id,
            inspection.catalogRevision,
          )
            ? 'ready'
            : 'approval-needed'
        return { connectionId: connection.id, name: connection.name, status, checkedAt: current?.checkedAt ?? null }
      })
      const order: SharedMcpAccountReadiness['status'][] = [
        'sign-in-required',
        'approval-needed',
        'unsupported',
        'not-checked',
        'ready',
      ]
      const worst = connections.length
        ? order.find((status) => connections.some((entry) => entry.status === status))!
        : 'unsupported'
      const reasons: Record<SharedMcpAccountReadiness['status'], string> = {
        ready: 'Every shared connection for this login is checked and approved.',
        'approval-needed': 'Review access for this login on a connection.',
        'sign-in-required': 'A connection needs its service sign-in before this login can use it.',
        unsupported: 'No shared connection is enabled for this provider.',
        'not-checked': 'A connection has not been checked since Ramu started or changed it.',
      }
      const times = connections.flatMap((entry) => (entry.checkedAt === null ? [] : [entry.checkedAt]))
      return {
        provider: account.provider,
        accountId: account.accountId,
        status: worst,
        checkedAt: times.length ? Math.max(...times) : null,
        reason: reasons[worst],
        connections: connections.map(({ connectionId, name, status }) => ({ connectionId, name, status })),
      }
    })
  }

  /** Check every connection a login could use again, one at a time; a failure is kept as that connection's status. */
  async recheckAccount(provider: SharedMcpProviderAccount['provider'], accountId: string, projectId: string | null) {
    const state = this.policy.snapshot()
    if (!state.accounts.some((entry) => entry.provider === provider && entry.accountId === accountId))
      throw new Error('Unknown provider account')
    for (const connection of this.applicable(state, provider)) {
      const scoped =
        connection.scope.hostWide || (projectId !== null && connection.scope.projectIds.includes(projectId))
      try {
        await this.check(connection.id, {
          provider,
          accountId,
          projectId: scoped ? projectId : (connection.scope.projectIds[0] ?? null),
        })
      } catch {
        // check() recorded the failure on the connection, which the readiness above reports.
      }
    }
    this.changed()
    return this.readiness(this.policy.snapshot())
  }

  save(input: Omit<SharedMcpConnection, 'id' | 'hostId' | 'revision'>, connectionId?: string) {
    const connection = this.policy.saveConnection(input, connectionId)
    this.inspections.delete(connection.id)
    void this.release(connection.id)
    this.changed()
    return connection
  }

  saveAccount(account: SharedMcpProviderAccount) {
    this.policy.saveAccount(account)
    this.changed()
  }

  /** Removing a provider account takes it out of shared approvals for every new invocation. */
  removeAccount(provider: SharedMcpProviderAccount['provider'], accountId: string) {
    this.policy.removeAccount(provider, accountId)
    this.changed()
  }

  async verifyCredentialStore() {
    try {
      await this.credentials.verify(this.storage.hostId)
      return this.credentials.status()
    } finally {
      this.changed()
    }
  }

  private connection(id: string) {
    const connection = this.policy.snapshot().connections.find((entry) => entry.id === id)
    if (!connection) throw new Error('Unknown Shared MCP connection')
    return connection
  }

  private async release(id: string) {
    this.epochs.delete(id)
    clearTimeout(this.idle.get(id))
    this.idle.delete(id)
    const gateway = this.management.get(id)
    this.management.delete(id)
    const check = this.checks.get(id)
    if (check) this.checks.set(id, { ...check, status: 'not-connected' })
    await gateway?.close()
  }

  async check(connectionId: string, selection: SharedMcpSelection): Promise<SharedMcpInspection> {
    if (this.closed) throw new Error('Shared MCP management is closed')
    if (this.busy.has(connectionId)) throw new Error('This connection is already being checked')
    const connection = this.connection(connectionId)
    this.busy.add(connectionId)
    const epoch = Symbol()
    try {
      await this.release(connectionId)
      if (this.closed) throw new Error('Shared MCP management is closed')
      this.epochs.set(connectionId, epoch)
      this.inspections.delete(connectionId)
      this.checks.set(connectionId, { revision: connection.revision, status: 'connecting', checkedAt: null })
      this.changed()
      const session: ExternalMcpSession = {
        ...selection,
        hostId: this.storage.hostId,
        role: 'interactive',
        externalToolsAllowed: true,
        connectionIds: [connectionId],
      }
      const gateway = this.gateway(
        `setup:${connectionId}`,
        session,
        async () => false,
        () => {
          if (this.epochs.get(connectionId) !== epoch) return
          const check = this.checks.get(connectionId)
          if (check)
            this.checks.set(connectionId, {
              ...check,
              status: 'not-connected',
              reason: 'The connection closed. Check it again before reviewing access.',
            })
          this.inspections.delete(connectionId)
          this.changed()
        },
      )
      this.management.set(connectionId, gateway)
      const inspection = await gateway.inspect(connectionId)
      if (this.epochs.get(connectionId) !== epoch) throw new Error('Connection check was cancelled or changed')
      const result: SharedMcpInspection = { ...inspection, checkedAt: Date.now() }
      this.inspections.set(connectionId, result)
      this.checks.set(connectionId, {
        revision: connection.revision,
        status: 'connected',
        checkedAt: result.checkedAt,
        toolCount: result.tools.length,
      })
      this.changed()
      const timer = setTimeout(() => {
        void this.release(connectionId).finally(() => this.changed())
      }, 5 * 60_000)
      timer.unref()
      this.idle.set(connectionId, timer)
      return structuredClone(result)
    } catch (error) {
      if (this.epochs.get(connectionId) !== epoch) {
        // eslint-disable-next-line preserve-caught-error -- setup errors are sanitized at the host boundary
        throw new Error('Connection check was cancelled or changed')
      }
      await this.release(connectionId)
      this.checks.set(connectionId, {
        revision: connection.revision,
        status: error instanceof SharedMcpConnectionError ? error.status : 'failed',
        checkedAt: Date.now(),
        reason:
          error instanceof SharedMcpConnectionError
            ? error.message
            : connection.transport.type === 'http'
              ? 'Check the server URL, service sign-in and host network policy.'
              : 'Check the executable, service sign-in and selected provider account and project.',
      })
      this.changed()
      // eslint-disable-next-line preserve-caught-error -- setup errors are sanitized at the host boundary
      throw new Error(this.checks.get(connectionId)!.reason)
    } finally {
      this.busy.delete(connectionId)
    }
  }

  approve(input: Omit<SharedMcpGrant, 'id' | 'accountIds' | 'shared'> & { accountId: string }) {
    const inspection = this.inspections.get(input.connectionId)
    if (
      !inspection ||
      inspection.revision !== input.revision ||
      inspection.catalogRevision !== input.catalogRevision ||
      input.tools.some((tool) => !inspection.tools.some((available) => available.name === tool.name))
    )
      throw new Error('Check the connection and review its current tools before approving access')
    const grant = this.policy.approve(input)
    this.changed()
    return grant
  }

  async disconnect(id: string) {
    const connection = this.connection(id)
    this.policy.revokeConnection(id)
    this.inspections.delete(id)
    await this.release(id)
    const references =
      connection.transport.type === 'http' ? connection.transport.headerSecretRefs : connection.transport.envSecretRefs
    for (const reference of new Set(Object.values(references))) {
      await this.credentials.remove(
        { hostId: connection.hostId, integration: 'mcp', connectionId: id, accountId: connection.serviceAccountId },
        reference,
      )
    }
    // Do not overwrite a newer configuration saved by another local window during credential cleanup.
    const current = this.connection(id)
    if (Object.keys(references).length && current.revision === connection.revision) {
      const { id: _id, hostId: _hostId, revision: _revision, ...definition } = current
      this.policy.saveConnection(
        {
          ...definition,
          transport:
            current.transport.type === 'http'
              ? { ...current.transport, headerSecretRefs: {} }
              : { ...current.transport, envSecretRefs: {} },
        },
        id,
      )
    }
    this.changed()
  }

  async remove(id: string) {
    await this.disconnect(id)
    this.policy.removeConnection(id)
    this.changed()
  }

  gateway(
    sessionId: string,
    session: ExternalMcpSession,
    approve: ExternalMcpGatewayHost['approve'],
    closed?: () => void,
  ) {
    return new ExternalMcpGateway(sessionId, session, this.policy, {
      connect: async (...args) => {
        const client = await this.connect(...args)
        if (closed) {
          const previous = client.onclose
          client.onclose = () => {
            previous?.()
            closed()
          }
        }
        return client
      },
      record: (call) => this.storage.record(call),
      approve,
    })
  }

  async close() {
    this.closed = true
    this.epochs.clear()
    for (const timer of this.idle.values()) clearTimeout(timer)
    this.idle.clear()
    const gateways = [...this.management.values()]
    this.management.clear()
    this.checks.clear()
    await Promise.allSettled(gateways.map((gateway) => gateway.close()))
  }
}
