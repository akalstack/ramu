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
export interface SubagentPreferences {
  /** native: each provider's own sub-agents. single: all run on one step. per-provider: a step (or native) per provider. */
  mode: 'native' | 'single' | 'per-provider'
  /** Ask the destination provider to choose for each cross-provider task. Off preserves configured routing. */
  autoSelect: 'off' | 'model-and-effort' | 'effort-only'
  maxEffort: ReasoningEffort | null
  /** Provider-qualified model keys (provider:model). Both caps apply; the lower wins. */
  modelMaxEffort: Record<string, ReasoningEffort>
  single: FallbackStep | null
  /** null means native for that provider. */
  perProvider: Partial<Record<AgentProvider, FallbackStep | null>>
  /** Optional routing by sub-agent type (Explore, Plan, …); null keeps native. Checked before the mode. */
  byType: { id: string; type: string; step: FallbackStep | null }[]
  /** same: a sub-agent falls back along the main order. separate: along its own. */
  fallback: 'same' | 'separate'
  order?: FallbackStep[]
  /** 'same' follows the main switch threshold. */
  switchAt: SwitchThreshold | 'same'
  /** Restart native sub-agents that hit a limit on the fallback chain. */
  continueNative: boolean
  /** Give each writing sub-agent its own worktree. */
  isolate: boolean
  /** Codex only: let a hook ask Ramu before Codex's own sub-agents start. Needs a one-time trust entry in Codex's config. */
  codexHook: boolean
  maxConcurrent: number
  /** Attach the parent chat's recent transcript to a sub-agent's prompt. */
  shareContext: boolean
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
export const DEFAULT_SUBAGENT_PREFERENCES: SubagentPreferences = {
  mode: 'native',
  autoSelect: 'off',
  maxEffort: null,
  modelMaxEffort: {},
  single: null,
  perProvider: {},
  byType: [],
  fallback: 'same',
  switchAt: 'same',
  continueNative: true,
  isolate: false,
  codexHook: false,
  maxConcurrent: 3,
  shareContext: false,
}
