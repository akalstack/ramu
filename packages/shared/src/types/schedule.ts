import type { AgentSettings } from './agent'

export type ScheduleRule =
  | { kind: 'once'; at: string }
  | { kind: 'daily'; time: string }
  | { kind: 'weekly'; time: string; weekdays: number[] }
  | { kind: 'monthly'; time: string; day: number }
  | { kind: 'interval'; minutes: number; anchor: string }
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
export interface RecapItem {
  id: string
  key: string
  group: 'attention' | 'recent'
  title: string
  detail: string
  taskId: string
  sessionId: string
  sourceSeq: number
  status: 'open' | 'done' | 'dismissed' | 'snoozed'
  snoozedUntil: number | null
  updatedAt: number
}
export interface RecapSnapshot {
  items: RecapItem[]
  generatedAt: number | null
  generating: boolean
  error: string | null
}
