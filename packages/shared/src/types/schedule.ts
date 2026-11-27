import type { AgentSettings } from './agent'
import type { WebhookTrigger } from '../webhooks'

export type ScheduleRule =
  | { kind: 'once'; at: string }
  | { kind: 'daily'; time: string }
  | { kind: 'weekly'; time: string; weekdays: number[] }
  | { kind: 'monthly'; time: string; day: number }
  | { kind: 'interval'; minutes: number; anchor: string }
  | WebhookTrigger
export interface ScheduleInput {
  name: string
  prompt: string
  projectId: string
  workspaceId?: string | null
  sourceTaskId?: string | null
  timezone: string
  rule: ScheduleRule
  missedPolicy: 'latest' | 'skip'
  settings: AgentSettings
}
export interface Schedule extends ScheduleInput {
  id: string
  state: 'active' | 'paused' | 'completed'
  nextRunAt: number | null
  createdAt: number
  /** Set when repeated failures paused the schedule; cleared when it is resumed. */
  pausedReason?: string
  /** Failed runs up to this point in the run history no longer count towards pausing (set on an edit or a resume). */
  failuresAfter?: number
  /**
   * Set on a webhook schedule. Its address is a credential (anyone holding it can send requests), so it is not here,
   * where viewer devices can read it; `schedules.webhook` gives it to full-access devices.
   */
  webhook?: {
    hasSecret: boolean
    /** `owner/repo` when Ramu created the webhook on that GitHub repository. */
    github?: string
  }
}
/** One request a webhook schedule received, and what came of it. */
export interface WebhookDelivery {
  id: string
  scheduleId: string
  receivedAt: number
  /**
   * `started` queued a run; `coalesced` joined one already waiting for the same subject; `test` and `replayed` were
   * started from Ramu. The rest started nothing, and `detail` says why.
   */
  outcome:
    'started' | 'coalesced' | 'test' | 'replayed' | 'filtered' | 'duplicate' | 'bad-signature' | 'paused' | 'invalid'
  summary: string
  detail: string | null
  runId: string | null
  /** The fields the prompt received (or would have), kept so a delivery can be replayed. */
  excerpt: string
}
export interface ScheduleRun {
  id: string
  scheduleId: string
  dueAt: number
  taskId: string | null
  sessionId: string | null
  /**
   * `completed` means the run succeeded. `needs-input` waits for a person (a question, or a goal that is blocked or out of
   * turns), `cancelled` was stopped by the user, and `interrupted` was cut off by a restart or an unresumed usage limit.
   */
  status: 'queued' | 'running' | 'needs-input' | 'completed' | 'failed' | 'missed' | 'interrupted' | 'cancelled'
  attempts: number
  retryAt: number | null
  error: string | null
  createdAt: number
}
