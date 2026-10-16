import { createHash } from 'node:crypto'
import { NO_PROJECT, type AgentProvider, type PermissionScope } from '@ramu/shared/types'
import type { Db } from '../db'

/** Match complete inputs, not truncated display text or a broad tool-name allowlist. */
export function permissionKey(tool: string, input: unknown): string {
  const stable = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(stable)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, item]) => [key, stable(item)]),
          )
        : value
  return createHash('sha256')
    .update(JSON.stringify([tool, stable(input)]))
    .digest('hex')
}

/** Ramu-owned approvals are scoped to this installation's user, optionally one project. */
export class PermissionApprovals {
  constructor(private db: Db) {}
  project(taskId: string): string | undefined {
    const row = this.db.prepare('SELECT project_id FROM tasks WHERE id = ?').get(taskId) as
      { project_id: string } | undefined
    return row?.project_id && row.project_id !== NO_PROJECT ? row.project_id : undefined
  }
  private key(provider: AgentProvider, action: string, scope: Exclude<PermissionScope, 'once'>, project?: string) {
    if (scope === 'project' && !project) throw new Error('Choose a project to save a project approval.')
    return `permission-approval:v1:${JSON.stringify([provider, action, scope, scope === 'project' ? project : null])}`
  }
  remember(provider: AgentProvider, action: string, scope: Exclude<PermissionScope, 'once'>, project?: string): void {
    this.db
      .prepare('INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)')
      .run(this.key(provider, action, scope, project), JSON.stringify({ createdAt: Date.now() }))
  }
  match(provider: AgentProvider, action: string, project?: string): Exclude<PermissionScope, 'once'> | undefined {
    for (const scope of ['project', 'user'] as const) {
      if (scope === 'project' && !project) continue
      if (this.db.prepare('SELECT 1 FROM app_state WHERE key = ?').get(this.key(provider, action, scope, project)))
        return scope
    }
    return undefined
  }
  forget(provider: AgentProvider, action: string, scope: Exclude<PermissionScope, 'once'>, project?: string): void {
    this.db.prepare('DELETE FROM app_state WHERE key = ?').run(this.key(provider, action, scope, project))
  }
}
