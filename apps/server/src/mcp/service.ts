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
import { connectSharedMcpStdio, RESERVED_ENV } from './stdio'
import { connectSharedMcpHttp, sharedMcpHttpFetch } from './http'
import { OAUTH_REFERENCE_NAME, OAuthSignIn, revokeUpstream, type RevocationResult, type StoredOAuth } from './oauth'
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
  private signIns = new Map<string, OAuthSignIn>()
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
        write: (input, value) =>
          credentials.update(
            {
              hostId: input.hostId,
              integration: 'mcp',
              connectionId: input.connectionId,
              accountId: input.serviceAccountId,
            },
            input.reference,
            value,
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

  /** One connection's readiness for one login, from its last check at the current revision and the approvals. */
  private connectionReadiness(
    connection: SharedMcpConnection,
    provider: SharedMcpProviderAccount['provider'],
    accountId: string,
  ): { status: SharedMcpAccountReadiness['status']; checkedAt: number | null } {
    const check = this.checks.get(connection.id)
    const current = check?.revision === connection.revision ? check : undefined
    const inspection = this.inspections.get(connection.id)
    let status: SharedMcpAccountReadiness['status'] = 'not-checked'
    if (current?.status === 'sign-in-required' || current?.status === 'insufficient-permission')
      status = 'sign-in-required'
    else if (current?.status === 'unsupported') status = 'unsupported'
    else if (current?.status === 'connected' && inspection?.revision === connection.revision)
      status = this.policy.hasApproval(provider, accountId, connection.id, inspection.catalogRevision)
        ? 'ready'
        : 'approval-needed'
    return { status, checkedAt: current?.checkedAt ?? null }
  }

  /** The connections one session could reach (its provider, project and login) with their readiness. */
  sessionConnections(provider: SharedMcpProviderAccount['provider'], accountId: string, projectId: string | null) {
    return this.applicable(this.policy.snapshot(), provider)
      .filter(
        (connection) =>
          connection.scope.hostWide || (projectId !== null && connection.scope.projectIds.includes(projectId)),
      )
      .map((connection) => ({
        connectionId: connection.id,
        name: connection.name,
        ...this.connectionReadiness(connection, provider, accountId),
      }))
  }

  /**
   * What a login would lack if a chat moved onto it now, for the notice that follows a switch. A connection this login
   * was already approved for but has not been checked since Ramu started is checked again here, bounded in time, so the
   * switch is not blamed on setup that is actually fine. Everything else is reported as it stands; nothing is approved.
   */
  async destinationAttention(
    provider: SharedMcpProviderAccount['provider'],
    accountId: string,
    projectId: string | null,
    waitMs = 10_000,
  ) {
    // One deadline for the whole check, however many connections need it.
    const deadline = Date.now() + waitMs
    for (const entry of this.sessionConnections(provider, accountId, projectId)) {
      if (entry.status !== 'not-checked' || !this.policy.hasReviewedAccess(provider, accountId, entry.connectionId))
        continue
      const remaining = deadline - Date.now()
      if (remaining <= 0) break
      let timer: ReturnType<typeof setTimeout> | undefined
      await Promise.race([
        this.check(entry.connectionId, { provider, accountId, projectId }).catch(() => {}),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, remaining)
          timer.unref()
        }),
      ])
      clearTimeout(timer)
    }
    return this.sessionConnections(provider, accountId, projectId).flatMap(({ name, status, connectionId }) =>
      status === 'ready' ? [] : [{ name, status, connectionId }],
    )
  }

  /** Readiness per set-up login, from the last verified catalog and the approvals; nothing is contacted here. */
  private readiness(state: SharedMcpPolicyState): SharedMcpAccountReadiness[] {
    return state.accounts.map((account) => {
      const connections = this.applicable(state, account.provider).map((connection) => ({
        connectionId: connection.id,
        name: connection.name,
        ...this.connectionReadiness(connection, account.provider, account.accountId),
      }))
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

  private references(connection: SharedMcpConnection) {
    return connection.transport.type === 'http'
      ? connection.transport.headerSecretRefs
      : connection.transport.envSecretRefs
  }

  private scopeOf(connection: SharedMcpConnection) {
    return {
      hostId: connection.hostId,
      integration: 'mcp' as const,
      connectionId: connection.id,
      accountId: connection.serviceAccountId,
    }
  }

  save(input: Omit<SharedMcpConnection, 'id' | 'hostId' | 'revision'>, connectionId?: string) {
    const previous = connectionId ? this.connection(connectionId) : undefined
    // Credentials belong to one service account. Changing the account never carries them to another identity, so the
    // person provides the new account's own, and the old entries are deleted from the host store.
    const accountChanged = previous && previous.serviceAccountId !== input.serviceAccountId
    const connection = this.policy.saveConnection(
      accountChanged
        ? {
            ...input,
            transport:
              input.transport.type === 'http'
                ? { ...input.transport, headerSecretRefs: {} }
                : { ...input.transport, envSecretRefs: {} },
          }
        : input,
      connectionId,
    )
    if (previous && accountChanged)
      for (const reference of new Set(Object.values(this.references(previous))))
        void this.credentials.remove(this.scopeOf(previous), reference).catch(() => {})
    this.inspections.delete(connection.id)
    void this.release(connection.id)
    this.changed()
    return connection
  }

  /**
   * Write-only. The value goes straight to the host credential store under a fresh reference; the definition then
   * points at it. A failed store write leaves the working credential untouched, and the old entry is removed only
   * after the new definition is saved. Replacing a credential changes the configuration, so earlier approvals are
   * reviewed again.
   */
  async setCredential(connectionId: string, name: string, value: string) {
    const connection = this.connection(connectionId)
    if (name === OAUTH_REFERENCE_NAME) throw new Error('Sign in instead of entering this credential')
    if (!/^[A-Za-z_][A-Za-z0-9_-]{0,127}$/.test(name)) throw new Error('Use a plain name for this credential')
    const reference = await this.credentials.put(this.scopeOf(connection), value)
    const { id: _id, hostId: _hostId, revision: _revision, ...definition } = this.connection(connectionId)
    const old = this.references(connection)[name]
    try {
      this.policy.saveConnection(
        {
          ...definition,
          transport:
            definition.transport.type === 'http'
              ? {
                  ...definition.transport,
                  headerSecretRefs: { ...definition.transport.headerSecretRefs, [name]: reference },
                }
              : {
                  ...definition.transport,
                  envSecretRefs: { ...definition.transport.envSecretRefs, [name]: reference },
                },
        },
        connectionId,
      )
    } catch (error) {
      await this.credentials.remove(this.scopeOf(connection), reference).catch(() => {})
      throw error
    }
    if (old) await this.credentials.remove(this.scopeOf(connection), old).catch(() => {})
    this.inspections.delete(connectionId)
    void this.release(connectionId)
    this.changed()
  }

  /**
   * Starts an OAuth sign-in for a remote server and returns the page to open on this host. The callback listener is
   * loopback-only and bound to this connection, revision and service account; it lives only until it completes,
   * is cancelled or times out. Tokens go to the host credential store, never into settings.
   */
  async signIn(connectionId: string): Promise<{ url: string } | null> {
    if (this.closed) throw new Error('Shared MCP management is closed')
    const connection = this.connection(connectionId)
    if (connection.transport.type !== 'http') throw new Error('Sign-in applies to remote servers')
    this.signIns.get(connectionId)?.cancel()
    const transport = connection.transport
    const network = sharedMcpHttpFetch(transport.url, transport.allowPrivateNetwork === true, undefined, true)
    const scope = this.scopeOf(connection)
    const stillCurrent = () => {
      try {
        const current = this.connection(connectionId)
        return current.revision === connection.revision && current.serviceAccountId === connection.serviceAccountId
      } catch {
        return false
      }
    }
    const fail = (reason: string) => {
      if (!stillCurrent() && !this.policy.snapshot().connections.some((entry) => entry.id === connectionId)) return
      const current = this.policy.snapshot().connections.find((entry) => entry.id === connectionId)
      this.checks.set(connectionId, {
        revision: current?.revision ?? connection.revision,
        status: 'sign-in-required',
        checkedAt: Date.now(),
        reason,
      })
      this.changed()
    }
    const sign: OAuthSignIn = new OAuthSignIn({
      stillCurrent,
      serverUrl: transport.url,
      fetch: network.fetch,
      clientId: transport.oauthClientId,
      complete: async (record) => {
        const current = this.connection(connectionId)
        const reference =
          current.transport.type === 'http' ? current.transport.headerSecretRefs[OAUTH_REFERENCE_NAME] : undefined
        const value = JSON.stringify(record)
        if (reference) await this.credentials.update(scope, reference, value)
        else {
          const created = await this.credentials.put(scope, value)
          const { id: _id, hostId: _hostId, revision: _revision, ...definition } = current
          if (definition.transport.type !== 'http') throw new Error('Sign-in applies to remote servers')
          try {
            this.policy.saveConnection(
              {
                ...definition,
                transport: {
                  ...definition.transport,
                  headerSecretRefs: { ...definition.transport.headerSecretRefs, [OAUTH_REFERENCE_NAME]: created },
                },
              },
              connectionId,
            )
          } catch (error) {
            await this.credentials.remove(scope, created).catch(() => {})
            throw error
          }
        }
        this.inspections.delete(connectionId)
        await this.release(connectionId)
        const saved = this.connection(connectionId)
        this.checks.set(connectionId, {
          revision: saved.revision,
          status: 'not-connected',
          checkedAt: null,
          reason: 'Signed in. Connect to review the tools.',
        })
        this.changed()
      },
      failed: fail,
      close: () => {
        if (this.signIns.get(connectionId) === sign) this.signIns.delete(connectionId)
        void network.close()
      },
    })
    this.signIns.set(connectionId, sign)
    return sign.begin()
  }

  cancelSignIn(connectionId: string) {
    this.signIns.get(connectionId)?.cancel()
  }

  async removeCredential(connectionId: string, name: string) {
    const connection = this.connection(connectionId)
    const old = this.references(connection)[name]
    if (!old) return
    const { id: _id, hostId: _hostId, revision: _revision, ...definition } = connection
    const without = (refs: Record<string, string>) =>
      Object.fromEntries(Object.entries(refs).filter(([key]) => key !== name))
    this.policy.saveConnection(
      {
        ...definition,
        transport:
          definition.transport.type === 'http'
            ? { ...definition.transport, headerSecretRefs: without(definition.transport.headerSecretRefs) }
            : { ...definition.transport, envSecretRefs: without(definition.transport.envSecretRefs) },
      },
      connectionId,
    )
    await this.credentials.remove(this.scopeOf(connection), old).catch(() => {})
    this.inspections.delete(connectionId)
    void this.release(connectionId)
    this.changed()
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

  /**
   * Write-only: keeps one header or environment secret under a fresh reference and publishes it by saving the
   * definition, so the connection needs a new review. The previous value is deleted only after the new one is in
   * place; if any step fails the working connection is left as it was and the new value is discarded.
   */
  async setSecret(id: string, kind: 'header' | 'env', name: string, value: string) {
    const first = this.connection(id)
    this.assertSecretSlot(first, kind, name)
    const scope = {
      hostId: first.hostId,
      integration: 'mcp' as const,
      connectionId: id,
      accountId: first.serviceAccountId,
    }
    const reference = await this.credentials.put(scope, value)
    let previous: string | undefined
    try {
      const current = this.connection(id)
      if (current.revision !== first.revision) throw new Error('This connection changed. Reload it and try again.')
      previous = this.refsOf(current)[name]
      this.saveRefs(current, { ...this.refsOf(current), [name]: reference })
    } catch (error) {
      await this.credentials.remove(scope, reference).catch(() => {})
      throw error
    }
    if (previous) await this.credentials.remove(scope, previous).catch(() => {})
  }

  /** Removes one secret from the definition, then deletes the stored value. */
  async removeSecret(id: string, kind: 'header' | 'env', name: string) {
    const current = this.connection(id)
    this.assertSecretSlot(current, kind, name)
    const { [name]: reference, ...rest } = this.refsOf(current)
    if (!reference) return
    this.saveRefs(current, rest)
    await this.credentials
      .remove(
        { hostId: current.hostId, integration: 'mcp', connectionId: id, accountId: current.serviceAccountId },
        reference,
      )
      .catch(() => {})
  }

  private refsOf(connection: SharedMcpConnection) {
    return connection.transport.type === 'http'
      ? connection.transport.headerSecretRefs
      : connection.transport.envSecretRefs
  }

  private assertSecretSlot(connection: SharedMcpConnection, kind: 'header' | 'env', name: string) {
    if ((kind === 'header') !== (connection.transport.type === 'http'))
      throw new Error('This connection does not take that kind of secret')
    if (!/^[A-Za-z_][A-Za-z0-9_-]{0,127}$/.test(name)) throw new Error('Use a plain name for the secret')
    if (kind === 'env' && (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name) || RESERVED_ENV.test(name)))
      throw new Error('This environment variable is not supported for external MCP servers')
  }

  private saveRefs(connection: SharedMcpConnection, refs: Record<string, string>) {
    const { id, hostId: _host, revision: _revision, ...definition } = connection
    this.save(
      {
        ...definition,
        transport:
          connection.transport.type === 'http'
            ? { ...connection.transport, headerSecretRefs: refs }
            : { ...connection.transport, envSecretRefs: refs },
      },
      id,
    )
  }

  /**
   * Removes Ramu's credentials for a connection and tells the service to revoke the OAuth tokens it issued, when it can
   * be told. The answer says which of the two happened, so the person is never led to believe a token was revoked
   * upstream when only Ramu's copy was deleted.
   */
  async disconnect(id: string): Promise<RevocationResult> {
    const connection = this.connection(id)
    this.policy.revokeConnection(id)
    this.inspections.delete(id)
    await this.release(id)
    const upstream = await this.revokeSignIn(connection)
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
    return upstream
  }

  private async revokeSignIn(connection: SharedMcpConnection): Promise<RevocationResult> {
    if (connection.transport.type !== 'http') return 'none'
    const reference = connection.transport.headerSecretRefs[OAUTH_REFERENCE_NAME]
    if (!reference) return 'none'
    const transport = connection.transport
    const network = sharedMcpHttpFetch(transport.url, transport.allowPrivateNetwork === true, undefined, true)
    try {
      const raw = await this.credentials.read(this.scopeOf(connection), reference)
      const record = JSON.parse(raw) as StoredOAuth
      return await revokeUpstream(record, transport.url, network.fetch)
    } catch {
      return 'failed'
    } finally {
      void network.close()
    }
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
    for (const sign of [...this.signIns.values()]) sign.cancel()
    this.epochs.clear()
    for (const timer of this.idle.values()) clearTimeout(timer)
    this.idle.clear()
    const gateways = [...this.management.values()]
    this.management.clear()
    this.checks.clear()
    await Promise.allSettled(gateways.map((gateway) => gateway.close()))
  }
}
