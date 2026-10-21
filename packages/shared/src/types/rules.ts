import type { AgentProvider } from './agent'

/** A user-written instruction set agents receive. It is guidance only; it never grants a permission. */
export interface Rule {
  id: string
  name: string
  /** Markdown text delivered to the agent. */
  body: string
  /** Absent: every project on the host. */
  projectId: string | null
  /** Empty: every provider. */
  providers: AgentProvider[]
  /** `always` is delivered at session start; `manual` is stored for the person to apply and is never sent on its own. */
  activation: 'always' | 'manual'
  enabled: boolean
  /** Bumped on every saved change; a save names the revision it started from. */
  revision: number
  createdAt: number
  updatedAt: number
}

export interface RuleInput {
  /** Omit to create. */
  id?: string
  /** Required with `id`: the revision this edit started from, so a concurrent change is refused instead of overwritten. */
  baseRevision?: number
  name: string
  body: string
  projectId: string | null
  providers: AgentProvider[]
  activation: 'always' | 'manual'
  enabled: boolean
}

export interface RuleRevision {
  revision: number
  name: string
  body: string
  at: number
}

/** Limits that keep delivered rules affordable and never silently truncated. */
export const RULE_BODY_LIMIT = 8000
export const RULE_TOTAL_LIMIT = 24000
export const RULE_NAME_LIMIT = 120
