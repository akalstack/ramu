import { coversPath } from './covers'
import { providerAccountId } from '../providers/providerBinaries'
import { supportsProviderAccounts } from '@ramu/shared/providers/providers'
import { randomUUID } from 'node:crypto'
import type { ProviderUse } from '@ramu/shared/chat/threadProviders'
import type {
  AgentProvider,
  AgentTask,
  AgentEvent,
  AgentScope,
  AgentSessionInfo,
  AgentSessionState,
  AgentSettings,
  QueuedMessage,
  ChatSearchHit,
} from '@ramu/shared/types'
import { toInfo, TITLE_SQL, type SessionRow } from './sessionRow'
import { excerpt } from './text'
import { RECORDED_ACCOUNT_PROVIDERS } from './settings'
import type { Db } from '../db'
import { readInputSummaries } from './inputSummaries'
import { readSessionHelperSummary } from './helperSummaries'

/** What SessionStore needs from the rest of the service. */
export interface SessionStoreHost {
  onEvent(sessionId: string, event: AgentEvent, seq?: number, revision?: number): void
}

/** The most serialized transcript rows `changes` replays before it sends a snapshot instead. */
export const MAX_CHANGE_BYTES = 4_000_000

/** Reads and writes a session's rows and event log. Holds no session state beyond the event revision counter. */
export class SessionStore {
  constructor(
    private readonly host: SessionStoreHost,
    private readonly db: Db,
  ) {}

  /** Top-level chats that are working or waiting for the user, for the computer switcher. */
  counts(): { running: number; needsInput: number } {
    const rows = this.db
      .prepare(
        "SELECT state, COUNT(*) AS n FROM agent_sessions WHERE parent_session_id IS NULL AND state IN ('starting', 'running', 'needs-input') GROUP BY state",
      )
      .all() as unknown as { state: AgentSessionState; n: number }[]
    const count = (...states: AgentSessionState[]) =>
      rows.filter((row) => states.includes(row.state)).reduce((sum, row) => sum + Number(row.n), 0)
    return { running: count('starting', 'running'), needsInput: count('needs-input') }
  }

  list(taskId: string): AgentSessionInfo[] {
    const rows = this.db
      .prepare(
        `SELECT s.*, ${TITLE_SQL} FROM agent_sessions s WHERE task_id = ? AND parent_session_id IS NULL ORDER BY created_at`,
      )
      .all(taskId) as unknown as SessionRow[]
    const summaries = readInputSummaries(this.db, taskId)
    return rows.map((row) => ({ ...toInfo(row), inputSummary: summaries.get(row.id) ?? null }))
  }

  /** Every task's top-level sessions, oldest first: `list` for all tasks at once, with one read of the input summaries. */
  /** Each session's providers with when each last ran there: one row per provider a session has handed off between. */
  providerUses(): Map<string, ProviderUse[]> {
    const rows = this.db
      .prepare('SELECT session_id, provider, updated_at FROM session_provider_sessions')
      .all() as unknown as { session_id: string; provider: AgentProvider; updated_at: number }[]
    const bySession = new Map<string, ProviderUse[]>()
    for (const row of rows)
      bySession.set(row.session_id, [
        ...(bySession.get(row.session_id) ?? []),
        { provider: row.provider, at: row.updated_at },
      ])
    return bySession
  }

  listByTask(): Map<string, AgentSessionInfo[]> {
    const rows = this.db
      .prepare(`SELECT s.*, ${TITLE_SQL} FROM agent_sessions s WHERE parent_session_id IS NULL ORDER BY created_at`)
      .all() as unknown as SessionRow[]
    const summaries = readInputSummaries(this.db)
    const byTask = new Map<string, AgentSessionInfo[]>()
    for (const row of rows) {
      const sessions = byTask.get(row.task_id) ?? []
      sessions.push({ ...toInfo(row), inputSummary: summaries.get(row.id) ?? null })
      byTask.set(row.task_id, sessions)
    }
    return byTask
  }

  all(): AgentSessionInfo[] {
    const rows = this.db
      .prepare(
        `SELECT s.*, ${TITLE_SQL},
      (SELECT json_extract(w.event,'$.retryAt') FROM agent_events w WHERE w.session_id=s.id AND json_extract(w.event,'$.kind')='provider-wait' ORDER BY seq DESC LIMIT 1) AS waiting_until
      FROM agent_sessions s ORDER BY created_at DESC`,
      )
      .all() as unknown as (SessionRow & { waiting_until: number | null })[]
    const summaries = readInputSummaries(this.db)
    return rows.map((row) => ({
      ...toInfo(row),
      inputSummary: summaries.get(row.id) ?? null,
      pendingInput: summaries.has(row.id),
      waitingUntil: row.waiting_until,
    }))
  }

  /**
   * Adds `root` to the covered paths of the task's sessions (helpers included) whose folder already holds it, as when
   * a repository is cloned into the workspace folder a thread works in. A session never gains a folder it could not
   * reach before. Returns the sessions that changed.
   */
  cover(taskId: string, root: string): string[] {
    const rows = this.db
      .prepare('SELECT id, cwd, additional_dirs, covers FROM agent_sessions WHERE task_id = ?')
      .all(taskId) as unknown as { id: string; cwd: string; additional_dirs: string; covers: string }[]
    const changed: string[] = []
    for (const row of rows) {
      const covers = JSON.parse(row.covers) as string[]
      const reach = [row.cwd, ...(JSON.parse(row.additional_dirs) as string[]), ...covers]
      if (covers.includes(root) || !coversPath(reach, root)) continue
      this.db
        .prepare('UPDATE agent_sessions SET covers = ? WHERE id = ?')
        .run(JSON.stringify([...covers, root]), row.id)
      changed.push(row.id)
    }
    return changed
  }

  get(id: string): AgentSessionInfo {
    const row = this.db.prepare(`SELECT s.*, ${TITLE_SQL} FROM agent_sessions s WHERE id = ?`).get(id) as unknown as
      SessionRow | undefined
    if (!row) throw new Error(`Unknown agent session ${id}`)
    return toInfo(row)
  }

  /** Case-insensitive substring search over top-level chats' user and agent messages, newest first. */
  searchMessages(query: string, limit = 60): ChatSearchHit[] {
    const needle = query.trim().toLowerCase()
    if (needle.length < 2) return []
    const rows = this.db
      .prepare(
        `SELECT s.task_id AS taskId, e.session_id AS sessionId, e.seq AS seq, json_extract(e.event, '$.kind') AS kind, json_extract(e.event, '$.text') AS text
      FROM agent_events e JOIN agent_sessions s ON s.id = e.session_id
      WHERE s.parent_session_id IS NULL AND json_extract(e.event, '$.kind') IN ('user', 'text') AND instr(lower(json_extract(e.event, '$.text')), ?) > 0
      ORDER BY e.rowid DESC LIMIT ?`,
      )
      .all(needle, limit) as { taskId: string; sessionId: string; seq: number; kind: string; text: string }[]
    return rows.map(({ taskId, sessionId, seq, kind, text }) => ({
      taskId,
      sessionId,
      seq,
      role: kind === 'user' ? 'user' : 'agent',
      snippet: excerpt(text, needle),
    }))
  }

  /** Only bounded visible main-thread prose is needed to name a thread, never tools or helper transcripts. */
  titleContext(taskId: string): { users: string[]; replies: string[] } {
    const prose = `SELECT e.session_id AS sessionId, e.seq, substr(json_extract(e.event, '$.text'), 1, 3000) AS text
      FROM agent_events e JOIN agent_sessions s ON s.id=e.session_id
      WHERE s.task_id=? AND s.parent_session_id IS NULL AND json_extract(e.event, '$.agentId') IS NULL
        AND json_extract(e.event, '$.kind')=? AND trim(COALESCE(json_extract(e.event, '$.text'),'')) != ''`
    type Row = { sessionId: string; seq: number; text: string }
    const first = this.db.prepare(`${prose} ORDER BY s.created_at, s.rowid, e.seq LIMIT 1`).get(taskId, 'user') as
      Row | undefined
    if (!first) return { users: [], replies: [] }
    const recent = this.db
      .prepare(`${prose} ORDER BY s.created_at DESC, s.rowid DESC, e.seq DESC LIMIT 2`)
      .all(taskId, 'user') as Row[]
    const replies = this.db
      .prepare(`${prose} ORDER BY s.created_at DESC, s.rowid DESC, e.seq DESC LIMIT 2`)
      .all(taskId, 'text') as Row[]
    return {
      users: [
        first.text,
        ...recent
          .reverse()
          .filter((row) => row.sessionId !== first.sessionId || row.seq !== first.seq)
          .map((row) => row.text.slice(0, 1500)),
      ],
      replies: replies.reverse().map((row) => row.text.slice(0, 1000)),
    }
  }

  private eventRevision = 0

  emit(id: string, event: AgentEvent, seq?: number) {
    this.host.onEvent(id, event, seq, ++this.eventRevision)
  }

  /**
   * The rows that changed since `cursor` (a revision the client already holds), including rows edited in place, so
   * a reconnecting client need not re-read the whole transcript. A cursor the server cannot honor gets a full
   * snapshot flagged `reset`: none yet, one from the future, a client that holds later rows than exist (a rewind),
   * or more changes than the bound.
   */
  changes(
    id: string,
    cursor: number,
    knownLastSeq: number,
    limit = 2000,
    maxBytes = MAX_CHANGE_BYTES,
  ): {
    reset: boolean
    cursor: number
    lastSeq: number
    revision: number
    events: { seq: number; event: AgentEvent }[]
  } {
    this.get(id)
    const head = this.db
      .prepare(
        'SELECT COALESCE(MAX(rev), 0) AS rev, COALESCE(MAX(seq), 0) AS seq FROM agent_events WHERE session_id = ?',
      )
      .get(id) as { rev: number; seq: number }
    const parse = (rows: { seq: number; event: string }[]) =>
      rows.map((row) => ({ seq: row.seq, event: JSON.parse(row.event) as AgentEvent }))
    const base = { cursor: head.rev, lastSeq: head.seq, revision: this.eventRevision }
    const usable = cursor > 0 && cursor <= head.rev && knownLastSeq <= head.seq
    const changed = usable
      ? (this.db
          .prepare('SELECT seq, event FROM agent_events WHERE session_id = ? AND rev > ? ORDER BY rev LIMIT ?')
          .all(id, cursor, limit + 1) as { seq: number; event: string }[])
      : []
    // A replay is bounded by rows and by serialized size; past either, the client gets the authoritative snapshot.
    const tooLarge = changed.length > limit || changed.reduce((total, row) => total + row.event.length, 0) > maxBytes
    if (!usable || tooLarge) {
      const all = this.db.prepare('SELECT seq, event FROM agent_events WHERE session_id = ? ORDER BY seq').all(id) as {
        seq: number
        event: string
      }[]
      return { reset: true, ...base, events: parse(all) }
    }
    return { reset: false, ...base, events: parse(changed) }
  }

  /**
   * The end of a transcript, bounded in rows and bytes and starting at a turn when one fits, so a long thread can show
   * before the rest of it arrives. `complete` says nothing older exists.
   */
  tail(
    id: string,
    maxRows = 300,
    maxBytes = 512 * 1024,
  ): { complete: boolean; events: { seq: number; event: AgentEvent }[] } {
    this.get(id)
    const sizes = this.db
      .prepare(
        'SELECT seq, length(CAST(event AS BLOB)) AS size FROM agent_events WHERE session_id = ? ORDER BY seq DESC LIMIT ?',
      )
      .all(id, maxRows) as { seq: number; size: number }[]
    let from = sizes[0]?.seq ?? 0
    let bytes = 0
    for (const row of sizes) {
      if ((bytes += row.size) > maxBytes && row !== sizes[0]) break
      from = row.seq
    }
    const first = this.db.prepare('SELECT MIN(seq) AS seq FROM agent_events WHERE session_id = ?').get(id) as {
      seq: number | null
    }
    const complete = first.seq === null || from <= first.seq
    const turn = complete
      ? undefined
      : (
          this.db
            .prepare(
              "SELECT seq FROM agent_events WHERE session_id = ? AND json_extract(event, '$.kind') = 'user' AND seq >= ? ORDER BY seq LIMIT 1",
            )
            .get(id, from) as { seq: number } | undefined
        )?.seq
    const rows = this.db
      .prepare('SELECT seq, event FROM agent_events WHERE session_id = ? AND seq >= ? ORDER BY seq')
      .all(id, turn ?? from) as { seq: number; event: string }[]
    return { complete, events: rows.map((row) => ({ seq: row.seq, event: JSON.parse(row.event) as AgentEvent })) }
  }

  events(id: string): AgentEvent[] {
    const rows = this.db.prepare('SELECT event FROM agent_events WHERE session_id = ? ORDER BY seq').all(id) as {
      event: string
    }[]
    return rows.map((r) => JSON.parse(r.event) as AgentEvent)
  }

  rootOf(id: string): string {
    return (
      (
        this.db.prepare('SELECT parent_session_id AS p FROM agent_sessions WHERE id = ?').get(id) as
          { p: string | null } | undefined
      )?.p ?? id
    )
  }

  /** The newest event of these kinds, read without parsing the transcript. */
  latestEvent<K extends AgentEvent['kind']>(id: string, ...kinds: K[]): Extract<AgentEvent, { kind: K }> | undefined {
    const row = this.db
      .prepare(
        `SELECT event FROM agent_events WHERE session_id = ? AND json_extract(event, '$.kind') IN (${kinds.map(() => '?').join(',')}) ORDER BY seq DESC LIMIT 1`,
      )
      .get(id, ...kinds) as { event: string } | undefined
    return row ? (JSON.parse(row.event) as Extract<AgentEvent, { kind: K }>) : undefined
  }

  /** Every event of one kind, oldest first, read without parsing the rest of the transcript. */
  eventsOfKind<K extends AgentEvent['kind']>(id: string, kind: K): Extract<AgentEvent, { kind: K }>[] {
    const rows = this.db
      .prepare(`SELECT event FROM agent_events WHERE session_id = ? AND json_extract(event, '$.kind') = ? ORDER BY seq`)
      .all(id, kind) as { event: string }[]
    return rows.map((row) => JSON.parse(row.event) as Extract<AgentEvent, { kind: K }>)
  }

  queued(id: string): QueuedMessage[] {
    return this.latestEvent(id, 'queue')?.messages ?? []
  }

  queuePaused(id: string): boolean {
    return !!this.latestEvent(id, 'queue')?.paused
  }

  /** Whether the session's thread is marked done, which holds every turn the person did not start. */
  threadDone(id: string): boolean {
    const row = this.db
      .prepare('SELECT t.done_at AS doneAt FROM agent_sessions s JOIN tasks t ON t.id = s.task_id WHERE s.id = ?')
      .get(id) as { doneAt: number | null } | undefined
    return !!row?.doneAt
  }

  /** The latest recorded state of one sub-agent. */
  task(id: string, agentId: string): AgentTask | null {
    const row = this.db
      .prepare(
        "SELECT event FROM agent_events WHERE session_id = ? AND json_extract(event, '$.kind') = 'agent' AND json_extract(event, '$.agentId') = ? LIMIT 1",
      )
      .get(id, agentId) as { event: string } | undefined
    return row ? (JSON.parse(row.event) as AgentTask) : null
  }

  hasRunningTasks(id: string): boolean {
    return !!this.db
      .prepare(
        "SELECT 1 FROM agent_events WHERE session_id = ? AND json_extract(event, '$.kind') = 'agent' AND json_extract(event, '$.status') = 'running' LIMIT 1",
      )
      .get(id)
  }

  /**
   * Whether work that lives inside the provider's own process is still running: its native sub-agents and background
   * commands. Helpers Ramu started run in their own sessions and outlive a restart of this one.
   */
  hasNativeWork(id: string): boolean {
    return !!this.db
      .prepare(
        "SELECT 1 FROM agent_events WHERE session_id = ? AND json_extract(event, '$.kind') = 'agent' AND json_extract(event, '$.status') = 'running' AND json_extract(event, '$.childSessionId') IS NULL LIMIT 1",
      )
      .get(id)
  }

  /** Running helpers of one session, excluding advisor consultations, shell commands and restored activity. */
  helperSummary(id: string) {
    return readSessionHelperSummary(this.db, id)
  }

  isRecoveryPending(id: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM agent_recovery WHERE session_id = ?').get(id)
  }

  createSession(
    taskId: string,
    scope: AgentScope,
    settings: AgentSettings,
    state: AgentSessionState,
    parentId: string | null = null,
  ): AgentSessionInfo {
    const accountId = settings.accountId ?? providerAccountId(settings.provider)
    if (
      supportsProviderAccounts(settings.provider) &&
      (RECORDED_ACCOUNT_PROVIDERS.has(settings.provider) || accountId !== 'default')
    )
      settings = { ...settings, accountId }
    const row: SessionRow = {
      id: randomUUID(),
      task_id: taskId,
      repo_id: null,
      provider: settings.provider,
      settings: JSON.stringify(settings),
      cwd: scope.cwd,
      additional_dirs: JSON.stringify(scope.additionalDirs),
      covers: JSON.stringify(scope.covers),
      state,
      provider_session_id: null,
      created_at: Date.now(),
      first_event: null,
    }
    this.db
      .prepare(
        `INSERT INTO agent_sessions (id, task_id, repo_id, provider, cwd, additional_dirs, covers, state, provider_session_id, created_at, settings, parent_session_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.task_id,
        row.repo_id,
        row.provider,
        row.cwd,
        row.additional_dirs,
        row.covers,
        row.state,
        row.provider_session_id,
        row.created_at,
        row.settings,
        parentId,
      )
    return this.get(row.id)
  }
}
