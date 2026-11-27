import type { AgentProvider, AgentQuestion, ChatGoal, Project, QueuedMessage, Task } from '@ramu/shared/types'

// Native view models; host IDs are kept separately from computer-scoped UI IDs.

/** `paused`: the person turned this connection off; nothing connects or retries until it is turned on again. */
export type ComputerStatus = 'online' | 'connecting' | 'offline' | 'revoked' | 'paused'

export interface Computer {
  id: string
  name: string
  address: string
  os: 'macos' | 'linux' | 'windows'
  /** What the host runs on, as it reports itself: its icon and the line under its name. Absent until it first answers. */
  system?: import('@ramu/shared/types').DeviceOs
  /** Still carrying the placeholder label; the computer's own hostname replaces it on first contact. */
  auto?: boolean
  status: ComputerStatus
  lastSeen: number
  error?: string
  /** This phone's role on the host, as the host last reported it. Absent means full access. Advisory: the host enforces it. */
  access?: 'owner' | 'viewer'
  /** What pairing bound: this phone's id on the host and, when the host gave one, its durable id. */
  deviceId?: string
  hostId?: string
  /** Other addresses the host named in a proven identity answer; tried only when the saved one stops answering. */
  routes?: string[]
  /**
   * How the phone picks among the routes: `auto` (absent) moves to the fastest that answers (LAN, then VPN, then the
   * internet); `manual` keeps the one the person chose, falling back only when it stops answering.
   */
  routeMode?: 'auto' | 'manual'
  /** The person allowed this host's unencrypted local network, so the phone may leave an encrypted route for it. */
  plainLan?: boolean
}

export type ToolKind = 'read' | 'edit' | 'search' | 'execute' | 'think' | 'fetch' | 'other'
export type ToolStatus = 'in_progress' | 'completed' | 'failed'

export interface TranscriptTool {
  kind: 'tool'
  id: string
  tool: ToolKind
  /** The call as the provider named it, for the line that sums up a group of calls the way the desktop does. */
  source: {
    name: string
    kind: import('@ramu/shared/types').AgentToolKind
    title?: string
    summary: string
    ramu?: string
  }
  verb: string
  subject: string
  status: ToolStatus
  detail?: string
  input?: string
  /** Reads, edits and writes: the full path, file name and line counts behind the compact row. */
  file?: import('@ramu/shared/chat/fileTools').FileToolLine
  /** An edit's changes, shown when its row is opened. */
  diffs?: { path: string; oldText: string | null; newText: string }[]
  /** One of Ramu's own tools: what it did in words, and the few facts that matter, never the raw JSON. */
  ramu?: { done: string; running: string; subject?: string; facts: { label: string; value: string }[] }
}

export type TranscriptItem = (
  | {
      kind: 'error'
      id: string
      message: string
      /** How many times this same error happened back to back, shown once. */
      repeats?: number
    }
  /** What a sub-agent sent back to the thread: who, how it ended (finished, failed, says…), and its words. */
  | { kind: 'report'; id: string; name: string; verb: string; body: string }
  | {
      kind: 'user'
      id: string
      text: string
      at: number
      attachments?: import('@ramu/shared/types').Attachment[]
      /** The host's sequence number, which a revision names. */ seq?: number
      /** The text as sent, including any hidden <ramu-context>. */ raw?: string
      /** Another thread sent it, so it shows as a note from that thread, not the person's bubble. */
      from?: import('@ramu/shared/types').MessageOrigin
      /** Steered into a running turn, which it continues instead of starting a new one. */
      steered?: true
    }
  /** An image the agent returned (MCP or tool content). */
  | {
      kind: 'interactive'
      id: string
      reference: import('@ramu/shared/interactive').InteractiveReference
      /** The newest version and its row, when a later version replaced this one. */
      replacedBy?: { itemId: string; version: number; changes?: string }
      /** The version this one replaced, for carrying values over. */
      previous?: import('@ramu/shared/interactive').InteractiveReference
      update?: import('@ramu/shared/interactiveRevisions').InteractiveUpdate
    }
  | { kind: 'image'; id: string; uri: string; alt?: string }
  /** An ability call (an image, a web search, a long read) that Ramu ran on a provider that has the ability. */
  | { kind: 'ability'; id: string; call: import('@ramu/shared/providers/abilities').AbilityCall }
  /** A theme the agent drafted with `propose_theme`; the person previews it before anything changes. */
  | { kind: 'theme'; id: string; theme: import('@ramu/shared/theme').RamuTheme }
  /** An agent's inline card at its newest version, drawn with the app's own controls. */
  | { kind: 'inline-ui'; id: string; surface: import('@ramu/shared/chat/inlineUi').InlineSurface }
  /** Threads this thread's agent started; each row opens one. */
  | { kind: 'threads'; id: string; threads: import('@ramu/shared/types').StartedThread[] }
  | { kind: 'pull-request-writes'; id: string; cardId: string }
  | { kind: 'test-device-wait'; id: string; platform: import('@ramu/shared/testDevices').TestPlatform }
  | { kind: 'settings-change'; id: string; cardId: string }
  /** A tool Ramu suggests from what the thread did. */
  | { kind: 'tool-suggestion'; id: string; cardId: string }
  /** This thread continues on another host. */
  | { kind: 'continued'; id: string; event: import('@ramu/shared/continuation').ContinuedEvent }
  /** Another thread edited the same file in this checkout during the turn. */
  | { kind: 'checkout-clash'; id: string; path: string; taskId: string }
  /** A command held until another thread's command in this checkout finished. */
  | { kind: 'command-wait'; id: string; taskId: string }
  | { kind: 'text'; id: string; text: string }
  /** Reasoning the provider shared: live while it streams, then folded to "Thought" as on the desktop. */
  | { kind: 'thinking'; id: string; text: string }
  | TranscriptTool
  /** Consecutive tools and the reasoning between them; `entries` keeps arrival order, `tools` only the calls. */
  | {
      kind: 'tools'
      id: string
      tools: TranscriptTool[]
      entries: (TranscriptTool | { kind: 'thinking'; id: string; text: string; at?: number })[]
    }
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
  | {
      kind: 'permission'
      id: string
      title: string
      command: string
      decision?: 'allow' | 'deny'
      /** Where an approval was saved, so it can be forgotten. */
      saved?: 'project' | 'user'
      /** The request can be remembered: for this user, and also for this project when it names one. */
      rememberable?: { project: boolean }
      /** Wider rules the agent offers beside this exact request. */
      patterns?: string[]
      /** A rule that makes this host always ask, shown so the person knows why. */
      reviewRule?: string
      /** Full access still asks for this request; `reason` says why when the host knows. */
      fullAccess?: { reason?: string }
      /** An MCP tool set to Ask: Always allow switches it to Allow. */
      always?: boolean
      /** A production deploy: Allow production deploys in this thread is offered beside Allow once. */
      productionDeploy?: boolean
      /** A new project: its folder name and where it goes, which the person can change before creating. */
      projectLocation?: { name: string; parent: string }
    }
  | { kind: 'elicitation'; id: string; request: import('@ramu/shared/types').AgentElicitation; outcome?: string }
  | {
      kind: 'secret'
      id: string
      request: Extract<import('@ramu/shared/types').AgentEvent, { kind: 'secret-request' }>
      outcome?: string
    }
  | {
      kind: 'changes'
      id: string
      /** The change review this card opens, as on the desktop's end-of-turn Changes card. */
      reviewId: string
      /** `binary`: no line counts, as on the desktop, which says Binary instead. */
      files: { id: string; path: string; additions: number; deletions: number; binary: boolean }[]
      additions: number
      deletions: number
      undone: boolean
    }
  | { kind: 'goal'; id: string; objective: string; turns: number; detail?: string }
  /** What a learning review saved or would save from the turn above it, with Apply, Dismiss or Undo. */
  | { kind: 'learning'; id: string; jobId: string; line: import('@ramu/shared/learningReviews').LearningLine }
  /** Turn boundary from a provider result or a terminal state; drives the Worked-for fold and is never drawn. */
  | { kind: 'end'; id: string; ended: boolean; interrupted: boolean }
  /** Live "Working for 12s" rule above the steps of the running turn. */
  /** A status line between turns, as on the desktop: settings changed, continued after restart, context compacted. */
  | {
      kind: 'note'
      id: string
      /** English, for search and previews. */
      title: string
      /** The catalog copy behind `title`; drawn with translate() so the note follows the app language. */
      titleCopy?: { text: string; values?: import('@ramu/shared/i18n').TranslationValues }
      /** The detail is Ramu's own catalog copy rather than text from the person or an agent, so it is translated. */
      detailIsCopy?: true
      detail?: string
      failed?: boolean
      /** Set on a goal's turning-point note, so the title follows the app language. */
      goalNote?: import('@ramu/shared/chat/goalHistory').GoalChangeType
      /** The goal a turning-point note is about. */
      objective?: string
      wait?: boolean
      /** Set on the usage-limit note: when it is expected to lift, and whether that time is only a guess. */
      limit?: { retryAt: number; guessed: boolean; provider?: import('@ramu/shared/types').AgentProvider }
      settings?: import('@ramu/shared/types').AgentSettings
      previous?: import('@ramu/shared/types').AgentSettings
      /** A model change waiting for the next send: shown at the end of the chat, with no switch-back action. */
      pending?: boolean
      /** A model change the host holds until the provider's own sub-agents and background commands finish. */
      held?: boolean
      /** How many times this same note happened back to back, shown once. */
      repeats?: number
      /** The mark drawn before the title, as the desktop's rows carry one. */
      icon?: NoteIcon
    }
  /** A finished turn's routine steps folded under "Worked for 12m 48s". */
  | {
      kind: 'summary'
      id: string
      label: string
      /** The thread is still at work under this turn, so the row counts up from `since` instead of showing `label`. */
      running?: { since: number; text: 'Working for {0}' | 'Continuing for {0}' }
      items: TranscriptItem[]
    }
) & { at?: number; requestSource?: { sessionId: string; agentId: string; name: string; requestId?: string } }

/** What a status line is about, for its mark. */
export type NoteIcon =
  'compaction' | 'recovery' | 'stop' | 'command' | 'schedule' | 'advice' | 'message' | 'answers' | 'card'

export interface Chat extends Task {
  executionState?: import('@ramu/shared/types').AgentSessionState
  compacting?: boolean
  /** The agent's own background commands still running, listed with its helpers so they can be seen and stopped. */
  commands?: import('@ramu/shared/types').AgentTask[]
  /** Background commands the agent said it was waiting on, running or ended: they keep the last turn's clock going. */
  awaited?: import('@ramu/shared/types').AgentTask[]
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
  /** The opening of the main agent's latest reply as one plain line, for the thread's row. */
  lastReply?: string
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
  /** On a hunk row that stands for collapsed unchanged lines: how many, so the row is drawn in the reader's language. */
  skipped?: number
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
