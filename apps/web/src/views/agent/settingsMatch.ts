import type { AgentSettings } from '@ramu/shared/types'

/** Whether two settings run the chat the same way, as far as the transcript's settings separator shows. */
export const settingsMatch = (a: AgentSettings, b: AgentSettings) =>
  a.provider === b.provider &&
  a.model === b.model &&
  (a.effort ?? null) === (b.effort ?? null) &&
  a.access === b.access &&
  (a.serviceTier ?? null) === (b.serviceTier ?? null)
