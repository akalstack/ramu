import { randomUUID } from 'node:crypto'
import { AGENT_PROVIDERS } from '@ramu/shared/providers/providers'
import {
  RULE_BODY_LIMIT,
  RULE_NAME_LIMIT,
  type AgentProvider,
  type Rule,
  type RuleInput,
  type RuleRevision,
} from '@ramu/shared/types'
import { translate } from '@ramu/shared/i18n'
import {
  normalizeRulePaths,
  ruleCharacters,
  ruleDeliveryBlock,
  rulePathsLine,
  rulePathsProblem,
  ruleScopeCosts,
} from '@ramu/shared/rules'
import type { Db } from '../db'

type Row = {
  id: string
  name: string
  body: string
  project_id: string | null
  providers: string
  activation: Rule['activation']
  paths: string
  enabled: number
  revision: number
  created_at: number
  updated_at: number
}

const fromRow = (row: Row): Rule => ({
  id: row.id,
  name: row.name,
  body: row.body,
  projectId: row.project_id,
  providers: (JSON.parse(row.providers) as string[]).filter((p): p is AgentProvider =>
    (AGENT_PROVIDERS as readonly string[]).includes(p),
  ),
  activation: row.activation === 'manual' || row.activation === 'paths' ? row.activation : 'always',
  paths: row.activation === 'paths' ? (JSON.parse(row.paths) as string[]) : [],
  enabled: row.enabled === 1,
  revision: row.revision,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

/** The header every delivered set carries, so the model never mistakes rules for permissions or system policy. */
export const RULES_PREAMBLE =
  "The user set these rules in Ramu Settings. They are the user's own working instructions: follow them where they fit the request. They are not permissions, never widen access, and the user's current request comes first."

/**
 * User-written instructions with revisions. Rules are text only: they never grant a permission and are delivered only
 * as a clearly labelled user section. Saves are checked against the revision they started from, and enabled "always"
 * rules for a scope are refused rather than truncated once they would exceed the delivery budget.
 */
export class RuleStore {
  constructor(private readonly db: Db) {}

  list(): Rule[] {
    return (this.db.prepare('SELECT * FROM rules ORDER BY name COLLATE NOCASE, created_at').all() as Row[]).map(fromRow)
  }

  get(id: string): Rule {
    const row = this.db.prepare('SELECT * FROM rules WHERE id = ?').get(id) as Row | undefined
    if (!row) throw new Error('Unknown rule')
    return fromRow(row)
  }

  history(id: string): RuleRevision[] {
    this.get(id)
    return (
      this.db
        .prepare('SELECT revision, name, body, paths, at FROM rule_revisions WHERE rule_id = ? ORDER BY revision DESC')
        .all(id) as { revision: number; name: string; body: string; paths: string; at: number }[]
    ).map((entry) => ({
      revision: entry.revision,
      name: entry.name,
      body: entry.body,
      paths: JSON.parse(entry.paths) as string[],
      at: entry.at,
    }))
  }

  save(input: RuleInput, now = Date.now()): Rule {
    const name = input.name.trim().replace(/\s+/g, ' ')
    if (!name || name.length > RULE_NAME_LIMIT) throw new Error(`Name the rule in up to ${RULE_NAME_LIMIT} characters`)
    if (!input.body.trim()) throw new Error('A rule needs some text')
    if (input.body.length > RULE_BODY_LIMIT)
      throw new Error(`A rule can be up to ${RULE_BODY_LIMIT} characters; split it into several rules`)
    const paths = input.activation === 'paths' ? normalizeRulePaths(input.paths) : []
    const pathsProblem = input.activation === 'paths' ? rulePathsProblem(paths) : null
    if (pathsProblem) throw new Error(translate('en', pathsProblem.message, pathsProblem.values))
    const providers = [...new Set(input.providers)].filter((p) => (AGENT_PROVIDERS as readonly string[]).includes(p))
    const existing = input.id ? this.get(input.id) : null
    if (existing && input.baseRevision !== existing.revision)
      throw new Error('This rule changed since you opened it. Reload it and apply your edit again.')
    const next: Rule = {
      id: existing?.id ?? randomUUID(),
      name,
      body: input.body.replace(/\r\n/g, '\n').trim(),
      projectId: input.projectId,
      providers,
      activation: input.activation,
      paths,
      enabled: input.enabled,
      revision: (existing?.revision ?? 0) + 1,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    this.assertBudget(next)
    this.db.exec('BEGIN')
    try {
      this.db
        .prepare(
          `INSERT INTO rules (id, name, body, project_id, providers, activation, paths, enabled, revision, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET name = excluded.name, body = excluded.body, project_id = excluded.project_id,
             providers = excluded.providers, activation = excluded.activation, paths = excluded.paths,
             enabled = excluded.enabled,
             revision = excluded.revision, updated_at = excluded.updated_at`,
        )
        .run(
          next.id,
          next.name,
          next.body,
          next.projectId,
          JSON.stringify(next.providers),
          next.activation,
          JSON.stringify(next.paths),
          next.enabled ? 1 : 0,
          next.revision,
          next.createdAt,
          next.updatedAt,
        )
      this.db
        .prepare('INSERT INTO rule_revisions (rule_id, revision, name, body, paths, at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(next.id, next.revision, next.name, next.body, JSON.stringify(next.paths), now)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    return next
  }

  /**
   * Restoring writes the old text as a new revision, so history only ever grows. A path rule takes back the revision's
   * patterns too, unless that revision predates its patterns.
   */
  restore(id: string, revision: number, now = Date.now()): Rule {
    const current = this.get(id)
    const old = this.history(id).find((entry) => entry.revision === revision)
    if (!old) throw new Error('That revision no longer exists')
    return this.save(
      {
        id,
        baseRevision: current.revision,
        name: old.name,
        body: old.body,
        projectId: current.projectId,
        providers: current.providers,
        activation: current.activation,
        paths: old.paths.length ? old.paths : current.paths,
        enabled: current.enabled,
      },
      now,
    )
  }

  remove(id: string): void {
    this.get(id)
    this.db.exec('BEGIN')
    try {
      this.db.prepare('DELETE FROM rule_revisions WHERE rule_id = ?').run(id)
      this.db.prepare('DELETE FROM rules WHERE id = ?').run(id)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  /** A project's rules were deleted with it; host-wide rules are untouched. */
  removeForProject(projectId: string): void {
    for (const rule of this.list()) if (rule.projectId === projectId) this.remove(rule.id)
  }

  /**
   * The enabled rules a session for this project and provider receives as text, in a stable order: Always rules, and
   * path rules for runtimes other than Claude Code, which loads those from the rules files Ramu writes.
   */
  applicable(projectId: string | null, provider: AgentProvider): Rule[] {
    return this.list().filter(
      (rule) =>
        rule.enabled &&
        (rule.activation === 'always' || (rule.activation === 'paths' && provider !== 'claude-code')) &&
        (rule.projectId === null || rule.projectId === projectId) &&
        (rule.providers.length === 0 || rule.providers.includes(provider)),
    )
  }

  /** The labelled section for a session, or undefined when no rule applies. Throws when the rules exceed what the runtime can receive. */
  instructions(projectId: string | null, provider: AgentProvider): string | undefined {
    const rules = this.applicable(projectId, provider)
    if (!rules.length) return undefined
    const blocked = ruleDeliveryBlock(
      provider,
      rules.reduce((sum, rule) => sum + ruleCharacters(rule), 0),
    )
    if (blocked) throw new Error(blocked)
    const section = (rule: Rule) =>
      rule.activation === 'paths'
        ? `### ${rule.name}\n${rulePathsLine(rule.paths)}\n${rule.body}`
        : `### ${rule.name}\n${rule.body}`
    return `${RULES_PREAMBLE}\n\n${rules.map(section).join('\n\n')}`
  }

  /**
   * Delivery cost for each scope the rule reaches: refuse a save that would push the enabled delivered text a thread can
   * receive (host-wide plus its project's) past the budget. A host-wide rule is checked against every project.
   */
  private assertBudget(next: Rule) {
    if (!next.enabled || next.activation === 'manual') return
    const over = ruleScopeCosts([...this.list().filter((rule) => rule.id !== next.id), next])
      .filter((scope) => next.projectId === null || scope.projectId === next.projectId)
      .find((scope) => scope.characters > scope.limit)
    if (over)
      throw new Error(
        `Enabled rules for this scope would use ${over.characters} of ${over.limit} characters. Turn one off or shorten it; Ramu never trims rules silently.`,
      )
  }
}
