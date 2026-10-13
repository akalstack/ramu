import { systemTimezone } from '@ramu/shared/timezone'
import { cleanLabel, clipText } from '@ramu/shared/text'
import { randomUUID } from 'node:crypto'
import { DateTime } from 'luxon'
import { z } from 'zod'
import type { Db } from './db'
import type { AgentService } from './agent'
import type { Workspace } from './workspace'
import { NO_PROJECT, type Schedule, type ScheduleInput, type ScheduleRule, type ScheduleRun } from '@ramu/shared/types'

export const settingsSchema = z.object({ provider: z.enum(['claude-code', 'codex', 'opencode', 'cursor', 'antigravity']), model: z.string().max(200), effort: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']).nullable(), serviceTier: z.enum(['standard', 'fast']).default('standard'), access: z.enum(['edits', 'auto', 'full']), autoFallback: z.boolean() })
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
const instant = z.string().refine((s) => /(?:Z|[+-]\d\d:\d\d)$/.test(s) && DateTime.fromISO(s).isValid, 'Use an ISO timestamp with an explicit offset')
export const ruleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('once'), at: instant }),
  z.object({ kind: z.literal('daily'), time }),
  z.object({ kind: z.literal('weekly'), time, weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7) }),
  z.object({ kind: z.literal('monthly'), time, day: z.number().int().min(1).max(31) }),
  z.object({ kind: z.literal('interval'), minutes: z.number().int().min(5).max(525600), anchor: instant }),
])
export const scheduleSchema = z.object({
  name: z.string().trim().min(1).max(200), prompt: z.string().trim().min(1).max(100000),
  projectId: z.string().min(1).max(100).default(NO_PROJECT), workspaceId: z.string().max(100).nullable().optional(), sourceTaskId: z.string().max(100).nullable().optional(),
  timezone: z.string().refine((zone) => DateTime.now().setZone(zone).isValid, 'Unknown timezone').default(systemTimezone), rule: ruleSchema,
  missedPolicy: z.enum(['latest', 'skip']).default('latest'), settings: settingsSchema,
})

/** Calendar rules preserve wall-clock time. DST gaps shift forward; folds use the earlier instant.
 * Monthly dates absent from a month are skipped, rather than silently moved to another day. */
export function nextOccurrence(rule: ScheduleRule, timezone: string, after: number): number | null {
  if (rule.kind === 'once') { const at = DateTime.fromISO(rule.at).toMillis(); return at > after ? at : null }
  if (rule.kind === 'interval') {
    const anchor = DateTime.fromISO(rule.anchor).toMillis(), step = rule.minutes * 60000
    return anchor + Math.max(0, Math.floor((after - anchor) / step) + 1) * step
  }
  const base = DateTime.fromMillis(after, { zone: timezone }).startOf('day')
  const [hour, minute] = rule.time.split(':').map(Number)
  for (let offset = 0; offset < 366 * 5; offset++) {
    const day = base.plus({ days: offset })
    if (rule.kind === 'weekly' && !rule.weekdays.includes(day.weekday)) continue
    if (rule.kind === 'monthly' && day.day !== rule.day) continue
    let candidate = day.set({ hour, minute, second: 0, millisecond: 0 })
    const folds = candidate.getPossibleOffsets()
    if (folds.length > 1) candidate = folds.sort((a, b) => a.toMillis() - b.toMillis())[0]!
    if (candidate.toMillis() > after) return candidate.toMillis()
  }
  return null
}
export function previewOccurrences(rule: ScheduleRule, timezone: string, after: number, count = 5): number[] {
  const result: number[] = []
  for (let i = 0; i < count; i++) { const at = nextOccurrence(rule, timezone, after); if (at === null) break; result.push(at); after = at }
  return result
}
interface ScheduleRow { id: string; data: string; state: Schedule['state']; next_run_at: number | null; created_at: number }
const mapSchedule = (r: ScheduleRow): Schedule => ({ ...JSON.parse(r.data), id: r.id, state: r.state, nextRunAt: r.next_run_at, createdAt: r.created_at })
const RUN_COLUMNS = 'id, schedule_id AS scheduleId, due_at AS dueAt, task_id AS taskId, session_id AS sessionId, status, attempts, retry_at AS retryAt, error, created_at AS createdAt'

export class ScheduleService {
  private ticking = false
  private stopping = false
  async stop(): Promise<void> { this.stopping = true; while (this.ticking) await new Promise((resolve) => setTimeout(resolve, 25)) }
  constructor(private readonly db: Db, private readonly workspace: Workspace, private readonly agents: AgentService, private readonly changed: () => void) {}
  list(): Schedule[] { return (this.db.prepare('SELECT * FROM schedules ORDER BY created_at DESC').all() as unknown as ScheduleRow[]).map(mapSchedule) }
  get(id: string): Schedule { const s = this.list().find((s) => s.id === id); if (!s) throw new Error('Unknown schedule'); return s }
  runs(id?: string): ScheduleRun[] { return this.db.prepare(`SELECT ${RUN_COLUMNS} FROM schedule_runs ${id ? 'WHERE schedule_id = ?' : ''} ORDER BY created_at DESC LIMIT 200`).all(...(id ? [id] : [])) as unknown as ScheduleRun[] }
  private validate(input: ScheduleInput): ScheduleInput {
    const parsed = scheduleSchema.parse(input)
    const value = { ...parsed, name: cleanLabel(parsed.name) }
    if (!value.name) throw new Error("A schedule's name can't be empty.")
    if (value.projectId !== NO_PROJECT && !this.workspace.listProjects().some((p) => p.id === value.projectId)) throw new Error('Unknown project')
    if (value.workspaceId && this.workspace.getWorktreeWorkspace(value.workspaceId).projectId !== value.projectId) throw new Error('Workspace belongs to another project')
    if (value.sourceTaskId) this.workspace.getTask(value.sourceTaskId)
    return value
  }
  save(input: ScheduleInput, id?: string, now = Date.now()): Schedule {
    const value = this.validate(input), old = id ? this.get(id) : null
    const at = nextOccurrence(value.rule, value.timezone, now)
    if (at === null) throw new Error('Choose a future execution time')
    const schedule: Schedule = { ...value, id: id ?? randomUUID(), state: old?.state === 'paused' ? 'paused' : 'active', nextRunAt: at, createdAt: old?.createdAt ?? now }
    this.db.prepare('INSERT INTO schedules VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data, state=excluded.state, next_run_at=excluded.next_run_at').run(schedule.id, JSON.stringify(value), schedule.state, at, schedule.createdAt)
    // Editing cancels occurrences that have not begun; an already-running chat remains independent.
    if (id) this.db.prepare("UPDATE schedule_runs SET status='missed', error='Schedule edited' WHERE schedule_id=? AND status='queued'").run(id)
    this.changed(); return schedule
  }
  pause(id: string, paused: boolean): Schedule {
    const s = this.get(id)
    const at = paused ? s.nextRunAt : nextOccurrence(s.rule, s.timezone, Date.now())
    this.db.prepare('UPDATE schedules SET state=?, next_run_at=? WHERE id=?').run(paused ? 'paused' : at === null ? 'completed' : 'active', at, id)
    if (paused) this.db.prepare("UPDATE schedule_runs SET status='missed', error='Schedule paused' WHERE schedule_id=? AND status='queued'").run(id)
    this.changed(); return this.get(id)
  }
  delete(id: string): void { this.get(id); this.db.prepare('DELETE FROM schedules WHERE id=?').run(id); this.changed() }
  runNow(id: string): ScheduleRun {
    this.get(id)
    if (this.db.prepare("SELECT 1 FROM schedule_runs WHERE schedule_id=? AND status IN ('queued','running','needs-input') LIMIT 1").get(id)) throw new Error('This schedule already has an active run')
    const run = this.enqueue(id, Date.now()); this.changed(); void this.tick(); return run
  }
  private enqueue(id: string, due: number): ScheduleRun {
    this.db.prepare("INSERT OR IGNORE INTO schedule_runs (id,schedule_id,due_at,status,created_at) VALUES (?,?,?,'queued',?)").run(randomUUID(), id, due, Date.now())
    return this.db.prepare(`SELECT ${RUN_COLUMNS} FROM schedule_runs WHERE schedule_id=? AND due_at=?`).get(id, due) as unknown as ScheduleRun
  }
  recover(): void {
    this.db.prepare("UPDATE schedule_runs SET status='interrupted', error='Background service restarted. Open the chat to inspect and continue; actions were not replayed.' WHERE status IN ('running','needs-input') AND NOT EXISTS (SELECT 1 FROM agent_recovery WHERE agent_recovery.session_id = schedule_runs.session_id)").run()
  }
  async tick(now = Date.now()): Promise<void> {
    if (this.ticking || this.stopping) return
    this.ticking = true
    try {
      for (const s of this.list()) {
        if (s.state !== 'active' || s.nextRunAt === null || s.nextRunAt > now) continue
        let latest = s.nextRunAt
        // Coalesce downtime to the latest occurrence, without flooding the agent queue.
        if (s.rule.kind === 'interval') latest += Math.floor((now - latest) / (s.rule.minutes * 60000)) * s.rule.minutes * 60000
        else if (s.rule.kind !== 'once') {
          const start = DateTime.fromMillis(now, { zone: s.timezone }).minus({ months: s.rule.kind === 'monthly' ? 2 : 0, days: s.rule.kind === 'monthly' ? 0 : 8 }).toMillis()
          let candidate = nextOccurrence(s.rule, s.timezone, Math.max(s.nextRunAt - 1, start))
          while (candidate !== null && candidate <= now) { latest = candidate; candidate = nextOccurrence(s.rule, s.timezone, candidate) }
        }
        this.db.exec('BEGIN IMMEDIATE')
        try {
          const run = this.enqueue(s.id, latest)
          if (s.missedPolicy === 'skip' && now - latest > 60000) this.db.prepare("UPDATE schedule_runs SET status='missed', error='Skipped missed occurrence' WHERE id=?").run(run.id)
          const next = nextOccurrence(s.rule, s.timezone, now)
          this.db.prepare('UPDATE schedules SET next_run_at=?, state=? WHERE id=?').run(next, next === null ? 'completed' : 'active', s.id)
          this.db.exec('COMMIT')
        } catch (error) { this.db.exec('ROLLBACK'); throw error }
        this.changed()
      }
      const queued = this.db.prepare(`SELECT ${RUN_COLUMNS} FROM schedule_runs WHERE status='queued' AND (retry_at IS NULL OR retry_at <= ?) ORDER BY due_at LIMIT 20`).all(now) as unknown as ScheduleRun[]
      for (const run of queued) {
        if (this.stopping) break
        if (this.db.prepare("SELECT 1 FROM schedule_runs WHERE schedule_id=? AND id!=? AND status IN ('running','needs-input') LIMIT 1").get(run.scheduleId, run.id)) continue
        const s = this.get(run.scheduleId)
        try {
          const task = run.taskId ? this.workspace.getTask(run.taskId) : await this.workspace.createTask({ projectId: s.projectId, title: clipText(`${s.name} · ${DateTime.fromMillis(run.dueAt, { zone: s.timezone }).toFormat('LLL d HH:mm')}`, 200), mode: s.workspaceId ? 'worktree' : 'current', workspaceId: s.workspaceId ?? undefined })
          this.db.prepare('UPDATE schedule_runs SET task_id=? WHERE id=?').run(task.id, run.id)
          const scope = this.workspace.agentScope(task.id)
          if (this.agents.activeWriter(scope.covers)) { this.db.prepare('UPDATE schedule_runs SET retry_at=?, error=? WHERE id=?').run(now + 30000, 'Waiting for the workspace agent', run.id); continue }
          await this.agents.validateSettings(s.settings)
          // Starting and recording the session are synchronous; no tick can claim this occurrence twice.
          const session = await this.agents.startReviewed(task.id, scope, s.prompt, s.settings)
          this.db.prepare("UPDATE schedule_runs SET session_id=?, status='running', attempts=attempts+1, retry_at=NULL, error=NULL WHERE id=?").run(session.id, run.id)
        } catch (error) {
          const attempts = run.attempts + 1
          this.db.prepare('UPDATE schedule_runs SET attempts=?, status=?, retry_at=?, error=? WHERE id=?').run(attempts, attempts >= 3 ? 'failed' : 'queued', attempts >= 3 ? null : now + [60000, 300000, 900000][attempts - 1]!, String(error), run.id)
        }
        this.changed()
      }
      const active = this.db.prepare(`SELECT ${RUN_COLUMNS} FROM schedule_runs WHERE session_id IS NOT NULL AND status IN ('running','needs-input')`).all() as unknown as ScheduleRun[]
      for (const run of active) {
        const session = this.agents.get(run.sessionId!)
        const status = this.agents.isRecoveryPending(session.id) ? 'running' : session.state === 'needs-input' ? 'needs-input' : session.state === 'idle' ? 'completed' : session.state === 'failed' ? 'failed' : ['stopped', 'restored'].includes(session.state) ? 'interrupted' : 'running'
        if (status !== run.status) { this.db.prepare('UPDATE schedule_runs SET status=? WHERE id=?').run(status, run.id); this.changed() }
      }
    } finally { this.ticking = false }
  }
}
