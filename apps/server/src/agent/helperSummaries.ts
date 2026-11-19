import type { ThreadHelperSummary } from '@ramu/shared/types'
import type { Db } from '../db'

/**
 * Helpers that are independently running for each thread, from one bounded query over its main sessions. Advisor
 * consultations and background shell commands (a development server, for instance) are not unfinished work for the
 * user's task, and activity restored from provider history has no process behind it, so none of them count.
 */
export function readHelperSummaries(db: Db, taskId?: string): Map<string, ThreadHelperSummary> {
  const rows = db
    .prepare(
      `SELECT s.task_id AS taskId, COUNT(*) AS active,
        SUM(json_extract(e.event, '$.waitingFor') IS NOT NULL AND json_extract(e.event, '$.waitingFor') != '') AS waiting
      FROM agent_sessions s JOIN agent_events e ON e.session_id = s.id
      WHERE s.parent_session_id IS NULL ${taskId === undefined ? '' : 'AND s.task_id = ?'}
        AND json_extract(e.event, '$.kind') = 'agent'
        AND json_extract(e.event, '$.status') = 'running'
        AND COALESCE(json_extract(e.event, '$.taskType'), '') NOT IN ('advisor', 'local_bash')
        AND COALESCE(json_extract(e.event, '$.recovered'), 0) = 0
      GROUP BY s.task_id`,
    )
    .all(...(taskId === undefined ? [] : [taskId])) as { taskId: string; active: number; waiting: number | null }[]
  return new Map(rows.map((row) => [row.taskId, { active: row.active, waiting: row.waiting ?? 0 }]))
}

/** The same count for one session, for the status a task derives from its sessions. */
export function readSessionHelperSummary(db: Db, sessionId: string): ThreadHelperSummary {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS active,
        SUM(json_extract(e.event, '$.waitingFor') IS NOT NULL AND json_extract(e.event, '$.waitingFor') != '') AS waiting
      FROM agent_events e
      WHERE e.session_id = ?
        AND json_extract(e.event, '$.kind') = 'agent'
        AND json_extract(e.event, '$.status') = 'running'
        AND COALESCE(json_extract(e.event, '$.taskType'), '') NOT IN ('advisor', 'local_bash')
        AND COALESCE(json_extract(e.event, '$.recovered'), 0) = 0`,
    )
    .get(sessionId) as { active: number; waiting: number | null }
  return { active: row.active, waiting: row.waiting ?? 0 }
}
