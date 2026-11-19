import type { Db } from '../db'

/**
 * Settled advisor consultations nobody has looked at yet, per thread, from one bounded query over its main sessions.
 * A consultation is unread when it settled (completed or failed) after the thread's marker: the session's event change
 * counter at the moment a person last opened the advice. A running consultation is not advice yet, and a thread nobody
 * has marked counts every settled consultation.
 */
export function readUnreadAdvice(db: Db, taskId?: string): Map<string, number> {
  const rows = db
    .prepare(
      `SELECT s.task_id AS taskId, COUNT(*) AS unread
      FROM agent_sessions s
      JOIN agent_events e ON e.session_id = s.id
      LEFT JOIN advice_reads r ON r.session_id = s.id
      WHERE s.parent_session_id IS NULL ${taskId === undefined ? '' : 'AND s.task_id = ?'}
        AND json_extract(e.event, '$.kind') = 'agent'
        AND json_extract(e.event, '$.taskType') = 'advisor'
        AND json_extract(e.event, '$.status') IN ('completed', 'failed')
        AND e.rev > COALESCE(r.read_rev, 0)
      GROUP BY s.task_id`,
    )
    .all(...(taskId === undefined ? [] : [taskId])) as { taskId: string; unread: number }[]
  return new Map(rows.map((row) => [row.taskId, row.unread]))
}

/** Records that the advice in this session has been seen, as of its latest change. Idempotent. */
export function markAdviceRead(db: Db, sessionId: string): void {
  const { latest } = db
    .prepare('SELECT COALESCE(MAX(rev), 0) AS latest FROM agent_events WHERE session_id = ?')
    .get(sessionId) as {
    latest: number
  }
  db.prepare(
    `INSERT INTO advice_reads (session_id, read_rev) VALUES (?, ?)
     ON CONFLICT(session_id) DO UPDATE SET read_rev = MAX(read_rev, excluded.read_rev)`,
  ).run(sessionId, latest)
}
