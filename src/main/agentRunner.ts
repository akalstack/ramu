import type { AgentEvent, AgentScope, AgentSettings, Attachment, McpConnection } from '../shared/types'

export interface AgentRunner {
  setTools?(connection: McpConnection): void
  start(prompt: string, resume: string | null, attachments?: Attachment[]): Promise<void>
  send(prompt: string, attachments?: Attachment[]): Promise<void>
  steer(prompt: string, attachments?: Attachment[]): Promise<void>
  interrupt(): Promise<void>
  stop(): Promise<void>
  replyPermission(id: string, allow: boolean): void
  replyQuestion(id: string, answers: Record<string, string>): void
}
export type AgentRunnerFactory = (scope: AgentScope, settings: AgentSettings, emit: (event: AgentEvent, usageLimit?: boolean) => void, readOnly?: boolean) => AgentRunner
