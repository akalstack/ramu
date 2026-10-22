import type { AgentEvent, AgentSessionInfo, AgentSettings, Task } from '@ramu/shared/types'
import type { AgentService } from '../agent'
import type { Db } from '../db'
import type { Workspace } from '../workspace/workspace'
import { cleanTitle } from './text'

const PLACEHOLDER =
  /^(?:(?:new|child) (?:thread|chat|session|conversation)(?: - .*)?|untitled(?: thread| chat| session)?|chat title|conversation)$/i

type Kind = 'automatic' | 'refinement' | 'manual'
interface TitleJob {
  taskId: string
  revision: number
  kind: Kind
  settings: string
  attempts: number
}
interface Pending {
  job: TitleJob
  controller: AbortController
  promise: Promise<Task>
  resolve: (task: Task) => void
  reject: (error: unknown) => void
}
interface TitleWait {
  taskId: string
  sessionId: string
  revision: number
  settings: string
  dueAt: number
}

/** Owns title scheduling and receipts; inference stays in the existing isolated analysis path. */
export class ThreadTitles {
  private readonly pending = new Map<string, Pending>()
  private readonly queue: Pending[] = []
  private running = 0
  private stopping = false

  constructor(
    private readonly db: Db,
    private readonly workspace: Workspace,
    private readonly agents: Pick<AgentService, 'get' | 'list' | 'events' | 'draftTitleResult'>,
    private readonly changed: () => void,
    private readonly deadlineMs = 15_000,
    /**
     * Providers known to supply titles are given time before the fallback runs. By default a provider counts once one of
     * its sessions has delivered a title in this process, so the first thread of a run uses the fallback and later ones
     * wait; a provider that never sends one is never waited for.
     */
    private readonly suppliesTitles: (session: AgentSessionInfo) => boolean = (session) =>
      this.suppliers.has(session.provider),
    private readonly graceMs = 5_000,
    private readonly turnLimitMs = 120_000,
  ) {}

  private readonly waits = new Map<string, NodeJS.Timeout>()
  private readonly suppliers = new Set<string>()

  private clearWait(taskId: string): void {
    clearTimeout(this.waits.get(taskId))
    this.waits.delete(taskId)
    this.db.prepare('DELETE FROM task_title_waits WHERE task_id = ?').run(taskId)
  }

  private wait(session: AgentSessionInfo, ms: number): void {
    const state = this.db
      .prepare(
        "SELECT title_revision AS revision FROM tasks WHERE id = ? AND title_source = 'prompt' AND title_auto_attempted = 0",
      )
      .get(session.taskId) as { revision: number } | undefined
    if (!state) return
    const previous = this.db
      .prepare(
        'SELECT session_id AS sessionId, due_at AS dueAt FROM task_title_waits WHERE task_id = ? AND revision = ?',
      )
      .get(session.taskId, state.revision) as { sessionId: string; dueAt: number } | undefined
    const dueAt = Math.min(Date.now() + ms, previous?.sessionId === session.id ? previous.dueAt : Infinity)
    const wait: TitleWait = {
      taskId: session.taskId,
      sessionId: session.id,
      revision: state.revision,
      settings: JSON.stringify(session.settings),
      dueAt,
    }
    this.db
      .prepare(
        `INSERT INTO task_title_waits(task_id, session_id, revision, settings, due_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(task_id) DO UPDATE SET session_id=excluded.session_id, revision=excluded.revision, settings=excluded.settings, due_at=excluded.due_at`,
      )
      .run(wait.taskId, wait.sessionId, wait.revision, wait.settings, wait.dueAt)
    this.armWait(wait)
  }

  private armWait(wait: TitleWait): void {
    const { taskId } = wait
    clearTimeout(this.waits.get(taskId))
    const timer = setTimeout(
      () => {
        this.waits.delete(taskId)
        if (this.stopping) return
        try {
          const current = this.db
            .prepare('SELECT 1 FROM tasks WHERE id = ? AND title_revision = ?')
            .get(taskId, wait.revision)
          const session = this.agents.get(wait.sessionId)
          if (!current || session.taskId !== taskId || this.agents.list(taskId).at(-1)?.id !== wait.sessionId) {
            this.clearWait(taskId)
            return
          }
          // Request stores its generation receipt and removes the wait in the same transaction.
          void this.generate(taskId, JSON.parse(wait.settings) as AgentSettings).catch(() => {})
        } catch {
          this.clearWait(taskId)
        }
      },
      Math.max(0, Math.min(wait.dueAt - Date.now(), this.turnLimitMs)),
    )
    timer.unref()
    this.waits.set(taskId, timer)
  }

  /**
   * Accepts a title the active provider session supplied on its own. Manual names and settled useful automatic
   * names win; a pending fallback is cancelled and its late result rejected by the revision bump.
   */
  acceptProviderTitle(sessionId: string, raw: string): Task | null {
    if (this.stopping || typeof raw !== 'string' || raw.length > 2000) return null
    try {
      const session = this.agents.get(sessionId)
      const top = this.agents.list(session.taskId)
      if (top.at(-1)?.id !== sessionId) return null
      if (raw.trim()) this.suppliers.add(session.provider)
      if ([...raw].some((c) => (c.codePointAt(0)! < 32 && !'\t\n\r'.includes(c)) || c.codePointAt(0) === 127))
        return null
      const title = cleanTitle(raw)
      if (!title || PLACEHOLDER.test(title)) return null
      const state = this.db
        .prepare('SELECT title_source AS source, title_needs_refinement AS refine FROM tasks WHERE id = ?')
        .get(session.taskId) as { source: string; refine: number } | undefined
      if (!state || state.source === 'manual' || (state.source !== 'prompt' && !state.refine)) return null
      this.clearWait(session.taskId)
      const task = this.workspace.setGeneratedTitle(session.taskId, title, false, undefined, false, 'provider')
      this.db.prepare('UPDATE tasks SET title_auto_attempted = 1 WHERE id = ?').run(session.taskId)
      this.pending.get(session.taskId)?.controller.abort()
      this.changed()
      return task
    } catch {
      return null
    }
  }

  observe(sessionId: string, event: AgentEvent): void {
    if (this.stopping || event.agentId || !['user', 'result'].includes(event.kind)) return
    // Owned children have their own sessions but are absent from the task's top-level conversation list.
    try {
      const session = this.agents.get(sessionId)
      if (this.agents.list(session.taskId).at(-1)?.id !== sessionId) return
      if (event.kind === 'user') {
        if (this.suppliesTitles(session)) {
          this.wait(session, this.turnLimitMs)
        } else void this.generate(session.taskId, session.settings).catch(() => {})
      } else if (event.kind === 'result') {
        // Failed or interrupted turns also end the wait so fallback is never blocked by a provider that stays silent.
        if (this.waits.has(session.taskId)) this.wait(session, this.graceMs)
        if (!event.isError) this.refine(session.taskId, session.settings)
      }
    } catch {
      // A deleted session/task cannot authorize background work.
    }
  }

  rename(taskId: string, title: string): Task {
    const task = this.workspace.renameTask(taskId, title)
    this.clearWait(taskId)
    this.pending.get(taskId)?.controller.abort()
    return task
  }

  generate(taskId: string, settings: AgentSettings, force = false): Promise<Task> {
    return this.request(taskId, settings, force ? 'manual' : 'automatic')
  }

  private request(taskId: string, settings: AgentSettings, kind: Kind): Promise<Task> {
    if (this.stopping) return Promise.reject(new Error('Title generation is stopping'))
    const current = this.workspace.getTask(taskId)
    const state = this.db
      .prepare(
        `SELECT title_source AS source, title_auto_attempted AS attempted,
      title_needs_refinement AS refine, title_refinement_attempted AS refined FROM tasks WHERE id = ?`,
      )
      .get(taskId) as { source: string; attempted: number; refine: number; refined: number }
    if (kind === 'automatic' && (state.source !== 'prompt' || state.attempted)) {
      this.clearWait(taskId)
      return this.pending.get(taskId)?.promise ?? Promise.resolve(current)
    }
    if (kind === 'refinement' && (state.source !== 'ai' || !state.refine || state.refined))
      return Promise.resolve(current)
    this.db.exec('BEGIN')
    let revision: number
    try {
      this.db.prepare('DELETE FROM task_title_waits WHERE task_id = ?').run(taskId)
      this.db
        .prepare(
          `UPDATE tasks SET title_revision = title_revision + 1, title_generation_state = 'pending',
        title_auto_attempted = CASE WHEN ? = 'automatic' THEN 1 ELSE title_auto_attempted END,
        title_refinement_attempted = CASE WHEN ? = 'refinement' THEN 1 ELSE title_refinement_attempted END
        WHERE id = ?`,
        )
        .run(kind, kind, taskId)
      revision = (
        this.db.prepare('SELECT title_revision AS revision FROM tasks WHERE id = ?').get(taskId) as { revision: number }
      ).revision
      this.db
        .prepare(
          `INSERT INTO task_title_jobs(task_id, revision, kind, settings, attempts) VALUES (?, ?, ?, ?, 0)
        ON CONFLICT(task_id) DO UPDATE SET revision=excluded.revision, kind=excluded.kind, settings=excluded.settings, attempts=0`,
        )
        .run(taskId, revision, kind, JSON.stringify(settings))
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    clearTimeout(this.waits.get(taskId))
    this.waits.delete(taskId)
    this.changed()
    return this.enqueue({ taskId, revision, kind, settings: JSON.stringify(settings), attempts: 0 })
  }

  private enqueue(job: TitleJob): Promise<Task> {
    this.pending.get(job.taskId)?.controller.abort()
    let resolve!: Pending['resolve'], reject!: Pending['reject']
    const promise = new Promise<Task>((yes, no) => {
      resolve = yes
      reject = no
    })
    const entry = { job, controller: new AbortController(), promise, resolve, reject }
    this.pending.set(job.taskId, entry)
    this.queue.push(entry)
    this.drain()
    return promise
  }

  private drain(): void {
    while (!this.stopping && this.running < 2 && this.queue.length) {
      const entry = this.queue.shift()!
      ++this.running
      void this.run(entry)
        .then(entry.resolve, entry.reject)
        .finally(() => {
          --this.running
          if (this.pending.get(entry.job.taskId) === entry) this.pending.delete(entry.job.taskId)
          this.drain()
        })
    }
  }

  private async run({ job, controller }: Pending): Promise<Task> {
    const { taskId, revision } = job
    const current = () =>
      Boolean(
        this.db
          .prepare(`SELECT 1 FROM tasks WHERE id = ? AND title_revision = ? AND title_generation_state = 'pending'`)
          .get(taskId, revision),
      )
    if (controller.signal.aborted || !current()) return this.workspace.getTask(taskId)
    const claimed = this.db
      .prepare('UPDATE task_title_jobs SET attempts = attempts + 1 WHERE task_id = ? AND revision = ? AND attempts < 2')
      .run(taskId, revision)
    if (!claimed.changes) {
      this.fail(job)
      throw new Error('Title generation was interrupted. Try again.')
    }
    const previousTitle = job.kind === 'manual' ? this.workspace.getTask(taskId).title : undefined
    const timer = setTimeout(() => controller.abort(), this.deadlineMs)
    timer.unref()
    let onAbort!: () => void
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(new Error('Title generation stopped or timed out. Try again.'))
      controller.signal.addEventListener('abort', onAbort, { once: true })
    })
    try {
      const draft = await Promise.race([
        this.agents.draftTitleResult(taskId, JSON.parse(job.settings) as AgentSettings, {
          previousTitle,
          signal: controller.signal,
          timeoutMs: this.deadlineMs,
        }),
        aborted,
      ])
      if (controller.signal.aborted || !current()) return this.workspace.getTask(taskId)
      if (!draft) throw new Error('Could not generate a useful title. Try again.')
      const task = this.workspace.setGeneratedTitle(
        taskId,
        draft.title,
        job.kind === 'manual',
        revision,
        job.kind === 'automatic' && draft.needsRefinement,
      )
      this.changed()
      // The main turn can finish before the title request. Refine once if its completed reply already supplied context.
      if (job.kind === 'automatic' && draft.needsRefinement)
        queueMicrotask(() => this.refine(taskId, JSON.parse(job.settings) as AgentSettings))
      return task
    } catch (error) {
      if (!current()) return this.workspace.getTask(taskId)
      if (!this.stopping) this.fail(job)
      throw error
    } finally {
      clearTimeout(timer)
      controller.signal.removeEventListener('abort', onAbort)
    }
  }

  private fail(job: TitleJob): void {
    this.db
      .prepare(
        `UPDATE tasks SET title_generation_state = 'failed' WHERE id = ? AND title_revision = ? AND title_generation_state = 'pending'`,
      )
      .run(job.taskId, job.revision)
    this.db.prepare('DELETE FROM task_title_jobs WHERE task_id = ? AND revision = ?').run(job.taskId, job.revision)
    this.changed()
  }

  private refine(taskId: string, settings: AgentSettings): void {
    if (this.stopping) return
    try {
      if (
        !this.db
          .prepare(
            "SELECT 1 FROM tasks WHERE id = ? AND title_source = 'ai' AND title_needs_refinement = 1 AND title_refinement_attempted = 0",
          )
          .get(taskId)
      )
        return
      const hasReply = this.agents.list(taskId).some((session) => {
        const events = this.agents.events(session.id)
        return (
          events.some((e) => e.kind === 'result' && !e.agentId && !e.isError) &&
          events.some(
            (e) =>
              e.kind === 'text' &&
              !e.agentId &&
              e.text.trim().length >= 20 &&
              !/^(?:(?:hi|hello|hey|halo|hai)[!.,\s]*)?(?:how can I help(?: you)?(?: today)?|what would you like(?: me)? to (?:do|work on)|ada yang bisa (?:saya|aku) bantu|apa yang (?:bisa|dapat) saya bantu)[?!.\s]*$/i.test(
                e.text.trim(),
              ),
          )
        )
      })
      if (hasReply) void this.request(taskId, settings, 'refinement').catch(() => {})
    } catch {}
  }

  /** Retry interrupted work at most once across restarts; settled failures wait for an explicit action. */
  recover(): void {
    if (this.stopping) return
    const waits = this.db
      .prepare(
        `SELECT w.task_id AS taskId, w.session_id AS sessionId, w.revision, w.settings, w.due_at AS dueAt
      FROM task_title_waits w JOIN tasks t ON t.id = w.task_id
      WHERE t.title_revision = w.revision AND t.title_source = 'prompt' AND t.title_auto_attempted = 0`,
      )
      .all() as unknown as TitleWait[]
    this.db
      .prepare(
        `DELETE FROM task_title_waits WHERE NOT EXISTS (SELECT 1 FROM tasks t
      WHERE t.id = task_title_waits.task_id AND t.title_revision = task_title_waits.revision
      AND t.title_source = 'prompt' AND t.title_auto_attempted = 0)`,
      )
      .run()
    for (const wait of waits) {
      if (this.waits.has(wait.taskId) || this.pending.has(wait.taskId)) continue
      try {
        const session = this.agents.get(wait.sessionId)
        if (session.taskId !== wait.taskId || this.agents.list(wait.taskId).at(-1)?.id !== session.id) {
          this.clearWait(wait.taskId)
          continue
        }
        this.armWait({ ...wait, dueAt: this.suppliesTitles(session) ? wait.dueAt : Date.now() })
      } catch {
        this.clearWait(wait.taskId)
      }
    }
    const jobs = this.db
      .prepare(
        `SELECT j.task_id AS taskId, j.revision, j.kind, j.settings, j.attempts
      FROM task_title_jobs j JOIN tasks t ON t.id = j.task_id
      WHERE t.title_revision = j.revision AND t.title_generation_state = 'pending'`,
      )
      .all() as unknown as TitleJob[]
    for (const job of jobs) {
      if (this.pending.has(job.taskId)) continue
      if (job.attempts >= 2) this.fail(job)
      else void this.enqueue(job).catch(() => {})
    }
  }

  async stop(): Promise<void> {
    this.stopping = true
    for (const timer of this.waits.values()) clearTimeout(timer)
    this.waits.clear()
    const entries = [...this.pending.values()]
    for (const entry of entries) entry.controller.abort()
    for (const entry of this.queue.splice(0)) entry.reject(new Error('Title generation is stopping'))
    await Promise.allSettled(entries.map((entry) => entry.promise))
    this.pending.clear()
  }
}
