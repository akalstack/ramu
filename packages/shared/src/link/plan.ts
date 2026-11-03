// How the desktop and the phone read an account's Ramu Link plan: the same numbers and the same next step on both.
import type { LinkPlanStatus } from './protocol'

export interface PlanSummary {
  /** Whole hours relayed this month; a started hour shows once it is complete. */
  hoursUsed: number
  hoursLimit: number | null
  outOfHours: boolean
  atHostLimit: boolean
  /** The service sells Plus and this account does not have it. */
  canGetPlus: boolean
}

export function planSummary(plan: LinkPlanStatus): PlanSummary {
  const hoursLimit = plan.relayedLimitSeconds === null ? null : Math.round(plan.relayedLimitSeconds / 3600)
  return {
    hoursUsed: Math.floor(plan.relayedSeconds / 3600),
    hoursLimit,
    outOfHours: plan.relayedLimitSeconds !== null && plan.relayedSeconds >= plan.relayedLimitSeconds,
    atHostLimit: plan.hostLimit !== null && plan.hosts >= plan.hostLimit,
    canGetPlus: plan.checkout && plan.plan !== 'plus',
  }
}
