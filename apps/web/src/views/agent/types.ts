import type { ChatBlock as Block } from '@ramu/shared/chat/chatFolding'
import type { goalChanges } from '@ramu/shared/chat/goalHistory'
import type { QuestionState } from '@ramu/shared/chat/questions'
import type { AgentEvent, AgentTask, Attachment, ViewDescriptor } from '@ramu/shared/types'

/** The chat view descriptor. */
export type AgentViewDesc = Extract<ViewDescriptor, { kind: 'agent' }>
/** A tool call event. */
export type ToolUse = Extract<AgentEvent, { kind: 'tool-use' }>
/** The result event of a tool call. */
export type ToolResult = Extract<AgentEvent, { kind: 'tool-result' }>

/** One user message and everything the agent did in answer to it. */
export type Turn = {
  key: number
  user: Block | null
  items: Block[]
  ended: boolean
  interrupted?: boolean
  startedAt?: number
  endedAt?: number
}

/** An open aside: an existing one, or a new one carrying its quote. keepFocus leaves the caret in the chat's composer. */
export type AsideTarget = { id: string | null; quote: string; from: 'assistant' | 'user'; keepFocus?: boolean }

/** The sent message being edited in place: its sequence number, text and attachments. */
export type MessageEdit = { seq: number; text: string; files: Attachment[] }

/** Everything the transcript's turns and blocks share: the chat's data, its run state and the handlers they call. */
export interface TranscriptContext {
  sessionId: string
  /** The agent's working directory, so paths in the transcript can be shown relative to it. */
  cwd: string
  taskId: string | undefined
  blocks: Block[]
  results: Map<string, ToolResult>
  outcomes: Map<string, string>
  questionStates: Map<string, QuestionState>
  goalNotes: ReturnType<typeof goalChanges>
  /** The text message the provider is still streaming. */
  liveText: AgentEvent | null
  /** Whether the chat's session can take messages. */
  live: boolean
  working: boolean
  needsInput: boolean
  /** Working, or waiting on your input. */
  busyAgent: boolean
  /** The tools row that carries the live activity label while the agent works. */
  statusGroup: Block | undefined
  activityLabel: string | null | undefined
  /** Whether the last turn was stopped by you or reported as interrupted. */
  stopped: boolean
  /** Time since the last message, while the agent works. */
  elapsed: number | null
  /** The newest assistant message, which keeps its hover actions visible. */
  latestAssistant: Block | undefined
  /** Whether a source message was requested, so folded work keeps its block indexes for navigation. */
  hasSourceSeq: boolean
  eventSequences: Map<AgentEvent, number>
  onBackground: ((toolUseId: string) => void) | undefined
  onOpenAgent: (agentId: string | null) => void
  onStopTask: (task: AgentTask) => void
  onOpenQuestion: (requestId: string) => void
  onEditMessage: (text: string, files: Attachment[], seq?: number) => void
}
