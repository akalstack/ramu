import type { AgentProvider } from '@ramu/shared/types'
import type { SharedMcpAccountReadiness, SharedMcpConnection, SharedMcpManagement } from '@ramu/shared/mcp'

export type ConnectionAvailability =
  'shared' | 'approval-needed' | 'sign-in-required' | 'not-checked' | 'disabled' | 'unsupported'

/**
 * What one provider gets from a Shared MCP connection, with a reason in English the caller translates. Only a checked
 * catalog with a matching approval on every set-up login of that provider counts as shared; a grant, a provider
 * sign-in or a quota reading never does.
 */
export function connectionAvailability(
  connection: SharedMcpConnection,
  status: SharedMcpManagement['connections'][number]['status'],
  readiness: readonly SharedMcpAccountReadiness[] | undefined,
  provider: AgentProvider,
): { state: ConnectionAvailability; reason: string } {
  if (!connection.enabled) return { state: 'disabled', reason: 'The connection is disabled.' }
  if (!connection.providers.includes(provider))
    return { state: 'disabled', reason: 'This connection is not enabled for this provider.' }
  if (status === 'unsupported')
    return { state: 'unsupported', reason: 'This provider’s runtime cannot use this kind of server.' }
  if (status === 'sign-in-required' || status === 'insufficient-permission')
    return { state: 'sign-in-required', reason: 'Sign in to the service before any login can use it.' }
  const logins = (readiness ?? [])
    .filter((entry) => entry.provider === provider)
    .flatMap((entry) =>
      entry.connections.filter((item) => item.connectionId === connection.id).map((item) => item.status),
    )
  if (!logins.length)
    return { state: 'not-checked', reason: 'No login of this provider is set up for shared approvals yet.' }
  if (logins.includes('sign-in-required'))
    return { state: 'sign-in-required', reason: 'A login of this provider needs the service sign-in.' }
  if (logins.includes('approval-needed'))
    return { state: 'approval-needed', reason: 'Review access for a login of this provider.' }
  if (logins.includes('unsupported'))
    return { state: 'unsupported', reason: 'A login of this provider cannot use this connection.' }
  if (logins.includes('not-checked'))
    return { state: 'not-checked', reason: 'Check the connection to verify it for this provider.' }
  return { state: 'shared', reason: 'Checked and approved for every set-up login of this provider.' }
}

export const availabilityLabels: Record<ConnectionAvailability, string> = {
  shared: 'Shared',
  'approval-needed': 'Approval needed',
  'sign-in-required': 'Sign-in required',
  'not-checked': 'Not checked',
  disabled: 'Disabled',
  unsupported: 'Unsupported',
}
