import type { AgentProvider } from './agent'

/** One plan usage window as the provider last reported it. Account-wide, not per chat. */
export interface UsageReading {
  provider: AgentProvider
  accountId?: string
  /** `quota` is a limit the provider reports without saying how long its window is. */
  window: 'five_hour' | 'weekly' | 'monthly' | 'quota'
  /** Set for a model-specific window, e.g. Claude's Opus weekly limit. */
  scope?: string
  /** 0–100. */
  usedPercent: number
  resetsAt?: number
  status: 'ok' | 'warning' | 'limited'
  plan?: string
  updatedAt: number
  /** Inferred by Ramu from a limit notice the provider printed, not reported by its usage API; it proves a limit, never room. */
  source?: 'notice'
}
