import type { AgentProvider } from '@ramu/shared/types'

/**
 * What each runtime reported about the MCP transports it accepts, learned when a session opened. Shared MCP reaches a
 * runtime through Ramu's HTTP gateway, so a runtime that lists its MCP support without HTTP cannot use any shared
 * connection however healthy the upstream is. Nothing is assumed before a runtime has said so.
 */
const lacksHttp = new Set<AgentProvider>()

export function noteRuntimeTransports(provider: AgentProvider, mcp: { http?: boolean } | undefined) {
  if (mcp && mcp.http !== true) lacksHttp.add(provider)
  else lacksHttp.delete(provider)
}

export const runtimeLacksHttpMcp = (provider: AgentProvider) => lacksHttp.has(provider)
