import type { AgentProvider } from './agent'

/** One plan usage window as the provider last reported it. Account-wide, not per chat. */
export interface UsageReading {
  provider: AgentProvider
  accountId?: string
  window: 'five_hour' | 'weekly' | 'monthly'
  /** Set for a model-specific window, e.g. Claude's Opus weekly limit. */
  scope?: string
  /** 0–100. */
  usedPercent: number
  resetsAt?: number
  status: 'ok' | 'warning' | 'limited'
  plan?: string
  updatedAt: number
}
