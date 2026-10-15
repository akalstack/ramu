import type {
  AgentEvent,
  ElicitationAction,
  AgentScope,
  AgentSettings,
  Attachment,
  McpConnection,
} from '@ramu/shared/types'

export interface AgentRunner {
  /** Whether `steer` accepts input during a turn. Runners without it are always queued. */
  readonly canSteer?: boolean
  /** Steering cancels the running turn instead of adding to it, so only the user's own messages may use it. */
  readonly steerInterrupts?: boolean
  setTools?(connection: McpConnection): void
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
  emit: (event: AgentEvent, usageLimit?: boolean) => void,
  readOnly?: boolean,
) => AgentRunner
