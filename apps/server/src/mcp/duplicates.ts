import type { AgentProvider } from '@ramu/shared/types'
import type { ProjectSetup } from '@ramu/shared/mcp'

/** Per chat: the Shared MCP connections whose tools are hidden because the provider already loads the same server. */
export const DUPLICATE_CHOICE_KEY = 'agent.duplicateChoice'
export type DuplicateChoices = Record<string, string[]>

/**
 * Shared connections that point at a server this provider already loads from its own configuration. Both copies would
 * reach the model, so the chat offers a choice; Ramu never edits the provider's files to settle it.
 */
export function duplicateConnectionIds(setup: ProjectSetup, provider: AgentProvider): Set<string> {
  return new Set(
    setup.mcp.flatMap((server) =>
      server.managedConnectionId && server.nativeProviders.includes(provider) ? [server.managedConnectionId] : [],
    ),
  )
}

/** The connections a chat may use once its choices apply; undefined keeps inheriting project policy. */
export function allowedConnections(choices: DuplicateChoices, sessionId: string, all: readonly { id: string }[]) {
  const native = choices[sessionId]
  return native?.length ? all.map((entry) => entry.id).filter((entry) => !native.includes(entry)) : undefined
}

/** Records one chat's choice: `native` hides the shared copy, `both` restores it. */
export function chooseDuplicate(
  choices: DuplicateChoices,
  sessionId: string,
  connectionId: string,
  use: 'native' | 'both',
) {
  const { [sessionId]: current = [], ...rest } = choices
  const next = use === 'native' ? [...new Set([...current, connectionId])] : current.filter((id) => id !== connectionId)
  return next.length ? { ...rest, [sessionId]: next } : rest
}
