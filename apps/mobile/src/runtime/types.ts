import type { AgentProvider, AgentQuestion, ChatGoal, Project, QueuedMessage, Task } from '@ramu/shared/types'

// Native view models; host IDs are kept separately from computer-scoped UI IDs.

export type ComputerStatus = 'online' | 'connecting' | 'offline' | 'revoked'

export interface Computer {
  id: string
  name: string
  address: string
  os: 'macos' | 'linux' | 'windows'
  /** Still carrying the placeholder label; the computer's own hostname replaces it on first contact. */
  auto?: boolean
  status: ComputerStatus
  lastSeen: number
  error?: string
}

export type ToolKind = 'read' | 'edit' | 'search' | 'execute' | 'think' | 'fetch' | 'other'
export type ToolStatus = 'in_progress' | 'completed' | 'failed'

export type TranscriptItem = (
  | {
      kind: 'user'
      id: string
      text: string
      at: number
      attachments?: import('@ramu/shared/types').Attachment[]
      /** The host's sequence number, which a revision names. */ seq?: number
      /** The text as sent, including any hidden <ramu-context>. */ raw?: string
    }
  /** An image the agent returned (MCP or tool content). */
  | { kind: 'image'; id: string; uri: string; alt?: string }
  | { kind: 'text'; id: string; text: string }
  | { kind: 'tool'; id: string; tool: ToolKind; verb: string; subject: string; status: ToolStatus; detail?: string }
  | {
      kind: 'agents'
      id: string
      agents: {
        id: string
        name: string
        type: string
        status: 'running' | 'completed' | 'failed'
        summary: string
        prompt?: string
        /** What the sub-agent itself wrote along the way. */ log?: string
      }[]
    }
  | {
      kind: 'question'
      id: string
      questions: AgentQuestion[]
      answers?: Record<string, string>
      submitted?: Record<string, string>
    }
  | { kind: 'permission'; id: string; title: string; command: string; decision?: 'allow' | 'deny' }
  | { kind: 'elicitation'; id: string; request: import('@ramu/shared/types').AgentElicitation; outcome?: string }
  | { kind: 'changes'; id: string; files: number; additions: number; deletions: number }
  | { kind: 'goal'; id: string; objective: string; turns: number }
  /** Turn boundary from a provider result or a terminal state; drives the Worked-for fold and is never drawn. */
  | { kind: 'end'; id: string; ended: boolean; interrupted: boolean }
  /** Live "Working for 12s" rule above the steps of the running turn. */
  | { kind: 'working'; id: string; since?: number }
  /** A status line between turns, as on the desktop: settings changed, continued after restart, context compacted. */
  | {
      kind: 'note'
      id: string
      title: string
      detail?: string
      failed?: boolean
      wait?: boolean
      settings?: import('@ramu/shared/types').AgentSettings
      previous?: import('@ramu/shared/types').AgentSettings
    }
  /** A finished turn's routine steps folded under "Worked for 12m 48s". */
  | { kind: 'summary'; id: string; label: string; items: TranscriptItem[] }
) & { at?: number }

export interface Chat extends Task {
  taskId: string
  sessionId: string | null
  computerId: string
  provider: AgentProvider
  model: string
  effort: string
  settings?: import('@ramu/shared/types').AgentSettings
  preview: string
  items: TranscriptItem[]
  queue: QueuedMessage[]
  /** The host holds queued messages until resumed (after a stop or an error), as on the desktop. */
  queuePaused?: boolean
  goal: ChatGoal | null
  branch: string
  /** Created while its computer was offline; it exists only on the phone until the outbox sends it. */
  pending?: boolean
}

export interface MobileProject extends Project {
  computerId: string
  kind: 'repo' | 'workspace'
  repos: string[]
}

export interface DiffLine {
  type: 'ctx' | 'add' | 'del' | 'hunk'
  text: string
  old?: number
  new?: number
}
export interface ChangedFile {
  path: string
  repo: string
  repoId?: string
  /** The review's id for this file, which comments name. */ fileId?: string
  status: 'modified' | 'added' | 'deleted'
  additions: number
  deletions: number
  lines: DiffLine[]
}

export const STANDALONE = 'no-project'
export const providerNames: Record<AgentProvider, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
  cursor: 'Cursor',
  antigravity: 'Antigravity',
}
