import type { Options, PermissionResult, Query, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { AdviceStatus, AgentProvider, AgentTaskStatus } from '@ramu/shared/types'
import type { Isolation } from '../workspace/isolation'
import type { InputQueue } from './inputQueue'

/** Starts one Claude Agent SDK query; replaced in tests. */
export type QueryFn = (params: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => Query

/** A sub-agent chat running on behalf of a parent chat. */
export interface ChildRun {
  parentId: string
  name: string
  type?: string
  prompt: string
  /** Waiting for the result as a tool result; otherwise it is reported with a message. */
  waiter?: (result: SubagentResult) => void
  report: boolean
  /** A question to the parent that is waiting for its answer. */
  asking?: (answer: string) => void
  settled: boolean
  promptSeen: boolean
  isolation?: Isolation
  lastText: string
  toolUses: number
  startedAt: number
}
export interface SubagentInput {
  description: string
  prompt: string
  type?: string
  background?: boolean
  name?: string
}
export interface SubagentResult {
  agentId: string
  name: string
  status: AgentTaskStatus
  report: string
  provider: AgentProvider
  model: string
}

export interface AdviceRequest {
  sessionId: string
  status: AdviceStatus
  /** Tool calls currently waiting; advice that was waited for is not delivered again as a message. */
  waiters: number
  abort: AbortController
  done: Promise<void>
}

/** A permission or question the user has not answered yet. */
export interface PendingRequest {
  kind: 'permission' | 'question'
  input: Record<string, unknown>
  resolve: (r: PermissionResult) => void
}

/** The live Claude SDK query behind a chat. */
export interface LiveSession {
  query: Query
  input: InputQueue
  abort: AbortController
  pending: Map<string, PendingRequest>
  done?: Promise<void>
}
