import { z } from 'zod'
import type { Db } from '../db'
import type { BackgroundTerminalInfo } from '@ramu/shared/api'

export type BackgroundTerminalRecord = BackgroundTerminalInfo & { output: string }
export interface BackgroundTerminalHistory {
  load(): BackgroundTerminalRecord[]
  save(record: BackgroundTerminalRecord): void
  removeTask(taskId: string): void
}

const recordSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().min(1).max(100),
  repoId: z.string().max(100).nullable(),
  cwd: z.string().max(4096),
  command: z.string().min(1).max(4000),
  state: z.enum(['running', 'stopping', 'exited', 'failed', 'unknown']),
  startedAt: z.number().nonnegative(),
  endedAt: z.number().nonnegative().nullable(),
  exitCode: z.number().int().nullable(),
  cursor: z.number().int().nonnegative(),
  output: z.string().max(64_000),
})

/** Process IDs and environment are deliberately absent: persisted history cannot authorize process control. */
export class SqliteBackgroundTerminalHistory implements BackgroundTerminalHistory {
  constructor(private readonly db: Db) {}
  load(): BackgroundTerminalRecord[] {
    return (
      this.db.prepare('SELECT id, task_id, data FROM background_terminals WHERE length(data) <= 1000000').all() as {
        id: string
        task_id: string
        data: string
      }[]
    ).flatMap((row) => {
      try {
        const record = recordSchema.parse(JSON.parse(row.data))
        if (record.id !== row.id || record.taskId !== row.task_id || record.cursor < record.output.length) return []
        return [
          {
            ...record,
            state: record.state === 'running' || record.state === 'stopping' ? ('unknown' as const) : record.state,
            capabilities: { inspect: true as const, stop: false, forceStop: false, input: false },
          },
        ]
      } catch {
        return []
      }
    })
  }
  save(record: BackgroundTerminalRecord): void {
    const value = recordSchema.parse({ ...record, output: record.output.slice(-64_000) })
    this.db
      .prepare(
        `INSERT INTO background_terminals (id, task_id, data) VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      )
      .run(value.id, value.taskId, JSON.stringify(value))
    // Keep recent settled history per thread; active and uncertain ownership records are never silently evicted.
    this.db
      .prepare(
        `DELETE FROM background_terminals WHERE task_id = ?
      AND CASE WHEN json_valid(data) THEN json_extract(data, '$.state') END IN ('exited', 'failed') AND id NOT IN
      (SELECT id FROM background_terminals WHERE task_id = ? ORDER BY CASE WHEN json_valid(data) THEN json_extract(data, '$.startedAt') END DESC, id DESC LIMIT 100)`,
      )
      .run(value.taskId, value.taskId)
  }
  removeTask(taskId: string): void {
    this.db.prepare('DELETE FROM background_terminals WHERE task_id = ?').run(taskId)
  }
}
