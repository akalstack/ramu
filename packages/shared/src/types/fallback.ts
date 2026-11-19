import type { AgentProvider, ReasoningEffort } from './agent'

/** A provider, model, effort and service tier to continue with. */
export interface FallbackStep {
  id: string
  provider: AgentProvider
  model: string
  effort: ReasoningEffort | null
  serviceTier?: 'standard' | 'fast'
}
/** Percent of a usage window at which Ramu moves on; null waits for the limit itself. */
export type SwitchThreshold = 80 | 90 | 95 | null
export interface FallbackPreferences {
  switchAt: SwitchThreshold
  /** Models ranked best first: a chat uses the highest one with room. Unset uses the built-in Claude Code, then Codex. */
  order?: FallbackStep[]
  /**
   * Whether a thread at a usage limit continues by itself when the limit resets. A thread's own `AgentSettings.autoResume`
   * overrides it. Saved preferences without it parse as true, so there is no migration. See `effectiveAutoResume`.
   */
  autoResume: boolean
}
/**
 * Which model the helpers an agent starts run on. thread: each provider's own helpers, on the thread's model. auto: Ramu
 * runs each helper on the thread's provider with the model and effort that provider picks for its task. pick: every
 * helper runs on `step`. At a usage limit a helper follows the thread's own fallback order and threshold.
 */
export interface SubagentPreferences {
  model: 'thread' | 'auto' | 'pick'
  step: FallbackStep | null
  /** Codex only: let a hook ask Ramu before Codex's own sub-agents start. Needs a one-time trust entry in Codex's config. */
  codexHook: boolean
}
/** Ramu's advisor: a model on any provider that main chat agents can consult. While on, Claude Code's own advisor is off in Ramu's Claude chats. */
export interface AdvisorPreferences {
  enabled: boolean
  step: FallbackStep | null
  /** Agents always wait for advice; otherwise they may keep doing work the advice cannot change. */
  wait: boolean
}
export const DEFAULT_ADVISOR_PREFERENCES: AdvisorPreferences = { enabled: false, step: null, wait: false }
/** Result of an advisor request, as the agent's tool sees it. */
export interface AdviceStatus {
  requestId: string
  status: 'pending' | 'ready' | 'failed'
  advice?: string
  advisor?: string
  error?: string
  note?: string
}
export const DEFAULT_FALLBACK_PREFERENCES: FallbackPreferences = { switchAt: null, autoResume: true }
export const DEFAULT_SUBAGENT_PREFERENCES: SubagentPreferences = { model: 'thread', step: null, codexHook: false }

/**
 * Where a thread's next message would run, derived by the host from the same routing the send uses.
 * `unknown` means routing cannot be determined (no preferences or readings yet); clients must not guess.
 */
export type NextMessageRoute =
  | { state: 'unknown' }
  | { state: 'stays' }
  | {
      state: 'switch'
      provider: AgentProvider
      model: string
      accountId?: string
      reason: string
      /** The person chose to keep the current provider, so the switch will not happen until released. */
      held: 'message' | 'chat' | null
    }
