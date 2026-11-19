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
  /**
   * `always` is delivered at session start; `manual` is stored for the person to apply and is never sent on its own;
   * `paths` applies when the agent works on files matching `paths`: Claude Code loads it natively from a rules file
   * Ramu writes, and other runtimes receive it at session start with its patterns named.
   */
  activation: RuleActivation
  /** Relative glob patterns for `paths` activation; empty for the other activations. */
  paths: string[]
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
  activation: RuleActivation
  /** Required (1 to RULE_PATH_LIMIT patterns) for `paths` activation; ignored otherwise. */
  paths: string[]
  enabled: boolean
}

export type RuleActivation = 'always' | 'manual' | 'paths'

/** Where Ramu wrote a path rule's Claude Code copy, and why one target could not be written. */
export interface RuleFileTarget {
  /** Display path, with the home folder shown as `~`. */
  path: string
  /** `repository`: a project repository's `.claude/rules`; `user`: the Claude rules folder in your Claude config home. */
  kind: 'repository' | 'user'
  problem?: string
}

export interface RuleFileStatus {
  ruleId: string
  targets: RuleFileTarget[]
}

export interface RuleRevision {
  revision: number
  name: string
  body: string
  paths: string[]
  at: number
}

/** Limits that keep delivered rules affordable and never silently truncated. */
export const RULE_BODY_LIMIT = 8000
export const RULE_TOTAL_LIMIT = 24000
export const RULE_NAME_LIMIT = 120
export const RULE_PATH_LIMIT = 20
export const RULE_PATTERN_LIMIT = 200

/** What one include (`@path`) inside an instruction file resolved to, without ever leaving the allowed roots. */
export interface NativeInstructionInclude {
  /** As written in the file. */
  reference: string
  status: 'read' | 'missing' | 'outside-allowed-folders' | 'cycle' | 'too-deep' | 'too-large' | 'not-a-file' | 'limit'
  characters: number
}

/** An instruction file a provider reads on its own. Ramu only reads it for display; it never edits, imports or sends it. */
export interface NativeInstructionFile {
  /** Display path, with the home folder shown as `~`. */
  path: string
  kind: 'AGENTS.md' | 'CLAUDE.md' | 'rules-file'
  /** `user` applies to every project on this host; `project` comes from one of the project's folders. */
  scope: 'user' | 'project'
  /** Repository or folder name for project files; the provider name for user files. */
  label: string
  /** Providers that read this file themselves, from their documented behavior (not verified by Ramu). */
  readBy: AgentProvider[]
  /** Where below the folder root the file sits; empty at the root. Nested files apply to their own folder tree. */
  nested: string
  characters: number
  /** The beginning of the file, bounded; `truncated` when more exists. */
  text: string
  truncated: boolean
  /** Frontmatter keys, kept as written so path-matched activation stays visible. Empty when there is none. */
  frontmatterKeys: string[]
  /** How the runtime itself activates this file, as far as the file says. */
  activation: 'always' | 'path-matched' | 'unknown'
  includes: NativeInstructionInclude[]
  /** Why the file could not be read; the other fields are then empty. */
  problem?: string
}

export interface NativeInstructions {
  projectId: string | null
  files: NativeInstructionFile[]
}

/** Bounds for showing native instruction files. */
export const NATIVE_INSTRUCTION_PREVIEW_LIMIT = 6000
