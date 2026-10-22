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
  /** What the live runtime reports, when it reports anything; undefined when it cannot be asked. */
  runtimeServers?: readonly { name: string; status: string }[]
  /** Skills Ramu copies into this login's skill export for the person (names only). */
  sharedSkills: readonly string[]
  connections: readonly { name: string; status: SharedMcpAccountReadiness['status'] }[]
  now: number
}

const connectionReasons: Record<SharedMcpAccountReadiness['status'], string> = {
  ready: 'Checked and approved for this login. Thread launches do not add Shared MCP tools yet.',
  'approval-needed': 'Review access for this login in Settings → Agent setup → MCP servers.',
  'sign-in-required': 'Sign in to the service in Settings → Agent setup → MCP servers.',
  unsupported: 'This connection cannot be used from this provider.',
  'not-checked': 'Check this connection in Settings → Agent setup → MCP servers.',
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
        ? 'Changed after this thread started. It applies to a new thread; a running thread keeps what it was given.'
        : `${ruleDelivery(input.provider).detail} Whether the model followed it is not observable.`,
    })
  }
  for (const name of input.addedServers) {
    const reported = input.runtimeServers?.find((server) => server.name === name)
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
  for (const name of input.sharedSkills)
    items.push({
      kind: 'skill',
      name,
      state: 'configured',
      reason:
        "Copied into this login's skill export for new threads. Whether the model reads a skill is not observable.",
    })
  for (const connection of input.connections)
    items.push({
      kind: 'shared-mcp',
      name: connection.name,
      state: connection.status === 'ready' ? 'configured' : 'omitted',
      reason: connectionReasons[connection.status],
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
