// Which MCP calls skip the provider's own approval card, decided the same way for every provider. A call skips it when
// Ramu already decides on the host: the person's access mode allows it, or the tool asks the person itself.
import type { AgentSettings } from '@ramu/shared/types'

/**
 * Ramu tools that need no provider card in Allow edits, because each either asks the person itself or only manages
 * the conversation: questions, goals, the advisor, the parent and sub-agent channel, the mark on a command the agent
 * is waiting on and reads of Ramu's own records.
 */
const SELF_GATED = new Set([
  // Questions and secrets only show the person a card; what the agent then runs still asks as usual.
  'ask_user',
  'request_secret',
  'question_status',
  'wait_for_answer',
  'close_question',
  'advisor',
  'wait_for_advice',
  'ask_parent',
  'message_parent',
  'answer_subagent',
  'set_goal',
  'get_goal',
  'update_goal',
  // Only says which of the thread's own running commands the agent is waiting on; it starts and stops nothing.
  'background_wait',
  'tool_search',
  'memory_read',
  'session_recall',
  'session_search',
  // These show Ramu's own approval card outside Full access; settings changes wait in theirs for Apply.
  'thread_start',
  'thread_continue_in_worktree',
  'project_add',
  'settings_find',
  'settings_change',
  // Reaches nothing but Shared MCP calls, each through the gateway, which asks when the tool needs it.
  'run_script',
])
/** Browser and computer handlers enforce their own run-scoped approval; enabling computer use is the grant. */
const OWN_APPROVAL = /^(browser|computer)_/
const gated = (name: string) => SELF_GATED.has(name) || OWN_APPROVAL.test(name)

/** A Ramu tool by its bare name; a deferred call through tool_invoke is judged by the tool it invokes. */
export function selfGatedRamuTool(name: string, input?: Record<string, unknown>): boolean {
  if (name === 'tool_invoke') return typeof input?.name === 'string' && gated(input.name)
  return gated(name)
}

/** The server a provider-side MCP call went to, as far as the approval card needs to know. */
export type McpCallServer = 'ramu' | 'shared_mcp' | 'other'

/**
 * True when Ramu answers a provider's approval request for this MCP call itself, without a card. Auto and Full trust
 * Ramu's own server, whose handlers still check scope; Shared MCP tools are authorized again by the gateway on every
 * call, which asks the person when the approval requires it, so a provider card would ask twice for one call.
 */
export function mcpCallSkipsCard(
  access: AgentSettings['access'],
  server: McpCallServer,
  tool: string,
  input?: Record<string, unknown>,
): boolean {
  if (server === 'shared_mcp') return true
  if (server !== 'ramu') return false
  return access === 'auto' || access === 'full' || selfGatedRamuTool(tool, input)
}
