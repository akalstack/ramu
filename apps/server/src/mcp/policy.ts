import { createHash, randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { z } from 'zod'
import type {
  SharedMcpConnection,
  SharedMcpGrant,
  SharedMcpPolicyState,
  SharedMcpProviderAccount,
  SharedMcpAccess,
} from '@ramu/shared/mcp'

const id = z.string().min(1).max(200)
const provider = z.enum(['claude-code', 'codex', 'opencode', 'cursor', 'antigravity'])
const scope = z.strictObject({ projectIds: z.array(id).max(1000), hostWide: z.boolean() })
const secretRefs = z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_-]{0,127}$/), id)
const definition = z.strictObject({
  name: z.string().trim().min(1).max(200),
  serviceAccountId: id,
  enabled: z.boolean(),
  scope,
  providers: z.array(provider).min(1).max(5),
  transport: z.discriminatedUnion('type', [
    z.strictObject({
      type: z.literal('http'),
      url: z
        .string()
        .max(4000)
        .refine((value) => {
          try {
            const url = new URL(value)
            // URL secrets belong in the secret store, including query parameters.
            return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
          } catch {
            return false
          }
        }, 'Use an HTTPS server URL without credentials, query parameters or fragments'),
      headerSecretRefs: secretRefs,
      allowPrivateNetwork: z.boolean().optional(),
      /** A client ID the service issued to Ramu in advance, for servers that offer no dynamic registration. */
      oauthClientId: z.string().trim().min(1).max(500).optional(),
    }),
    z.strictObject({
      type: z.literal('stdio'),
      command: z.string().max(4000).refine(isAbsolute, 'Choose an absolute executable path'),
      args: z.array(z.string().max(4000)).max(100),
      cwd: z.string().max(4000).refine(isAbsolute, 'Choose an absolute working directory'),
      envSecretRefs: secretRefs,
    }),
  ]),
})
const account = z.strictObject({ provider, accountId: id, shareApprovals: z.boolean() })
const toolPermission = z.strictObject({
  name: id,
  action: z.enum(['read', 'write']),
  approval: z.enum(['always', 'connection']),
})
const grant = z.strictObject({
  id,
  connectionId: id,
  revision: id,
  catalogRevision: id,
  provider,
  accountIds: z.array(id).max(1000),
  shared: z.boolean(),
  scope,
  tools: z.array(toolPermission).max(2000),
})
const stateSchema = z.strictObject({
  connections: z.array(definition.extend({ id, hostId: id, revision: id })).max(1000),
  accounts: z.array(account).max(1000),
  grants: z.array(grant).max(10000),
})
export const sharedMcpDefinition = definition
export const sharedMcpAccount = account
export const sharedMcpSelection = z.strictObject({ provider, accountId: id, projectId: id.nullable() })
export const sharedMcpApproval = grant.omit({ id: true, accountIds: true, shared: true }).extend({ accountId: id })

/** Constructed by the execution server, never from MCP arguments or an upstream annotation. */
export interface ExternalMcpSession {
  hostId: string
  provider: SharedMcpProviderAccount['provider']
  accountId: string
  projectId: string | null
  role: 'interactive' | 'restricted' | 'background'
  /** An explicit role policy may permit a particular background session. */
  externalToolsAllowed: boolean
  /** undefined inherits project policy; [] denies all connections. */
  connectionIds?: string[]
}

export interface SharedMcpPolicyStorage {
  load(): unknown
  /** Must durably replace the whole record atomically; failure leaves live policy unchanged. */
  save(state: SharedMcpPolicyState): void
}

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`
  return JSON.stringify(value) ?? 'null'
}

/** Descriptive upstream hints never authorize calls. Hash actual schemas/capabilities, not display names. */
export const sharedMcpCatalogRevision = (catalog: unknown): string =>
  createHash('sha256').update(canonical(catalog)).digest('hex')

let identityAllows: (connectionId: string, projectId: string | null) => boolean = () => true

/** A server put in one identity reaches only that identity's projects; one for every identity reaches all. */
export function setConnectionIdentityScope(allow: typeof identityAllows) {
  identityAllows = allow
}

/** Whether a connection reaches a project: its own scope, and the identity it was put in. */
export const connectionApplies = (connection: Pick<SharedMcpConnection, 'id' | 'scope'>, projectId: string | null) =>
  (connection.scope.hostWide || (projectId !== null && connection.scope.projectIds.includes(projectId))) &&
  identityAllows(connection.id, projectId)

const applies = (value: SharedMcpConnection['scope'], projectId: string | null) =>
  value.hostWide || (projectId !== null && value.projectIds.includes(projectId))
const subset = (narrow: SharedMcpConnection['scope'], wide: SharedMcpConnection['scope']) =>
  wide.hostWide || (!narrow.hostWide && narrow.projectIds.every((project) => wide.projectIds.includes(project)))
const sameAccount = (a: SharedMcpProviderAccount, b: Pick<ExternalMcpSession, 'provider' | 'accountId'>) =>
  a.provider === b.provider && a.accountId === b.accountId

/** Host-owned approval state. It deliberately cannot connect transports, read secrets or execute tools. */
export class SharedMcpPolicy {
  private state: SharedMcpPolicyState

  constructor(
    private readonly hostId: string,
    private readonly storage: SharedMcpPolicyStorage,
  ) {
    const saved = storage.load()
    // Corrupt/unknown persisted policy must not silently become trusted access.
    this.state = stateSchema.parse(saved ?? { connections: [], accounts: [], grants: [] })
    if (this.state.connections.some((connection) => connection.hostId !== hostId))
      throw new Error('Shared MCP policy belongs to another host')
    for (const [label, values] of [
      ['connection', this.state.connections.map((value) => value.id)],
      ['grant', this.state.grants.map((value) => value.id)],
      ['account', this.state.accounts.map((value) => `${value.provider}:${value.accountId}`)],
    ] as const)
      if (new Set(values).size !== values.length) throw new Error(`Duplicate Shared MCP ${label}`)
  }

  snapshot(): SharedMcpPolicyState {
    return structuredClone(this.state)
  }

  private commit(next: SharedMcpPolicyState) {
    const parsed = stateSchema.parse(next)
    this.storage.save(structuredClone(parsed))
    this.state = parsed
  }

  saveConnection(input: Omit<SharedMcpConnection, 'id' | 'hostId' | 'revision'>, connectionId?: string) {
    const value = definition.parse(input)
    const previous = connectionId ? this.connection(connectionId) : undefined
    const unchanged =
      previous &&
      canonical({ ...previous, name: '', enabled: false, id: '', hostId: '', revision: '' }) ===
        canonical({ ...value, name: '', enabled: false, id: '', hostId: '', revision: '' })
    const connection: SharedMcpConnection = {
      ...value,
      id: previous?.id ?? randomUUID(),
      hostId: this.hostId,
      revision: unchanged ? previous.revision : randomUUID(),
    }
    this.commit({
      ...this.state,
      connections: [...this.state.connections.filter((entry) => entry.id !== connection.id), connection],
      grants: this.state.grants.filter((entry) => entry.connectionId !== connection.id || unchanged),
    })
    return structuredClone(connection)
  }

  private connection(connectionId: string) {
    const connection = this.state.connections.find((entry) => entry.id === connectionId)
    if (!connection) throw new Error('Unknown Shared MCP connection')
    return connection
  }

  removeConnection(connectionId: string) {
    this.connection(connectionId)
    this.commit({
      ...this.state,
      connections: this.state.connections.filter((entry) => entry.id !== connectionId),
      grants: this.state.grants.filter((entry) => entry.connectionId !== connectionId),
    })
  }

  /** Only explicit account setup/save calls this. Provider login and quota readings never do. */
  saveAccount(input: SharedMcpProviderAccount) {
    const value = account.parse(input)
    const accounts = [...this.state.accounts.filter((entry) => !sameAccount(entry, value)), value]
    this.commit({
      ...this.state,
      accounts,
      grants: this.state.grants
        .map((entry) => {
          if (entry.provider !== value.provider) return entry
          // Opting in also shares approvals this account explicitly reviewed earlier.
          const shared = entry.shared || (value.shareApprovals && entry.accountIds.includes(value.accountId))
          if (!shared) return entry
          const members = entry.accountIds.filter((member) => member !== value.accountId)
          if (
            value.shareApprovals &&
            (entry.accountIds.includes(value.accountId) ||
              accounts.some(
                (other) =>
                  other.provider === value.provider && other.shareApprovals && members.includes(other.accountId),
              ))
          )
            members.push(value.accountId)
          return {
            ...entry,
            shared,
            accountIds: accounts
              .filter(
                (other) =>
                  other.provider === value.provider &&
                  other.shareApprovals &&
                  (members.includes(other.accountId) || (value.shareApprovals && members.includes(value.accountId))),
              )
              .map((other) => other.accountId),
          }
        })
        .filter((entry) => entry.accountIds.length),
    })
  }

  removeAccount(providerId: SharedMcpProviderAccount['provider'], accountId: string) {
    this.commit({
      ...this.state,
      accounts: this.state.accounts.filter((entry) => entry.provider !== providerId || entry.accountId !== accountId),
      grants: this.state.grants
        .map((entry) =>
          entry.provider === providerId
            ? { ...entry, accountIds: entry.accountIds.filter((member) => member !== accountId) }
            : entry,
        )
        .filter((entry) => entry.accountIds.length),
    })
  }

  /** catalogRevision must come from the verified upstream catalog the user reviewed. */
  approve(input: Omit<SharedMcpGrant, 'id' | 'accountIds' | 'shared'> & { accountId: string }) {
    const { accountId, ...reviewed } = input
    const connection = this.connection(input.connectionId)
    const owner = this.state.accounts.find((entry) => sameAccount(entry, input))
    if (!owner) throw new Error('Unknown provider account')
    if (!connection.enabled || connection.revision !== input.revision || !connection.providers.includes(input.provider))
      throw new Error('Connection changed; review Shared MCP access again')
    if (!subset(input.scope, connection.scope)) throw new Error('Approval cannot broaden connection scope')
    const accountIds = owner.shareApprovals
      ? this.state.accounts
          .filter((entry) => entry.provider === input.provider && entry.shareApprovals)
          .map((entry) => entry.accountId)
      : [accountId]
    const approved = grant.parse({ ...reviewed, id: randomUUID(), accountIds, shared: owner.shareApprovals })
    this.commit({ ...this.state, grants: [...this.state.grants, approved] })
    return structuredClone(approved)
  }

  revoke(grantId: string) {
    this.commit({ ...this.state, grants: this.state.grants.filter((entry) => entry.id !== grantId) })
  }

  revokeConnection(connectionId: string) {
    this.connection(connectionId)
    this.commit({ ...this.state, grants: this.state.grants.filter((entry) => entry.connectionId !== connectionId) })
  }

  access(session: ExternalMcpSession, connectionId: string, catalogRevision?: string): SharedMcpAccess {
    const connection = this.connection(connectionId)
    const denied = (status: Exclude<SharedMcpAccess['status'], 'approved'>, reason: string): SharedMcpAccess => ({
      status,
      connectionId,
      reason,
    })
    if (!connection.enabled) return denied('disabled', 'Connection is disabled')
    if (
      session.hostId !== this.hostId ||
      !connectionApplies(connection, session.projectId) ||
      (session.connectionIds !== undefined && !session.connectionIds.includes(connectionId))
    )
      return denied('disabled', 'Connection is outside this session scope')
    if (session.role === 'restricted' || !session.externalToolsAllowed)
      return denied('disabled', 'External tools are not permitted for this session')
    if (!connection.providers.includes(session.provider))
      return denied('unsupported', 'Provider is not enabled for this connection')
    if (!this.state.accounts.some((entry) => sameAccount(entry, session)))
      return denied('approval-needed', 'Provider account has not been set up')
    if (!catalogRevision) return denied('not-checked', 'Verify the upstream catalog')
    if (!this.matchingGrants(session, connection, catalogRevision).length)
      return denied('approval-needed', 'Review connection access for this account and catalog')
    return { status: 'approved', connectionId, revision: connection.revision, catalogRevision }
  }

  /** Whether an approval for this login matches the connection's current revision and a verified catalog. */
  hasApproval(
    provider: SharedMcpProviderAccount['provider'],
    accountId: string,
    connectionId: string,
    catalogRevision: string,
  ) {
    const connection = this.connection(connectionId)
    return this.state.grants.some(
      (entry) =>
        entry.connectionId === connection.id &&
        entry.revision === connection.revision &&
        entry.catalogRevision === catalogRevision &&
        entry.provider === provider &&
        entry.accountIds.includes(accountId) &&
        subset(entry.scope, connection.scope),
    )
  }

  /** Whether this login was ever approved for the connection's current revision, whatever its catalog was then. */
  hasReviewedAccess(provider: SharedMcpProviderAccount['provider'], accountId: string, connectionId: string) {
    const connection = this.connection(connectionId)
    return this.state.grants.some(
      (entry) =>
        entry.connectionId === connection.id &&
        entry.revision === connection.revision &&
        entry.provider === provider &&
        entry.accountIds.includes(accountId),
    )
  }

  private matchingGrants(session: ExternalMcpSession, connection: SharedMcpConnection, catalogRevision: string) {
    return this.state.grants.filter(
      (entry) =>
        entry.connectionId === connection.id &&
        entry.revision === connection.revision &&
        entry.catalogRevision === catalogRevision &&
        entry.provider === session.provider &&
        entry.accountIds.includes(session.accountId) &&
        subset(entry.scope, connection.scope) &&
        applies(entry.scope, session.projectId),
    )
  }

  /** Call immediately before dispatch as well as discovery. Full/Auto access never bypass this check. */
  authorize(session: ExternalMcpSession, connectionId: string, catalogRevision: string, toolName: string) {
    const access = this.access(session, connectionId, catalogRevision)
    if (access.status !== 'approved') throw new Error(access.reason)
    const permissions = this.matchingGrants(session, this.connection(connectionId), catalogRevision).flatMap((entry) =>
      entry.tools.filter((tool) => tool.name === toolName),
    )
    if (!permissions.length) throw new Error('Tool is outside approved Shared MCP access')
    // An explicit per-call review cannot be bypassed by another grant's broader approval.
    return {
      action: permissions.some((tool) => tool.action === 'write') ? ('write' as const) : ('read' as const),
      requiresApproval: permissions.some((tool) => tool.approval === 'always'),
      revision: access.revision,
      catalogRevision,
    }
  }
}
