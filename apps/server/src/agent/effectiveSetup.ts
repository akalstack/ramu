import { ruleCharacters, ruleDelivery, ruleDeliveryBlock } from '@ramu/shared/rules'
import type { AgentSetupSnapshot, SetupItem } from '@ramu/shared/agentSetup'
import { RULE_TOTAL_LIMIT, type AgentProvider, type Rule } from '@ramu/shared/types'
import type { SharedMcpAccountReadiness } from '@ramu/shared/mcp'

export interface SetupInputs {
  sessionId: string
  provider: AgentProvider
  accountId: string
  projectId: string | null
  /** When the thread started: guidance is composed once at that point. */
  startedAt: number
  rules: readonly Rule[]
  /** Servers Ramu adds to this thread's launch from the person's own configuration (names only). */
  addedServers: readonly string[]
  /** Names among `addedServers` and `sharedSkills` whose source file changed after the thread started. */
  changedSources?: readonly string[]
  /** What the live runtime reports, when it reports anything; undefined when it cannot be asked. */
  runtimeServers?: readonly { name: string; status: string }[]
  /** Skills Ramu copies into this login's skill export for the person (names only). */
  sharedSkills: readonly string[]
  connections: readonly { connectionId?: string; name: string; status: SharedMcpAccountReadiness['status'] }[]
  /** Connection ids the provider also loads from its own configuration, and the ones this thread hides. */
  duplicates?: ReadonlySet<string>
  hidden?: readonly string[]
  now: number
}

/** Ramu's own tool servers, never provider-managed. */
const INTERNAL = ['ramu', 'shared_mcp']

const PROVIDER_MANAGED =
  "Provider-managed: only this provider has this server's definition, so Ramu cannot share it with other logins. Manage it in the provider."
const PROVIDER_MANAGED_DOWN =
  "Provider-managed and not connected: only this provider has this server's definition, so Ramu cannot share or repair it. Manage it in the provider."

const DUPLICATE_BOTH =
  'This provider also loads the same server from its own configuration, so the model sees two copies. Choose one for this thread.'
const DUPLICATE_NATIVE =
  "Hidden for this thread: the provider's own copy of this server is used. Ramu did not change the provider's configuration."

function hiddenOrBoth(
  connectionId: string,
  status: SharedMcpAccountReadiness['status'],
  hidden: readonly string[],
): Pick<SetupItem, 'state' | 'reason' | 'duplicate'> {
  const native = hidden.includes(connectionId)
  return {
    state: native ? 'omitted' : status === 'ready' ? 'configured' : 'omitted',
    reason: native ? DUPLICATE_NATIVE : status === 'ready' ? DUPLICATE_BOTH : connectionReasons[status],
    duplicate: { connectionId, use: native ? 'native' : 'both' },
  }
}

const connectionReasons: Record<SharedMcpAccountReadiness['status'], string> = {
  ready:
    'Checked and approved for this login. Its approved tools reach the thread on the shared_mcp server; each call asks first.',
  'approval-needed': 'Review access for this login in Settings → Agent setup → MCP servers.',
  'sign-in-required': 'Sign in to the service in Settings → Agent setup → MCP servers.',
  unsupported: 'This connection cannot be used from this provider.',
  'not-checked': 'Check this connection in Settings → Agent setup → MCP servers.',
}

/** Servers the runtime reports that neither Ramu's launch nor a shared connection explains. */
export function providerManagedServers(
  input: Pick<SetupInputs, 'addedServers' | 'connections' | 'runtimeServers'>,
): { name: string; status: string }[] {
  const known = new Set([...input.addedServers, ...input.connections.map((connection) => connection.name), ...INTERNAL])
  return (input.runtimeServers ?? []).filter((server) => !known.has(server.name))
}

/**
 * What a thread has from Ramu's agent setup, from the same resolvers a launch uses. It lists names and states only,
 * never rule text, server addresses, headers or credentials, and never claims a runtime loaded or used something it
 * did not report.
 */
export function buildSetupSnapshot(input: SetupInputs): AgentSetupSnapshot {
  const items: SetupItem[] = []
  const reaches = (rule: Rule) =>
    rule.enabled &&
    (rule.projectId === null || rule.projectId === input.projectId) &&
    (rule.providers.length === 0 || rule.providers.includes(input.provider))
  let rulesCharacters = 0
  const reached = input.rules.filter(reaches)
  const overSize =
    ruleDeliveryBlock(
      input.provider,
      reached.filter((rule) => rule.activation === 'always').reduce((sum, rule) => sum + ruleCharacters(rule), 0),
    ) !== null
  for (const rule of reached) {
    if (rule.activation === 'manual') {
      items.push({
        kind: 'rule',
        name: rule.name,
        state: 'omitted',
        reason: 'Manual rule: kept in Settings, not sent on its own.',
      })
      continue
    }
    rulesCharacters += ruleCharacters(rule)
    if (overSize) {
      items.push({
        kind: 'rule',
        name: rule.name,
        state: 'omitted',
        reason:
          'Not sent: these rules are over the size this runtime can receive. Shorten or turn off a rule in Settings → Agent setup → Rules.',
      })
      continue
    }
    const changed = rule.updatedAt > input.startedAt
    items.push({
      kind: 'rule',
      name: rule.name,
      state: changed ? 'needs-refresh' : 'delivered',
      reason: changed
        ? ruleDelivery(input.provider).path === 'first-message'
          ? 'Changed after this thread started. The changed rules are sent with your next message.'
          : 'Changed after this thread started. It applies to a new thread; a running thread keeps what it was given.'
        : `${ruleDelivery(input.provider).detail} Whether the model followed it is not observable.`,
    })
  }
  const stale = new Set(input.changedSources ?? [])
  // Runtimes Ramu launches as runners restart on the same session with the next message; Claude keeps what it started with.
  const staleReason =
    input.provider === 'claude-code'
      ? 'The file it comes from changed after this thread started. A new thread uses the current version; this one keeps what it was given.'
      : 'The file it comes from changed after this thread started. It applies with your next message, once no work is running.'
  for (const name of input.addedServers) {
    const reported = input.runtimeServers?.find((server) => server.name === name)
    if (stale.has(`server:${name}`)) {
      items.push({ kind: 'native-mcp', name, state: 'needs-refresh', reason: staleReason })
      continue
    }
    items.push(
      reported?.status === 'connected'
        ? {
            kind: 'native-mcp',
            name,
            state: 'runtime-confirmed',
            reason: 'The runtime reports this server as connected.',
          }
        : reported
          ? {
              kind: 'native-mcp',
              name,
              state: 'configured',
              reason: 'The runtime reports this server as not connected.',
            }
          : {
              kind: 'native-mcp',
              name,
              state: 'configured',
              reason: input.runtimeServers
                ? 'Added to the launch; the runtime has not reported this server.'
                : 'Added to the launch; this runtime does not report its servers.',
            },
    )
  }
  // Servers only the provider knows (its own account connectors, plugins, managed config): Ramu cannot read a definition,
  // so it cannot share them, and it never rewrites the provider's configuration to change that.
  for (const server of providerManagedServers(input)) {
    items.push({
      kind: 'native-mcp',
      name: server.name,
      state: server.status === 'connected' ? 'runtime-confirmed' : 'configured',
      reason: server.status === 'connected' ? PROVIDER_MANAGED : PROVIDER_MANAGED_DOWN,
    })
  }
  for (const name of input.sharedSkills)
    items.push(
      stale.has(`skill:${name}`)
        ? { kind: 'skill', name, state: 'needs-refresh', reason: staleReason }
        : {
            kind: 'skill',
            name,
            state: 'configured',
            reason:
              "Copied into this login's skill export for new threads. Whether the model reads a skill is not observable.",
          },
    )
  for (const connection of input.connections)
    items.push({
      kind: 'shared-mcp',
      name: connection.name,
      ...(connection.connectionId && input.duplicates?.has(connection.connectionId)
        ? hiddenOrBoth(connection.connectionId, connection.status, input.hidden ?? [])
        : {
            state: connection.status === 'ready' ? 'configured' : 'omitted',
            reason: connectionReasons[connection.status],
          }),
    })
  return {
    sessionId: input.sessionId,
    projectId: input.projectId,
    provider: input.provider,
    accountId: input.accountId,
    generatedAt: input.now,
    rulesCharacters,
    rulesLimit: RULE_TOTAL_LIMIT,
    items,
  }
}
