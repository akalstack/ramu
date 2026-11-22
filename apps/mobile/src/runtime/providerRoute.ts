// What the phone's composer says about the next message's provider, from the host's own answer (`agent.nextRoute`):
// the fallback it will switch to, or that the person kept the current provider. Nothing while it stays put.
import type { AgentProvider, NextMessageRoute } from '@ramu/shared/types'

export type RouteChip =
  | { kind: 'switch'; to: AgentProvider; model: string; reason: string }
  | { kind: 'keeping'; scope: 'message' | 'chat'; fallback: AgentProvider }
  | null

export function routeChip(route: NextMessageRoute | null): RouteChip {
  if (!route || route.state !== 'switch') return null
  if (route.held) return { kind: 'keeping', scope: route.held, fallback: route.provider }
  return { kind: 'switch', to: route.provider, model: route.model, reason: route.reason }
}
