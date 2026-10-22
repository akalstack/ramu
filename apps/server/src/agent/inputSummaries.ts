import type { ThreadInputRequest, ThreadInputSummary } from '@ramu/shared/types'
import type { Db } from '../db'

/** One bounded query for list context, independent of transcript size; rebuilds honestly after rewind/restart. */
export function readInputSummaries(db: Db, taskId?: string): Map<string, ThreadInputSummary> {
  const rows = db
    .prepare(
      `WITH pending AS (
    SELECT s.id AS sessionId, e.seq, json_extract(e.event, '$.requestId') AS requestId,
      CASE json_extract(e.event, '$.kind') WHEN 'permission-request' THEN 'approval' WHEN 'question' THEN 'question' ELSE 'connector' END AS kind,
      substr(CASE json_extract(e.event, '$.kind')
        WHEN 'permission-request' THEN COALESCE(NULLIF(json_extract(e.event, '$.title'), ''), json_extract(e.event, '$.toolName'))
        WHEN 'question' THEN json_extract(e.event, '$.questions[0].question') ELSE json_extract(e.event, '$.message') END, 1, 240) AS title,
      json_extract(e.event, '$.requestSource.sessionId') AS sourceSession,
      json_extract(e.event, '$.requestSource.agentId') AS sourceAgent,
      substr(json_extract(e.event, '$.requestSource.name'), 1, 100) AS sourceName,
      json_extract(e.event, '$.requestSource.requestId') AS sourceRequest
    FROM agent_sessions s JOIN agent_events e ON e.session_id = s.id
    WHERE s.state IN ('starting','running','needs-input','idle') ${taskId === undefined ? '' : 'AND s.task_id = ?'}
      AND json_extract(e.event, '$.kind') IN ('permission-request','question','elicitation')
      AND (json_extract(e.event, '$.agentId') IS NULL OR json_extract(e.event, '$.requestSource') IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM agent_events r WHERE r.session_id = s.id AND r.seq > e.seq
        AND (json_extract(r.event, '$.agentId') IS NULL OR json_extract(r.event, '$.requestSource') IS NOT NULL)
        AND json_extract(r.event, '$.requestId') = json_extract(e.event, '$.requestId')
        AND json_extract(r.event, '$.kind') IN ('request-resolved','permission-request','question','elicitation'))
  ), ranked AS (
    SELECT *, COUNT(*) OVER (PARTITION BY sessionId) AS count,
      SUM(kind = 'approval') OVER (PARTITION BY sessionId) AS approvals,
      SUM(kind = 'connector') OVER (PARTITION BY sessionId) AS connectors,
      ROW_NUMBER() OVER (PARTITION BY sessionId ORDER BY kind != 'approval', seq) AS rank
    FROM pending
  ) SELECT * FROM ranked WHERE rank <= 3`,
    )
    .all(...(taskId === undefined ? [] : [taskId])) as unknown as (ThreadInputRequest & {
    count: number
    approvals: number
    connectors: number
    sourceSession: string | null
    sourceAgent: string | null
    sourceName: string | null
    sourceRequest: string | null
  })[]
  const summaries = new Map<string, ThreadInputSummary>()
  for (const row of rows) {
    const summary = summaries.get(row.sessionId) ?? {
      count: row.count,
      approvals: row.approvals,
      connectors: row.connectors,
      requests: [],
    }
    summary.requests.push({
      sessionId: row.sessionId,
      requestId: row.requestId,
      kind: row.kind,
      title: row.title ?? '',
      ...(row.sourceSession && row.sourceAgent
        ? {
            source: {
              sessionId: row.sourceSession,
              agentId: row.sourceAgent,
              name: row.sourceName ?? '',
              ...(row.sourceRequest ? { requestId: row.sourceRequest } : {}),
            },
          }
        : {}),
    })
    summaries.set(row.sessionId, summary)
  }
  return summaries
}
