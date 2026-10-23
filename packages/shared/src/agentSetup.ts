import type { AgentProvider } from './types/agent'

/**
 * How far a piece of setup got for one thread. A desired configuration is not proof a runtime used it:
 * `configured` is what the resolver produces now, `delivered` means Ramu handed it to the provider when the thread
 * started, `runtime-confirmed` means the runtime itself reported it, and `not-observable` marks what Ramu cannot see.
 */
export type SetupItemState =
  'configured' | 'delivered' | 'runtime-confirmed' | 'not-observable' | 'needs-refresh' | 'omitted'

export interface SetupItem {
  kind: 'rule' | 'native-mcp' | 'shared-mcp' | 'skill'
  name: string
  state: SetupItemState
  /** Why it is in this state, in one sentence of English that the client translates. */
  reason: string
  /** A shared connection the provider also loads natively; `use` is what this thread currently does about it. */
  duplicate?: { connectionId: string; use: 'native' | 'both' }
}

/** The setup the execution server resolved for one thread, built from the same resolvers a launch uses. Names only. */
export interface AgentSetupSnapshot {
  sessionId: string
  projectId: string | null
  provider: AgentProvider
  accountId: string
  generatedAt: number
  /** Characters of enabled Always rules that apply to this thread, against the per-scope limit. */
  rulesCharacters: number
  rulesLimit: number
  items: SetupItem[]
}
