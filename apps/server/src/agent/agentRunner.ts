import type {
  AgentEvent,
  AgentMcpStatus,
  AgentProvider,
  ElicitationAction,
  AgentScope,
  AgentSettings,
  Attachment,
  McpConnection,
} from '@ramu/shared/types'
import type { SelectionTransition } from '../providers/selectionTransition'

/** The provider cannot continue the saved session (no resume support, or it no longer has it). The chat goes on from its transcript. */
export class ResumeUnavailable extends Error {}

/**
 * Another client holds the saved session (the Codex app or CLI has the same conversation open). Starting a new one
 * would quietly split the conversation, so the thread says so and waits for the person instead.
 */
export class SessionInUse extends Error {}

export interface AgentRunner {
  /** Read-only preflight before stopping the process or changing the thread's saved settings. */
  planSettingsTransition?(settings: AgentSettings): SelectionTransition
  /** Whether `steer` accepts input during a turn. Runners without it are always queued. */
  readonly canSteer?: boolean
  /** Steering cancels the running turn instead of adding to it, so only the user's own messages may use it. */
  readonly steerInterrupts?: boolean
  mcpStatus?(): Promise<AgentMcpStatus>
  reconnectMcp?(name: string): Promise<void>
  reloadMcp?(): Promise<void>
  setTools?(connection: McpConnection): void
  /** Serves the runtime's client-terminal requests; given only to providers whose adapter enables `native.terminals`. */
  setTerminals?(host: import('../providers/acpTerminals').AcpTerminalHost): void
  start(prompt: string, resume: string | null, attachments?: Attachment[]): Promise<void>
  send(prompt: string, attachments?: Attachment[]): Promise<void>
  steer(prompt: string, attachments?: Attachment[]): Promise<void>
  interrupt(): Promise<void>
  stop(): Promise<void>
  replyPermission(id: string, allow: boolean): void
  replyElicitation?(id: string, action: ElicitationAction, answers: Record<string, string>): void
  replyQuestion(id: string, answers: Record<string, string>): void
}
export type AgentRunnerFactory = (
  scope: AgentScope,
  settings: AgentSettings,
  /** `usageLimit`: true when the failure is confidently a usage limit, 'low' when only a generic phrase matched. */
  emit: (event: AgentEvent, usageLimit?: boolean | 'low') => void,
  readOnly?: boolean,
  /** A title the provider chose for this conversation. Only runners that verifiably receive one call it; it is never recorded. */
  onTitle?: (title: string) => void,
) => AgentRunner

/**
 * How each provider runs a chat. A provider listed here runs through its runner; one that is not (Claude Code) uses the
 * Claude Agent SDK query loop. Adding a provider means writing one `AgentRunnerFactory` and listing it here.
 */
export type ProviderRunners = Partial<Record<AgentProvider, AgentRunnerFactory>>
