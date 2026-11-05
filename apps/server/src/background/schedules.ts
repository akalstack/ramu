import { systemTimezone } from '@ramu/shared/workspace/timezone'
import { cleanLabel, clipText } from '@ramu/shared/text'
import { randomBytes, randomUUID } from 'node:crypto'
import { DateTime } from 'luxon'
import { z } from 'zod'
import type { Db } from '../db'
import type { AgentService } from '../agent'
import type { Workspace } from '../workspace/workspace'
import { threadOutcome } from './threadOutcome'
import {
  NO_PROJECT,
  type Schedule,
  type ScheduleInput,
  type ScheduleRule,
  type ScheduleRun,
  type WebhookDelivery,
} from '@ramu/shared/types'
import {
  MAX_WEBHOOK_FILTERS,
  WEBHOOK_PRESETS,
  describeRequest,
  excerpt,
  failedFilter,
  isWebhookPath,
  renderKey,
  sampleRequest,
  webhookPrompt,
  type WebhookRequest,
  type WebhookTrigger,
} from '@ramu/shared/webhooks'

export const settingsSchema = z.object({
  provider: z.enum(['claude-code', 'codex', 'opencode', 'cursor', 'antigravity']),
  model: z.string().max(200),
  effort: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']).nullable(),
  serviceTier: z.enum(['standard', 'fast']).default('standard'),
  access: z.enum(['edits', 'auto', 'full']),
  autoFallback: z.boolean(),
  /** Unset follows the global auto-resume setting. */
  autoResume: z.boolean().optional(),
})
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
const instant = z
  .string()
  .refine(
    (s) => /(?:Z|[+-]\d\d:\d\d)$/.test(s) && DateTime.fromISO(s).isValid,
    'Use an ISO timestamp with an explicit offset',
  )
const webhookPath = z.string().max(200).refine(isWebhookPath, 'Use a path like body.action or headers.x-github-event')
const filterText = z.string().max(300)
const webhookRuleSchema = z.object({
  kind: z.literal('webhook'),
  source: z.enum(['github', 'gitlab', 'sentry', 'generic']),
  filters: z
    .array(
      z.discriminatedUnion('op', [
        z.object({ path: webhookPath, op: z.enum(['equals', 'notEquals', 'startsWith']), value: filterText }),
        z.object({ path: webhookPath, op: z.literal('in'), value: z.array(filterText.min(1)).min(1).max(50) }),
        z.object({ path: webhookPath, op: z.literal('exists') }),
      ]),
    )
    .max(MAX_WEBHOOK_FILTERS),
  signature: z
    .discriminatedUnion('kind', [
      z.object({
        kind: z.literal('hmac'),
        header: z.string().trim().toLowerCase().min(1).max(100),
        encoding: z.enum(['hex', 'base64']),
        prefix: z.string().max(40),
      }),
      z.object({ kind: z.literal('token'), header: z.string().trim().toLowerCase().min(1).max(100) }),
    ])
    .nullable(),
  replayKey: z.string().max(300).nullable(),
  coalesceKey: z.string().max(300).nullable(),
  coalesceSeconds: z.number().int().min(10).max(3600).default(120),
  fields: z.array(webhookPath).max(40),
})
export const ruleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('once'), at: instant }),
  z.object({ kind: z.literal('daily'), time }),
  z.object({ kind: z.literal('weekly'), time, weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7) }),
  z.object({ kind: z.literal('monthly'), time, day: z.number().int().min(1).max(31) }),
  z.object({ kind: z.literal('interval'), minutes: z.number().int().min(5).max(525600), anchor: instant }),
  webhookRuleSchema,
])
export const scheduleSchema = z.object({
  name: z.string().trim().min(1).max(200),
  prompt: z.string().trim().min(1).max(100000),
  projectId: z.string().min(1).max(100).default(NO_PROJECT),
  workspaceId: z.string().max(100).nullable().optional(),
  sourceTaskId: z.string().max(100).nullable().optional(),
  timezone: z
    .string()
    .refine((zone) => DateTime.now().setZone(zone).isValid, 'Unknown timezone')
    .default(systemTimezone),
  rule: ruleSchema,
  missedPolicy: z.enum(['latest', 'skip']).default('latest'),
  settings: settingsSchema,
})

/** Calendar rules preserve wall-clock time. DST gaps shift forward; folds use the earlier instant.
 * Monthly dates absent from a month are skipped, rather than silently moved to another day. */
export function nextOccurrence(rule: ScheduleRule, timezone: string, after: number): number | null {
  if (rule.kind === 'webhook') return null
  if (rule.kind === 'once') {
    const at = DateTime.fromISO(rule.at).toMillis()
    return at > after ? at : null
  }
  if (rule.kind === 'interval') {
    const anchor = DateTime.fromISO(rule.anchor).toMillis(),
      step = rule.minutes * 60000
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
  for (let i = 0; i < count; i++) {
    const at = nextOccurrence(rule, timezone, after)
    if (at === null) break
    result.push(at)
    after = at
  }
  return result
}
interface ScheduleRow {
  id: string
  data: string
  state: Schedule['state']
  next_run_at: number | null
  created_at: number
}
/** What `data` holds beyond the schedule itself: a webhook schedule's address token and signing secret. */
interface StoredWebhook {
  webhookToken?: string
  webhookSecret?: string | null
  /** A GitHub repository webhook Ramu created for this schedule, kept current when the address changes. */
  githubHook?: import('../workspace/forge/github').RepoHook & { repoId: string }
}
/** The secret never leaves the host this way; `schedules.webhook` hands it out to someone setting up the sender. */
const mapSchedule = (r: ScheduleRow): Schedule => {
  const { webhookToken, webhookSecret, githubHook, ...data } = JSON.parse(r.data) as ScheduleInput & StoredWebhook
  return {
    ...data,
    ...(webhookToken
      ? {
          webhook: {
            hasSecret: Boolean(webhookSecret),
            ...(githubHook ? { github: `${githubHook.owner}/${githubHook.repo}` } : {}),
          },
        }
      : {}),
    id: r.id,
    state: r.state,
    nextRunAt: r.next_run_at,
    createdAt: r.created_at,
  } as Schedule
}
const newToken = () => randomBytes(24).toString('base64url')
const newSecret = () => randomBytes(32).toString('hex')

/** What a webhook-started run says, kept until the run's thread starts. */
interface RunPrompt {
  prompt: string
  title: string
  coalesceKey: string | null
  queuedAt: number
}
interface StoredDelivery extends WebhookDelivery {
  replayKey: string | null
}
/** Enough history to see what has been arriving; older deliveries drop off. */
const MAX_LOGGED_DELIVERIES = 50
/** Runs waiting behind a running one; beyond this a burst records deliveries but queues nothing more. */
const MAX_WAITING_RUNS = 5
/** How long a replay key is remembered: senders retry for hours, not days. */
const REPLAY_WINDOW_MS = 24 * 60 * 60_000
/** This many failed runs in a row pause a schedule, so a broken task stops spending runs and tokens until someone looks. */
export const MAX_CONSECUTIVE_FAILURES = 3
const RUN_COLUMNS =
  'id, schedule_id AS scheduleId, due_at AS dueAt, task_id AS taskId, session_id AS sessionId, status, attempts, retry_at AS retryAt, error, created_at AS createdAt'

const logKey = (scheduleId: string) => `webhook-log:${scheduleId}`
const promptKey = (runId: string) => `schedule-run-prompt:${runId}`

export class ScheduleService {
  /** The host's addresses a sender could reach, set by the server once its routes are known. */
  webhookBases: () => { url: string; via: string }[] = () => []
  private ticking = false
  private stopping = false
  async stop(): Promise<void> {
    this.stopping = true
    while (this.ticking) await new Promise((resolve) => setTimeout(resolve, 25))
  }
  constructor(
    private readonly db: Db,
    private readonly workspace: Workspace,
    private readonly agents: AgentService,
    private readonly changed: () => void,
    /** A run gave up (three failed starts) before any thread existed, so no thread event can announce it. Called once per run. */
    private readonly startFailed?: (run: ScheduleRun) => void,
  ) {}
  list(): Schedule[] {
    return (this.db.prepare('SELECT * FROM schedules ORDER BY created_at DESC').all() as unknown as ScheduleRow[]).map(
      mapSchedule,
    )
  }
  private find(id: string): Schedule | null {
    const row = this.db.prepare('SELECT * FROM schedules WHERE id = ?').get(id) as unknown as ScheduleRow | undefined
    return row ? mapSchedule(row) : null
  }
  get(id: string): Schedule {
    const schedule = this.find(id)
    if (!schedule) throw new Error('Unknown schedule')
    return schedule
  }
  /** Whether a schedule started this agent session; its thread belongs to a run. */
  hasSession(sessionId: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM schedule_runs WHERE session_id=? LIMIT 1').get(sessionId))
  }
  runs(id?: string): ScheduleRun[] {
    return this.db
      .prepare(
        `SELECT ${RUN_COLUMNS} FROM schedule_runs ${id ? 'WHERE schedule_id = ?' : ''} ORDER BY created_at DESC LIMIT 200`,
      )
      .all(...(id ? [id] : [])) as unknown as ScheduleRun[]
  }
  private validate(input: ScheduleInput): ScheduleInput {
    const parsed = scheduleSchema.parse(input)
    const value = { ...parsed, name: cleanLabel(parsed.name) }
    if (!value.name) throw new Error("A schedule's name can't be empty.")
    if (value.projectId !== NO_PROJECT && !this.workspace.listProjects().some((p) => p.id === value.projectId))
      throw new Error('Unknown project')
    if (value.workspaceId && this.workspace.getWorktreeWorkspace(value.workspaceId).projectId !== value.projectId)
      throw new Error('Workspace belongs to another project')
    if (value.sourceTaskId) this.workspace.getTask(value.sourceTaskId)
    return value
  }
  save(input: ScheduleInput, id?: string, now = Date.now()): Schedule {
    const value = this.validate(input),
      old = id ? this.get(id) : null
    const at = nextOccurrence(value.rule, value.timezone, now)
    const webhook = value.rule.kind === 'webhook'
    if (at === null && !webhook) throw new Error('Choose a future execution time')
    // An edit keeps the address senders already have; a secret is made once a signature is chosen.
    const stored = old ? this.stored(old.id) : {}
    const keys: StoredWebhook = webhook
      ? {
          webhookToken: stored.webhookToken ?? newToken(),
          webhookSecret:
            value.rule.kind === 'webhook' && value.rule.signature ? (stored.webhookSecret ?? newSecret()) : null,
        }
      : {}
    // An edit may be the fix for what failed, so earlier failures stop counting; a pause and its reason stay until resumed.
    const extras = {
      failuresAfter: this.lastRunMark(),
      ...(old?.state === 'paused' && old.pausedReason ? { pausedReason: old.pausedReason } : {}),
    }
    const schedule: Schedule = {
      ...value,
      ...extras,
      id: id ?? randomUUID(),
      state: old?.state === 'paused' ? 'paused' : 'active',
      nextRunAt: at,
      createdAt: old?.createdAt ?? now,
    }
    this.db
      .prepare(
        'INSERT INTO schedules VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data, state=excluded.state, next_run_at=excluded.next_run_at',
      )
      .run(schedule.id, JSON.stringify({ ...value, ...extras, ...keys }), schedule.state, at, schedule.createdAt)
    // Editing cancels occurrences that have not begun; an already-running chat remains independent.
    if (id)
      this.db
        .prepare(
          "UPDATE schedule_runs SET status='missed', error='Schedule edited' WHERE schedule_id=? AND status='queued'",
        )
        .run(id)
    this.changed()
    return this.get(schedule.id)
  }
  private threadExists(taskId: string): boolean {
    try {
      this.workspace.getTask(taskId)
      return true
    } catch {
      return false
    }
  }

  /** Runs still marked live whose thread is gone are over: they cannot finish and must not hold the schedule. */
  private settleOrphanRuns(scheduleId: string): void {
    const live = this.db
      .prepare(
        "SELECT id, task_id AS taskId FROM schedule_runs WHERE schedule_id=? AND status IN ('running','needs-input')",
      )
      .all(scheduleId) as { id: string; taskId: string | null }[]
    for (const run of live)
      if (run.taskId && !this.threadExists(run.taskId))
        this.db.prepare("UPDATE schedule_runs SET status='cancelled', error='Thread deleted' WHERE id=?").run(run.id)
  }

  /** Remembers (or with null forgets) the repository webhook made for a schedule. */
  setGithubHook(id: string, hook: StoredWebhook['githubHook'] | null): void {
    this.patchData(id, { githubHook: hook ?? undefined })
    this.changed()
  }
  githubHook(id: string): StoredWebhook['githubHook'] | null {
    return this.stored(id).githubHook ?? null
  }
  private stored(id: string): StoredWebhook {
    const row = this.db.prepare('SELECT data FROM schedules WHERE id = ?').get(id) as { data: string } | undefined
    return row ? (JSON.parse(row.data) as StoredWebhook) : {}
  }
  pause(id: string, paused: boolean): Schedule {
    const s = this.get(id)
    const at = paused ? s.nextRunAt : nextOccurrence(s.rule, s.timezone, Date.now())
    // A webhook schedule has no next time, and resuming makes it listen again rather than complete.
    const state = paused ? 'paused' : at === null && s.rule.kind !== 'webhook' ? 'completed' : 'active'
    this.db.prepare('UPDATE schedules SET state=?, next_run_at=? WHERE id=?').run(state, at, id)
    // A resume starts the failure count again and drops the reason it was paused for.
    if (!paused) this.patchData(id, { pausedReason: undefined, failuresAfter: this.lastRunMark() })
    if (paused)
      this.db
        .prepare(
          "UPDATE schedule_runs SET status='missed', error='Schedule paused' WHERE schedule_id=? AND status='queued'",
        )
        .run(id)
    this.changed()
    return this.get(id)
  }
  /** A point in the run history: failed runs up to here no longer count towards pausing. */
  private lastRunMark(): number {
    return (this.db.prepare('SELECT COALESCE(MAX(rowid), 0) AS mark FROM schedule_runs').get() as { mark: number }).mark
  }
  private patchData(
    id: string,
    patch: Partial<Pick<Schedule, 'pausedReason' | 'failuresAfter'> & StoredWebhook>,
  ): void {
    const row = this.db.prepare('SELECT data FROM schedules WHERE id = ?').get(id) as { data: string } | undefined
    if (row)
      this.db
        .prepare('UPDATE schedules SET data=? WHERE id=?')
        .run(JSON.stringify({ ...JSON.parse(row.data), ...patch }), id)
  }
  /** Pauses an active schedule once its last runs have all failed; successes break the count, other endings do not add to it. */
  private pauseAfterFailures(scheduleId: string): void {
    const schedule = this.find(scheduleId)
    if (schedule?.state !== 'active') return
    const since = schedule.failuresAfter ?? 0
    const recent = this.db
      .prepare(
        "SELECT status, error FROM schedule_runs WHERE schedule_id=? AND rowid>? AND status IN ('completed','failed') ORDER BY due_at DESC LIMIT ?",
      )
      .all(scheduleId, since, MAX_CONSECUTIVE_FAILURES) as { status: string; error: string | null }[]
    if (recent.length < MAX_CONSECUTIVE_FAILURES || recent.some((run) => run.status !== 'failed')) return
    this.pause(scheduleId, true)
    const last = recent[0]!.error ? ` Last error: ${clipText(recent[0]!.error.replace(/\s+/g, ' '), 200)}` : ''
    this.patchData(scheduleId, {
      pausedReason: `Paused after ${MAX_CONSECUTIVE_FAILURES} failed runs in a row.${last}`,
    })
    this.changed()
  }
  delete(id: string): void {
    this.get(id)
    const runs = this.db.prepare('SELECT id FROM schedule_runs WHERE schedule_id=?').all(id) as { id: string }[]
    for (const run of runs) this.db.prepare('DELETE FROM app_state WHERE key=?').run(promptKey(run.id))
    this.db.prepare('DELETE FROM app_state WHERE key=?').run(logKey(id))
    this.db.prepare('DELETE FROM schedules WHERE id=?').run(id)
    this.changed()
  }

  // Webhooks. A request arrives with its address token, already read and size-checked by the host; the signature is
  // checked here because only the schedule knows its secret.

  /** The schedule a token belongs to, with its secret; null for an unknown token. */
  webhookTarget(token: string): { schedule: Schedule; secret: string | null } | null {
    for (const row of this.db
      .prepare("SELECT * FROM schedules WHERE json_extract(data, '$.webhookToken') = ?")
      .all(token) as unknown as ScheduleRow[]) {
      const schedule = mapSchedule(row)
      if (schedule.rule.kind === 'webhook') return { schedule, secret: this.stored(row.id).webhookSecret ?? null }
    }
    return null
  }
  /** The schedule's address on every route, and its secret for pasting into the sender. */
  webhook(id: string): { path: string; urls: { url: string; via: string }[]; secret: string | null } {
    if (this.get(id).rule.kind !== 'webhook') throw new Error('This schedule does not start from webhooks')
    const stored = this.stored(id)
    const path = `/hooks/${stored.webhookToken}`
    return {
      path,
      urls: this.webhookBases().map((base) => ({ url: `${base.url.replace(/\/$/, '')}${path}`, via: base.via })),
      secret: stored.webhookSecret ?? null,
    }
  }
  rotateWebhook(id: string): Schedule {
    const schedule = this.get(id)
    if (schedule.rule.kind !== 'webhook') throw new Error('This schedule does not start from webhooks')
    this.patchData(id, { webhookToken: newToken(), webhookSecret: schedule.rule.signature ? newSecret() : null })
    this.changed()
    return this.get(id)
  }
  setWebhookSecret(id: string, secret: string | null): Schedule {
    const schedule = this.get(id)
    if (schedule.rule.kind !== 'webhook') throw new Error('This schedule does not start from webhooks')
    if (secret !== null && !schedule.rule.signature) throw new Error('Choose how the sender signs requests first')
    this.patchData(id, { webhookSecret: secret })
    this.changed()
    return this.get(id)
  }
  deliveries(id: string): WebhookDelivery[] {
    this.get(id)
    return this.log(id).map(({ replayKey: _replayKey, ...delivery }) => delivery)
  }
  private log(id: string): StoredDelivery[] {
    return this.workspace.getAppState<StoredDelivery[]>(logKey(id), [])
  }
  private record(delivery: StoredDelivery): WebhookDelivery {
    this.workspace.setAppState(
      logKey(delivery.scheduleId),
      [delivery, ...this.log(delivery.scheduleId)].slice(0, MAX_LOGGED_DELIVERIES),
    )
    this.changed()
    const { replayKey: _replayKey, ...shown } = delivery
    return shown
  }

  /**
   * Decides what one request does: filters, repeats, age and a burst for the same subject are checked in that order,
   * and every request is logged with its outcome. `signed` is false when the signature did not check out.
   */
  deliver(schedule: Schedule, request: WebhookRequest, options: { signed: boolean; now?: number }): WebhookDelivery {
    const rule = schedule.rule as WebhookTrigger
    const now = options.now ?? Date.now()
    const summary = clipText(describeRequest(rule.source, request), 200)
    const base = {
      id: randomUUID(),
      scheduleId: schedule.id,
      receivedAt: now,
      summary,
      runId: null,
      excerpt: excerpt(request, rule.fields),
      replayKey: rule.replayKey ? renderKey(rule.replayKey, request) : null,
    }
    const skip = (outcome: WebhookDelivery['outcome'], detail: string) => this.record({ ...base, outcome, detail })
    if (!options.signed) return skip('bad-signature', 'The signature did not match the secret. Nothing ran.')
    const failed = failedFilter(request, rule.filters)
    if (failed)
      return skip(
        'filtered',
        `${failed.path} ${failed.op}${'value' in failed ? ` ${Array.isArray(failed.value) ? failed.value.join(', ') : failed.value}` : ''} did not match.`,
      )
    if (
      base.replayKey &&
      this.log(schedule.id).some(
        (entry) =>
          entry.replayKey === base.replayKey &&
          now - entry.receivedAt < REPLAY_WINDOW_MS &&
          entry.outcome !== 'bad-signature',
      )
    )
      return skip('duplicate', 'The sender sent this delivery again; it already arrived.')
    if (schedule.state !== 'active') return skip('paused', 'The schedule is paused.')
    return this.queueFromDelivery(schedule, request, base, 'started', now)
  }

  /** Queues a run for a delivery, or folds it into a run still waiting for the same subject. */
  private queueFromDelivery(
    schedule: Schedule,
    request: WebhookRequest,
    base: Omit<StoredDelivery, 'outcome' | 'detail'>,
    outcome: 'started' | 'test' | 'replayed',
    now: number,
    requestExcerpt = base.excerpt,
  ): WebhookDelivery {
    const rule = schedule.rule as WebhookTrigger
    const coalesceKey = rule.coalesceKey ? renderKey(rule.coalesceKey, request) : null
    const prompt: RunPrompt = {
      prompt: webhookPrompt(
        schedule.prompt,
        base.summary,
        requestExcerpt,
        DateTime.fromMillis(base.receivedAt, { zone: schedule.timezone }).toFormat('LLL d HH:mm'),
      ),
      title: clipText(`${schedule.name} · ${base.summary}`, 200),
      coalesceKey,
      queuedAt: now,
    }
    const waiting = this.db
      .prepare(
        `SELECT ${RUN_COLUMNS} FROM schedule_runs WHERE schedule_id=? AND status='queued' AND task_id IS NULL ORDER BY due_at`,
      )
      .all(schedule.id) as unknown as ScheduleRun[]
    if (coalesceKey && outcome === 'started') {
      const same = waiting.find((run) => {
        const queued = this.workspace.getAppState<RunPrompt | null>(promptKey(run.id), null)
        return queued?.coalesceKey === coalesceKey && now - queued.queuedAt < rule.coalesceSeconds * 1000
      })
      if (same) {
        // The latest request describes the subject best, so the waiting run takes its prompt.
        this.workspace.setAppState(promptKey(same.id), { ...prompt, queuedAt: now })
        return this.record({
          ...base,
          outcome: 'coalesced',
          detail: 'Joined a run already waiting for the same subject.',
          runId: same.id,
        })
      }
    }
    if (waiting.length >= MAX_WAITING_RUNS)
      return this.record({
        ...base,
        outcome: 'paused',
        detail: `${MAX_WAITING_RUNS} runs are already waiting. Replay it once they finish.`,
      })
    let due = now
    while (this.db.prepare('SELECT 1 FROM schedule_runs WHERE schedule_id=? AND due_at=?').get(schedule.id, due)) due++
    const runId = randomUUID()
    this.db
      .prepare("INSERT INTO schedule_runs (id,schedule_id,due_at,status,created_at) VALUES (?,?,?,'queued',?)")
      .run(runId, schedule.id, due, now)
    this.workspace.setAppState(promptKey(runId), prompt)
    const delivery = this.record({ ...base, outcome, detail: null, runId })
    void this.tick()
    return delivery
  }

  replay(id: string, deliveryId: string, now = Date.now()): WebhookDelivery {
    const schedule = this.get(id)
    const original = this.log(id).find((entry) => entry.id === deliveryId)
    if (!original || schedule.rule.kind !== 'webhook') throw new Error('That delivery is no longer in the log')
    // The log keeps only the excerpt, so the replay runs on what the agent would have read.
    return this.queueFromDelivery(
      schedule,
      { headers: {}, body: {} },
      { ...original, id: randomUUID(), receivedAt: now, runId: null, replayKey: null },
      'replayed',
      now,
      original.excerpt,
    )
  }

  sendTest(id: string, now = Date.now()): WebhookDelivery {
    const schedule = this.get(id)
    const rule = schedule.rule
    if (rule.kind !== 'webhook') throw new Error('This schedule does not start from webhooks')
    const preset = WEBHOOK_PRESETS.find((entry) => entry.source === rule.source) ?? WEBHOOK_PRESETS.at(-1)!
    const request = sampleRequest({
      ...preset,
      filters: rule.filters,
      fields: rule.fields.length ? rule.fields : preset.fields,
    })
    return this.queueFromDelivery(
      schedule,
      request,
      {
        id: randomUUID(),
        scheduleId: id,
        receivedAt: now,
        summary: `Test · ${describeRequest(rule.source, request)}`,
        runId: null,
        excerpt: excerpt(request, rule.fields),
        replayKey: null,
      },
      'test',
      now,
    )
  }
  runNow(id: string): ScheduleRun {
    this.get(id)
    if (
      this.db
        .prepare(
          "SELECT 1 FROM schedule_runs WHERE schedule_id=? AND status IN ('queued','running','needs-input') LIMIT 1",
        )
        .get(id)
    )
      throw new Error('This schedule already has an active run')
    const run = this.enqueue(id, Date.now())
    this.changed()
    void this.tick()
    return run
  }
  private enqueue(id: string, due: number): ScheduleRun {
    this.db
      .prepare(
        "INSERT OR IGNORE INTO schedule_runs (id,schedule_id,due_at,status,created_at) VALUES (?,?,?,'queued',?)",
      )
      .run(randomUUID(), id, due, Date.now())
    return this.db
      .prepare(`SELECT ${RUN_COLUMNS} FROM schedule_runs WHERE schedule_id=? AND due_at=?`)
      .get(id, due) as unknown as ScheduleRun
  }
  recover(): void {
    this.db
      .prepare(
        "UPDATE schedule_runs SET status='interrupted', error='Background service restarted. Open the thread to inspect and continue; actions were not replayed.' WHERE status IN ('running','needs-input') AND NOT EXISTS (SELECT 1 FROM agent_recovery WHERE agent_recovery.session_id = schedule_runs.session_id)",
      )
      .run()
  }
  private outcome(run: ScheduleRun): { status: ScheduleRun['status']; error: string | null } {
    return threadOutcome(this.db, this.agents, run.sessionId!)
  }
  async tick(now = Date.now()): Promise<void> {
    if (this.ticking || this.stopping) return
    this.ticking = true
    try {
      for (const s of this.list()) {
        if (s.state !== 'active' || s.nextRunAt === null || s.nextRunAt > now) continue
        let latest = s.nextRunAt
        // Coalesce downtime to the latest occurrence, without flooding the agent queue.
        if (s.rule.kind === 'interval')
          latest += Math.floor((now - latest) / (s.rule.minutes * 60000)) * s.rule.minutes * 60000
        else if (s.rule.kind !== 'once') {
          const start = DateTime.fromMillis(now, { zone: s.timezone })
            .minus({ months: s.rule.kind === 'monthly' ? 2 : 0, days: s.rule.kind === 'monthly' ? 0 : 8 })
            .toMillis()
          let candidate = nextOccurrence(s.rule, s.timezone, Math.max(s.nextRunAt - 1, start))
          while (candidate !== null && candidate <= now) {
            latest = candidate
            candidate = nextOccurrence(s.rule, s.timezone, candidate)
          }
        }
        this.db.exec('BEGIN IMMEDIATE')
        try {
          const run = this.enqueue(s.id, latest)
          if (s.missedPolicy === 'skip' && now - latest > 60000)
            this.db
              .prepare("UPDATE schedule_runs SET status='missed', error='Skipped missed occurrence' WHERE id=?")
              .run(run.id)
          const next = nextOccurrence(s.rule, s.timezone, now)
          this.db
            .prepare('UPDATE schedules SET next_run_at=?, state=? WHERE id=?')
            .run(next, next === null ? 'completed' : 'active', s.id)
          this.db.exec('COMMIT')
        } catch (error) {
          this.db.exec('ROLLBACK')
          throw error
        }
        this.changed()
      }
      const queued = this.db
        .prepare(
          `SELECT ${RUN_COLUMNS} FROM schedule_runs WHERE status='queued' AND (retry_at IS NULL OR retry_at <= ?) ORDER BY due_at LIMIT 20`,
        )
        .all(now) as unknown as ScheduleRun[]
      for (const run of queued) {
        if (this.stopping) break
        // A run whose thread was deleted never finishes, and held every later run of its schedule back for good.
        this.settleOrphanRuns(run.scheduleId)
        if (
          this.db
            .prepare(
              "SELECT 1 FROM schedule_runs WHERE schedule_id=? AND id!=? AND status IN ('running','needs-input') LIMIT 1",
            )
            .get(run.scheduleId, run.id)
        )
          continue
        const s = this.get(run.scheduleId)
        try {
          const fromWebhook = this.workspace.getAppState<RunPrompt | null>(promptKey(run.id), null)
          // A thread made for this run on an earlier try may have been deleted since; the run then starts a new one.
          const kept = run.taskId && this.threadExists(run.taskId) ? run.taskId : null
          const task = kept
            ? this.workspace.getTask(kept)
            : await this.workspace.createTask({
                projectId: s.projectId,
                title:
                  fromWebhook?.title ??
                  clipText(
                    `${s.name} · ${DateTime.fromMillis(run.dueAt, { zone: s.timezone }).toFormat('LLL d HH:mm')}`,
                    200,
                  ),
                mode: s.workspaceId ? 'worktree' : 'current',
                workspaceId: s.workspaceId ?? undefined,
              })
          this.db.prepare('UPDATE schedule_runs SET task_id=? WHERE id=?').run(task.id, run.id)
          const scope = this.workspace.agentScope(task.id)
          if (this.agents.activeWriter(scope.covers)) {
            this.db
              .prepare('UPDATE schedule_runs SET retry_at=?, error=? WHERE id=?')
              .run(now + 30000, 'Waiting for the workspace agent', run.id)
            continue
          }
          await this.agents.validateSettings(s.settings)
          // Starting and recording the session are synchronous; no tick can claim this occurrence twice.
          const session = await this.agents.startReviewed(task.id, scope, fromWebhook?.prompt ?? s.prompt, s.settings)
          if (fromWebhook) this.db.prepare('DELETE FROM app_state WHERE key=?').run(promptKey(run.id))
          this.db
            .prepare(
              "UPDATE schedule_runs SET session_id=?, status='running', attempts=attempts+1, retry_at=NULL, error=NULL WHERE id=?",
            )
            .run(session.id, run.id)
        } catch (error) {
          const attempts = run.attempts + 1
          this.db
            .prepare('UPDATE schedule_runs SET attempts=?, status=?, retry_at=?, error=? WHERE id=?')
            .run(
              attempts,
              attempts >= 3 ? 'failed' : 'queued',
              attempts >= 3 ? null : now + [60000, 300000, 900000][attempts - 1]!,
              String(error),
              run.id,
            )
          if (attempts >= 3) {
            this.pauseAfterFailures(run.scheduleId)
            try {
              this.startFailed?.({ ...run, attempts, status: 'failed', error: String(error) })
            } catch {}
          }
        }
        this.changed()
      }
      const active = this.db
        .prepare(
          `SELECT ${RUN_COLUMNS} FROM schedule_runs WHERE session_id IS NOT NULL AND status IN ('running','needs-input')`,
        )
        .all() as unknown as ScheduleRun[]
      for (const run of active) {
        const { status, error } = this.outcome(run)
        if (status !== run.status) {
          this.db
            .prepare('UPDATE schedule_runs SET status=?, error=COALESCE(?, error) WHERE id=?')
            .run(status, error, run.id)
          if (status === 'failed') this.pauseAfterFailures(run.scheduleId)
          this.changed()
        }
      }
    } finally {
      this.ticking = false
    }
  }
}
