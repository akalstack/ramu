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
  /** This phone's role on the host, as the host last reported it. Absent means full access. Advisory: the host enforces it. */
  access?: 'owner' | 'viewer'
  /** What pairing bound: this phone's id on the host and the host's durable id. Absent for older pairings. */
  deviceId?: string
  hostId?: string
  /** Other addresses the host named in a proven identity answer; tried only when the saved one stops answering. */
  routes?: string[]
}

export type ToolKind = 'read' | 'edit' | 'search' | 'execute' | 'think' | 'fetch' | 'other'
export type ToolStatus = 'in_progress' | 'completed' | 'failed'

export interface TranscriptTool {
  kind: 'tool'
  id: string
  tool: ToolKind
  verb: string
  subject: string
  status: ToolStatus
  detail?: string
  input?: string
  /** Reads, edits and writes: the full path, file name and line counts behind the compact row. */
  file?: import('@ramu/shared/chat/fileTools').FileToolLine
  /** An edit's changes, shown when its row is opened. */
  diffs?: { path: string; oldText: string | null; newText: string }[]
}

export type TranscriptItem = (
  | { kind: 'error'; id: string; message: string }
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
  | { kind: 'interactive'; id: string; reference: import('@ramu/shared/interactive').InteractiveReference }
  | { kind: 'image'; id: string; uri: string; alt?: string }
  /** A theme the agent drafted with `propose_theme`; the person previews it before anything changes. */
  | { kind: 'theme'; id: string; theme: import('@ramu/shared/theme').RamuTheme }
  /** Threads this thread's agent started; each row opens one. */
  | { kind: 'threads'; id: string; threads: import('@ramu/shared/types').StartedThread[] }
  | { kind: 'text'; id: string; text: string }
  | TranscriptTool
  | { kind: 'tools'; id: string; tools: TranscriptTool[] }
  | { kind: 'plan'; id: string; entries: { content: string; status: 'pending' | 'in_progress' | 'completed' }[] }
  | {
      kind: 'agents'
      id: string
      advisor?: boolean
      earlier?: boolean
      agents: (import('@ramu/shared/types').AgentTask & {
        id: string
        type: string
        log?: string
      })[]
    }
  | {
      kind: 'question'
      id: string
      questions: AgentQuestion[]
      answers?: Record<string, string>
      submitted?: Record<string, string>
      outcome?: string
      reason?: string
      responseMode?: 'message' | 'ramu'
      grouping?: 'together' | 'independent'
    }
  | { kind: 'permission'; id: string; title: string; command: string; decision?: 'allow' | 'deny' }
  | { kind: 'elicitation'; id: string; request: import('@ramu/shared/types').AgentElicitation; outcome?: string }
  | {
      kind: 'changes'
      id: string
      /** The change review this card opens, as on the desktop's end-of-turn Changes card. */
      reviewId: string
      files: { id: string; path: string; additions: number; deletions: number }[]
      additions: number
      deletions: number
      undone: boolean
    }
  | { kind: 'goal'; id: string; objective: string; turns: number; detail?: string }
  /** Turn boundary from a provider result or a terminal state; drives the Worked-for fold and is never drawn. */
  | { kind: 'end'; id: string; ended: boolean; interrupted: boolean }
  /** Live "Working for 12s" rule above the steps of the running turn. */
  /** A status line between turns, as on the desktop: settings changed, continued after restart, context compacted. */
  | {
      kind: 'note'
      id: string
      title: string
      detail?: string
      failed?: boolean
      /** Set on a goal's turning-point note, so the title follows the app language. */
      goalNote?: import('@ramu/shared/chat/goalHistory').GoalChangeType
      wait?: boolean
      /** Set on the usage-limit note: when it is expected to lift, and whether that time is only a guess. */
      limit?: { retryAt: number; guessed: boolean; provider?: import('@ramu/shared/types').AgentProvider }
      settings?: import('@ramu/shared/types').AgentSettings
      previous?: import('@ramu/shared/types').AgentSettings
      /** A model change waiting for the next send: shown at the end of the chat, with no switch-back action. */
      pending?: boolean
    }
  /** A finished turn's routine steps folded under "Worked for 12m 48s". */
  | { kind: 'summary'; id: string; label: string; items: TranscriptItem[] }
) & { at?: number; requestSource?: { sessionId: string; agentId: string; name: string; requestId?: string } }

export interface Chat extends Task {
  executionState?: import('@ramu/shared/types').AgentSessionState
  compacting?: boolean
  activityLabel?: string | null
  /** When the running turn began, for its elapsed time. */
  turnStartedAt?: number | null
  /** What the agent is doing now, for the line above the composer. */
  step?: import('@ramu/shared/chat/agentActivity').AgentStep | null
  /** The running turn's latest actions, for the working sheet. */
  steps?: import('@ramu/shared/chat/agentActivity').TurnStep[]
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
