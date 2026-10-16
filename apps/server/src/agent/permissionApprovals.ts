import { createHash } from 'node:crypto'
import {
  NO_PROJECT,
  type AgentProvider,
  type PermissionRemoval,
  type SavedPermissionRule,
  type PermissionScope,
} from '@ramu/shared/types'
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

/** Only offer prefixes for a single simple command, never a shell program or compound expression. */
export function commandPatterns(command: unknown): string[] {
  if (typeof command !== 'string' || /[\n\r;&|`$<>()[\]{}\\#]/.test(command)) return []
  const words = command.trim().split(/\s+/)
  const executable = words[0] ?? ''
  if (
    !/^[a-zA-Z][\w.-]*$/.test(executable) ||
    /^(?:ba|z|da|fi|c|k)?sh$|^(?:env|sudo|doas|eval|exec|command|xargs)$/.test(executable)
  )
    return []
  const subcommand = words[1]
  return [
    ...(subcommand && /^[a-zA-Z][\w-]*$/.test(subcommand) ? [`${executable} ${subcommand} *`] : []),
    `${executable} *`,
  ]
}

export function matchesCommand(pattern: string, command?: string): boolean {
  if (!/^[a-zA-Z][\w.-]*(?: [a-zA-Z][\w-]*)* \*$/.test(pattern)) return false
  if (!command || !commandPatterns(command).length) return false
  const prefix = pattern.slice(0, -2)
  const normalized = command.trim().replace(/\s+/g, ' ')
  return normalized === prefix || normalized.startsWith(prefix + ' ')
}

/** Ramu-owned approvals are scoped to this installation's user, optionally one project. */
export class PermissionApprovals {
  constructor(private db: Db) {}
  clear(removal: PermissionRemoval = { scope: 'all' }): void {
    if (removal.scope === 'project' && !removal.projectId) throw new Error('Choose a project.')
    for (const rule of this.list()) {
      if (
        removal.scope === 'all' ||
        (rule.scope === removal.scope && (removal.scope !== 'project' || rule.projectId === removal.projectId)) ||
        (removal.scope === 'projects' && rule.scope === 'project')
      )
        this.remove(rule.id)
    }
  }
  list(): SavedPermissionRule[] {
    const rows = this.db
      .prepare("SELECT key, value FROM app_state WHERE key LIKE 'permission-approval:v1:%'")
      .all() as { key: string; value: string }[]
    return rows.flatMap(({ key, value }) => {
      try {
        const [provider, , scope, projectId] = JSON.parse(key.slice('permission-approval:v1:'.length))
        const meta = JSON.parse(value)
        const project = projectId
          ? (this.db.prepare('SELECT name FROM projects WHERE id = ?').get(projectId) as { name: string } | undefined)
          : undefined
        return [
          {
            id: key,
            provider,
            scope,
            ...(projectId ? { projectId, projectName: project?.name ?? projectId } : {}),
            label: meta.label ?? 'Exact request (previous version)',
            pattern: meta.pattern,
            createdAt: meta.createdAt,
          },
        ]
      } catch {
        return []
      }
    })
  }
  remove(id: string): void {
    if (!id.startsWith('permission-approval:v1:')) throw new Error('Invalid approval rule.')
    this.db.prepare('DELETE FROM app_state WHERE key = ?').run(id)
  }
  find(provider: AgentProvider, action: string, project?: string, command?: string): SavedPermissionRule | undefined {
    const rules = this.list().filter(
      (rule) => rule.provider === provider && (rule.scope === 'user' || rule.projectId === project),
    )
    return (
      rules.find(
        (rule) =>
          rule.scope === 'project' &&
          (rule.id === this.key(provider, action, rule.scope, project) ||
            (rule.pattern && matchesCommand(rule.pattern, command))),
      ) ??
      rules.find(
        (rule) =>
          rule.id === this.key(provider, action, rule.scope, project) ||
          (rule.pattern && matchesCommand(rule.pattern, command)),
      )
    )
  }
  project(taskId: string): string | undefined {
    const row = this.db.prepare('SELECT project_id FROM tasks WHERE id = ?').get(taskId) as
      { project_id: string } | undefined
    return row?.project_id && row.project_id !== NO_PROJECT ? row.project_id : undefined
  }
  private key(provider: AgentProvider, action: string, scope: Exclude<PermissionScope, 'once'>, project?: string) {
    if (scope === 'project' && !project) throw new Error('Choose a project to save a project approval.')
    return `permission-approval:v1:${JSON.stringify([provider, action, scope, scope === 'project' ? project : null])}`
  }
  remember(
    provider: AgentProvider,
    action: string,
    scope: Exclude<PermissionScope, 'once'>,
    project?: string,
    metadata?: { label: string; pattern?: string },
  ): string {
    const id = this.key(
      provider,
      metadata?.pattern ? permissionKey('command-prefix', metadata.pattern) : action,
      scope,
      project,
    )
    this.db
      .prepare('INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)')
      .run(id, JSON.stringify({ createdAt: Date.now(), ...metadata }))
    return id
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
