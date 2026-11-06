import type { ChatGoal } from './goal'
import type { Schedule } from './schedule'
import type { UsageReading } from './usage'

export type AgentProvider = 'claude-code' | 'codex' | 'opencode' | 'cursor' | 'antigravity'
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra'

export interface AgentSettings {
  provider: AgentProvider
  /** Pinned credential profile. Existing chats without this field use the original CLI account. */
  accountId?: string
  /** Empty means the provider's default. */
  model: string
  effort: ReasoningEffort | null
  serviceTier?: 'standard' | 'fast'
  access: 'edits' | 'auto' | 'full'
  autoFallback: boolean
  /**
   * This thread's own choice for continuing by itself after a usage limit. Unset follows `fallback.autoResume` live, so it is
   * not a copy of the global value. Sub-agents and the advisor inherit the parent's effective value. Change it with
   * `agent.setAutoResume`, not `agent.configure`.
   */
  autoResume?: boolean
}
/** Safe connection details; provider configuration, headers and credentials never cross the API. */
export interface AgentMcpServer {
  name: string
  status: string
  toolCount?: number
  error?: string
}
export interface AgentMcpStatus {
  supported: boolean
  live: boolean
  servers: AgentMcpServer[]
  source?: 'live' | 'snapshot' | 'configuration'
  canReconnect?: boolean
  canReload?: boolean
}

export interface AgentModel {
  provider: AgentProvider
  id: string
  name: string
  efforts: ReasoningEffort[]
  defaultEffort: ReasoningEffort | null
  isDefault: boolean
  /** Older but still selectable. Classified by the execution host; never invalidates a saved thread. */
  isLegacy?: boolean
  serviceTiers?: string[]
  /** Context capacity reported by the provider, in tokens; absent when not exposed. */
  contextWindow?: number
  /** ISO date the model came out, from public model catalogs when the host may look them up. */
  releasedAt?: string
  /** ISO date its provider retires it, when one is announced and still ahead. */
  retiresAt?: string
}
/** A model a provider started offering after the host already knew that provider, until a device dismisses it. */
export interface ModelNotice {
  provider: AgentProvider
  model: string
  name: string
  at: number
}

export interface ProviderCatalog {
  provider: AgentProvider
  models: AgentModel[]
  error?: string
}
export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  provider: 'claude-code',
  model: '',
  effort: null,
  access: 'full',
  autoFallback: true,
  serviceTier: 'standard',
}

export type AgentSessionState =
  | 'starting'
  | 'running'
  | 'needs-input'
  | 'idle'
  | 'failed'
  | 'stopped'
  /** Transcript restored from disk; no live process. */
  | 'restored'

/** Why a conversation is carried to a provider session that has not seen it. */
export type HandoffCause = 'limit' | 'switch' | 'account' | 'resume-unavailable' | 'rewind'
/**
 * The handoff recorded on a `settings` event. The cause and (for a delta) `fromSeq` are set when the switch is made; the
 * coverage fields (`toSeq`, `chars`, `omitted`, `shortened`) are filled in place when the next launch builds the prompt.
 * Event numbers are 1-based positions in the thread's event log, the same numbers `session_recall` takes.
 */
export interface HandoffInfo {
  cause: HandoffCause
  mode: 'full' | 'delta'
  /** The provider the thread came from. */
  from?: AgentProvider
  /** First event carried. A delta starts after the last event the target provider already saw. */
  fromSeq?: number
  /** Last event carried; absent until the handoff has been built. */
  toSeq?: number
  /** Size of the handoff block in characters. */
  chars?: number
  /** Events left out of the transcript, in whole. */
  omitted?: number
  /** Events kept but cut short (old tool results, tool calls and assistant text). */
  shortened?: number
  /** Older history represented by a saved summary rather than replayed verbatim. */
  checkpointSeq?: number
  /** Destination capacity used for this transfer; persisted so launch uses the same budget as preflight. */
  contextWindow?: number
}

/**
 * Setup a thread had before a switch, fallback or account change that the destination cannot take over as it was.
 * Names only: it points at what to fix, never at a rule's text or a server's address.
 */
export interface SetupOmission {
  kind: 'shared-mcp' | 'rule'
  name: string
  /** Why it is missing at the destination: the destination login's readiness, or `too-large` for rules over its size. */
  status: 'approval-needed' | 'sign-in-required' | 'unsupported' | 'not-checked' | 'too-large'
}

/** Fields of the `provider-wait` event: a thread held at a usage limit, to be continued at `retryAt`. `retryAt` null ends the wait. */
export interface ProviderWaitFields {
  retryAt: number | null
  retryDelay?: number
  updatedAt: number
  /** The retry time is a backoff guess, not a reset the provider reported. */
  guessed?: boolean
  /** The login that is limited, for threads that share one limit. */
  provider?: AgentProvider
  accountId?: string
  /** Set once the user was told the limit reset while auto-resume is off, so a restart does not tell them again. */
  resetNotifiedAt?: number
  /** Why the thread is held, when it is not only the limit (for example a handoff that does not fit another model). */
  reason?: string
}

export type PermissionScope = 'once' | 'project' | 'user'
export interface SavedPermissionRule {
  id: string
  provider: AgentProvider
  scope: 'project' | 'user'
  projectId?: string
  projectName?: string
  label: string
  pattern?: string
  behavior?: 'allow' | 'ask'
  autoOnly?: boolean
  builtin?: string
  createdAt: number
}
export interface PermissionRemoval {
  scope: 'user' | 'project' | 'projects' | 'all'
  projectId?: string
}

/** Bounded, host-authored list context. IDs address the existing request in its owning session. */
export interface ThreadInputRequest {
  sessionId: string
  requestId: string
  kind: 'approval' | 'question' | 'connector'
  title: string
  source?: { sessionId: string; agentId: string; name: string; requestId?: string }
  /** The MCP server a `connector` request is for, so the Inbox can group threads waiting on the same sign-in. */
  connector?: string
  /** One-tap answers, for a single single-choice question: its answer key and option labels. */
  choices?: { key: string; options: string[] }
}
/** Independently running helpers of a thread's main sessions; advisors, shell commands and restored activity are excluded. */
export interface ThreadHelperSummary {
  active: number
  /** Active helpers held on input or a provider limit. */
  waiting: number
}
export interface ThreadInputSummary {
  count: number
  approvals: number
  /** Connector requests among `count`. */
  connectors: number
  /** At most three requests, approvals first. Open the thread to review all requests. */
  requests: ThreadInputRequest[]
}

export interface AgentSessionInfo {
  /**; null means no unresolved request. */
  inputSummary?: ThreadInputSummary | null
  /** Overview-only fields; native helpers remain owned by their parent provider session. */
  pendingInput?: boolean
  waitingUntil?: number | null
  nativeTask?: AgentTask
  id: string
  taskId: string
  provider: AgentProvider
  settings: AgentSettings
  cwd: string
  additionalDirs: string[]
  covers: string[]
  state: AgentSessionState
  providerSessionId: string | null
  /** Set for a sub-agent Ramu runs as its own session; it belongs to that chat and is not listed. */
  parentId?: string | null
  createdAt: number
  /** The first prompt, used as the conversation's title. */
  title: string
}

export interface ElicitationField {
  id: string
  label: string
  description?: string
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array'
  required: boolean
  options: { value: string; label: string }[]
  defaultValue?: string
}
export interface AgentElicitation {
  requestId: string
  serverName: string
  message: string
  mode: 'form' | 'url'
  fields: ElicitationField[]
  url?: string
  schema?: Record<string, unknown>
}
export type ElicitationAction = 'accept' | 'decline' | 'cancel'
/** The person's reply to a `secret-request`: the value, optionally kept as its environment variable, or a decline. */
export type SecretAnswer = { type: 'save'; secret: string; remember?: boolean } | { type: 'decline' }

export interface AgentQuestion {
  id?: string
  question: string
  header: string
  multiSelect: boolean
  options: { label: string; description: string }[]
}

export interface Attachment {
  id: string
  name: string
  size: number
  mimeType: string
  path: string
}
export interface QueuedMessage {
  id: string
  text: string
  mode?: 'queue' | 'steer'
  attachments?: Attachment[]
  reviewId?: string
  /** Background feedback must still belong to the checked-out branch when it is sent. */
  checkout?: { cwd: string; branch: string }
}

/** When the event was recorded (ms). Absent on events stored before timestamps existed.
 *  `agentId` marks text and tool events that a sub-agent produced; they belong to that agent's own transcript, not the main one. */
export type AgentEvent = AgentEventBody & {
  at?: number
  agentId?: string
  requestSource?: { sessionId: string; agentId: string; name: string; requestId?: string }
}

export type AgentTaskStatus = 'running' | 'completed' | 'failed' | 'stopped'
/** A sub-agent or background task the main agent started. Recorded once and updated in place as it progresses. */
/** A teammate the person adds: Review reads and reports; Take over edits while the lead waits, then hands back. */
export type TeammateMode = 'review' | 'take-over'

/** What a helper's own session did, read from its events. */
export interface AgentWork {
  /** Files its edits and writes changed. */
  files: number
  /** The first of those files, as the provider named them. */
  paths: string[]
  added: number
  removed: number
  /** Turns it finished. */
  turns: number
  /** Cost the provider reported for those turns; null when it reported none. */
  costUsd: number | null
}

export interface AgentTask {
  /** Ramu-owned session; absent for native provider helpers without a separate session. */
  childSessionId?: string
  /** Authoritative dependency state; never inferred from summary wording. */
  waitingFor?: 'provider' | 'input' | null
  /** Explicitly resumed after a terminal task state. */
  resumedAt?: number
  agentId: string
  /** The tool call that started it, when there is one. */
  toolUseId?: string
  name: string
  /** Claude subagent type (e.g. "Explore") or Codex agent role. */
  agentType?: string
  /** What a helper started with `ramu_agent` is for, when the agent said. */
  role?: import('../chat/helperRoles').HelperRole
  /** Claude task kind: local_agent, local_bash, … Absent for Codex sub-agents. */
  taskType?: string
  /** Set for a teammate the person added, rather than a helper the agent started. */
  teammate?: TeammateMode
  /** The exchange with this teammate paused for the person after a few rounds; its latest report waits until they continue. */
  paused?: boolean
  /** A teammate's changes and usage so far, updated as each turn ends. */
  work?: AgentWork
  status: AgentTaskStatus
  /** Keeps running after the main turn ends. */
  background?: boolean
  prompt?: string
  /** Latest progress summary, or the final report. */
  summary?: string
  lastTool?: string
  error?: string
  tokens?: number
  toolUses?: number
  durationMs?: number
  startedAt?: number
  endedAt?: number
  /** What the main agent uses to address it (Claude agent name or id, Codex thread id). */
  address?: string
  canStop?: boolean
  canMessage?: boolean
  /** Restored from provider history; its previous process no longer exists. */
  recovered?: boolean
  recoveryError?: string
  /** Native parent session where recovered helper history belongs, including helpers discovered after fallback. */
  providerSessionId?: string
  /** Works in its own copy of the checkout; its changes are applied back when it finishes. */
  isolated?: boolean
  /** Where it actually runs, when Ramu chose it (cross-provider or fallback). */
  provider?: AgentProvider
  model?: string
  effort?: ReasoningEffort | null
  /** Provider switches along the way, oldest first. */
  steps?: { provider: AgentProvider; model?: string; reason: string; at: number }[]
}
/** The shared ACP tool taxonomy; native adapters can supply the same metadata. */
export type AgentToolKind =
  'read' | 'edit' | 'delete' | 'move' | 'search' | 'execute' | 'think' | 'fetch' | 'switch_mode' | 'other'
export type AgentToolStatus = 'pending' | 'in_progress' | 'completed' | 'failed'
export type AgentContent =
  | { type: 'text'; text: string }
  | { type: 'image'; mimeType: string; data?: string; uri?: string; alt?: string }
  | { type: 'audio'; mimeType: string; data: string }
  | {
      type: 'resource'
      uri: string
      name: string
      mimeType?: string
      text?: string
      blob?: string
      description?: string
    }
  | { type: 'diff'; path: string; oldText: string | null; newText: string }
  | { type: 'terminal'; terminalId: string; output?: string }
  | { type: 'unsupported'; label: string; detail?: string }
export interface AgentToolDetails {
  toolKind?: AgentToolKind
  status?: AgentToolStatus
  title?: string
  input?: string
  content?: AgentContent[]
  locations?: { path: string; line?: number }[]
}
type AgentEventBody =
  | { kind: 'interactive'; reference: import('../interactive').InteractiveReference }
  /** A theme the agent drafted. It is only shown: the person previews, keeps or discards it on their own device. */
  | { kind: 'theme'; theme: import('../theme').RamuTheme }
  | { kind: 'goal'; goal: ChatGoal | null }
  | { kind: 'schedule'; schedule: Schedule }
  /** Threads this thread's agent started; each opens on its own. */
  | { kind: 'threads-started'; threads: StartedThread[] }
  /** One ability call (an image, a web search, a long read) that Ramu ran on a provider that has the ability. */
  | { kind: 'ability'; call: import('../providers/abilities').AbilityCall }
  | ({ kind: 'provider-wait' } & ProviderWaitFields)
  | { kind: 'queue'; messages: QueuedMessage[]; paused?: boolean }
  | { kind: 'user'; text: string; attachments?: Attachment[] }
  | { kind: 'file-restore'; userSeq: number; fileCount: number }
  /** Recorded on a teammate's own session: how it works beside the lead. Review is read-only whatever the thread allows. */
  | { kind: 'teammate'; mode: TeammateMode; name: string }
  /**
   * Recorded on the lead's session when the person writes to a teammate, so the thread shows what each report answers.
   * Only shown: the teammate gets the message in its own session, and the lead never receives it.
   */
  | { kind: 'teammate-message'; teammateId: string; name: string; text: string }
  /** Recorded on a helper's session when it runs a custom agent, so its read-only choice holds across restarts. */
  | { kind: 'custom-agent'; name: string; readOnly: boolean }
  /** Recorded on a helper's session when the agent gave it a role, so a read-only role holds across restarts. */
  | { kind: 'helper-role'; role: import('../chat/helperRoles').HelperRole }
  /** This thread continues on another host. The original stays and links to it. */
  | { kind: 'continued'; hostId: string; host: string; taskId: string; title: string }
  | { kind: 'background-terminal-stop'; terminalId: string; command: string }
  | {
      kind: 'init'
      model: string
      cwd: string
      providerSessionId: string
      provider?: AgentProvider
      mcpServers?: AgentMcpServer[]
    }
  | { kind: 'text'; text: string; messageId?: string; nativeMessageId?: string }
  | { kind: 'content'; content: AgentContent[]; messageId?: string }
  | {
      kind: 'plan'
      messageId: string
      entries: {
        content: string
        status: 'pending' | 'in_progress' | 'completed'
        priority: 'low' | 'medium' | 'high'
      }[]
    }
  | ({ kind: 'tool-use'; toolUseId: string; name: string; summary: string } & AgentToolDetails)
  | ({
      kind: 'tool-result'
      toolUseId: string
      isError: boolean
      summary: string
      running?: boolean
    } & AgentToolDetails)
  | { kind: 'turn-diff'; turnId: string; diff: string }
  | {
      kind: 'permission-request'
      requestId: string
      toolName: string
      title: string
      detail: string
      approvalReviewRule?: string
      approvalOnceOnly?: boolean
      approvalKey?: string
      approvalCommand?: string
      approvalPatterns?: string[]
      approvalProjectId?: string
      approvalSessionId?: string
      approvalProvider?: AgentProvider
    }
  /** Plan usage a provider reported. Handed to the usage store and never recorded in the chat. */
  | { kind: 'usage'; readings: UsageReading[] }
  /** A title the provider generated for the session. Handed to thread titles and never recorded in the chat. */
  | { kind: 'title'; title: string }
  /** How full the model's context window is. Pushed to the chat's view and never recorded. */
  | { kind: 'context'; used: number; max: number }
  /** Reasoning the provider chose to show: Claude thinking blocks, Codex reasoning summaries. */
  | { kind: 'thinking'; text: string; messageId?: string }
  | ({ kind: 'elicitation' } & AgentElicitation)
  | {
      kind: 'question'
      requestId: string
      questions: AgentQuestion[]
      responseMode?: 'message' | 'ramu'
      grouping?: 'together' | 'independent'
      dependsOn?: string
    }
  /** A secret only the person can give. The value never enters events; the agent gets an owner-only file. */
  | {
      kind: 'secret-request'
      requestId: string
      label: string
      reason: string
      placeholder?: string
      /** An environment variable the card offers to keep the value as, for later threads. */
      envName?: string
    }
  | {
      kind: 'question-state'
      requestId: string
      answers?: Record<string, string>
      drafts?: Record<string, string>
      waiting?: boolean
      reason?: string
    }
  | {
      kind: 'recovery'
      state: 'resumed'
      /** What the thread's setup lacks now that it continues: re-resolved on this host before the resume prompt. */
      setupOmissions?: SetupOmission[]
    }
  | { kind: 'request-resolved'; requestId: string; outcome: string; savedApprovalId?: string }
  | {
      kind: 'result'
      isError: boolean
      text: string
      costUsd: number | null
      /** Tokens the turn used, where the provider reports them; input includes cached reads. */
      tokens?: { input: number; output: number }
    }
  | {
      kind: 'compaction'
      state: 'started' | 'completed' | 'failed' | 'cancelled' | 'unknown'
      providerStatus?: string
      summary?: AgentContent[] | null
      error?: string | null
      compactionId?: string
      beforeTokens?: number
      afterTokens?: number
      contextWindow?: number
    }
  | { kind: 'error'; message: string }
  | { kind: 'state'; state: AgentSessionState }
  | {
      kind: 'settings'
      settings: AgentSettings
      reason: string
      handoff: boolean
      previous?: AgentSettings
      /** Moved here by usage-limit fallback, not by the person: the thread returns to where it was before once that has room. */
      limitMove?: boolean
      /** Why the conversation is handed over and, once the next launch has built it, what was carried. Present only with `handoff`. */
      handoffInfo?: HandoffInfo
      /** Shared MCP connections the new login cannot use yet, so the person can review access or choose another login. */
      mcpAttention?: {
        name: string
        /** The connection, so a fallback can tell one this thread has already used from one it never touched. */
        connectionId?: string
        status: 'approval-needed' | 'sign-in-required' | 'unsupported' | 'not-checked'
      }[]
      /** What the destination login lacks from the thread's agent setup, checked on the execution server before launch. */
      setupOmissions?: SetupOmission[]
    }
  | ({ kind: 'agent' } & AgentTask)

export type PermissionReply = { requestId: string; allow: boolean; message?: string }
export type QuestionReply = { requestId: string; answers: Record<string, string> }

/** How much of the model's context window a chat uses right now. */
export interface ContextUsage {
  used: number
  max: number
  percent: number
  at: number
}

/** A side question about the chat, answered without touching the main conversation. */
export interface AsideMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  at: number
  provider?: AgentProvider
  model?: string
  error?: boolean
}
export interface Aside {
  id: string
  sessionId: string
  quote: string
  quoteFrom: 'assistant' | 'user'
  messages: AsideMessage[]
  createdAt: number
}

/** The per-chat tool server a provider connects to. `nativeSubagents: false` turns the provider's own sub-agent tools off so Ramu's `ramu_agent` is used instead. */
export interface McpConnection {
  url: string
  token: string
  nativeSubagents?: boolean
  instructions?: string
  /** Frozen browser routing guidance from the execution host for this provider process. */
  browserInstructions?: string
  /** Review chats about learned memories: Ramu memory and skill tools only, no built-in file, shell or Git tools. */
  restricted?: boolean
  /** Ramu's exported managed skills for this chat's scope, set only for providers that load them through their own skill system. */
  skillsDir?: string
  /** Shared MCP tools this chat may use, served on their own endpoint and server name (never as `ramu`). */
  externalUrl?: string
  /** Original project/repository directories whose MCP definitions belong to this workspace. */
  mcpConfigDirs?: string[]
  /** The project whose per-project sharing choices apply to this chat's shared servers and skills. */
  sharingProjectId?: string
  /** Codex only: a hook asks Ramu before each of Codex's own sub-agents starts, so Ramu can send it elsewhere. */ interceptSubagents?: boolean
  /** Claude only: Ramu's advisor replaces Claude Code's own, which is turned off. */
  replaceAdvisor?: boolean
  /** Claude only: Ramu's question tools are in use, so Claude Code's own `AskUserQuestion` is turned off. */
  replaceQuestions?: boolean
}

export interface StartedThread {
  taskId: string
  title: string
  projectName: string
  /** The other host it runs on; its `taskId` is that host's, and it opens there. Absent for threads on this host. */
  host?: string
  /** Waiting for that host to come back before it starts. */
  pending?: boolean
  /** Set when the thread exists but its agent did not start; the thread stays for a retry. */
  error?: string
}
