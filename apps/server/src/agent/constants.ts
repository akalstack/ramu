import type { AgentSessionState } from '@ramu/shared/types'

/** How long a foreground sub-agent holds its parent's tool call open before turning into a background one. */
export const FOREGROUND_WAIT_MS = 45 * 60_000
/** How long a sub-agent's question waits for an answer before it carries on by itself. */
export const ASK_WAIT_MS = 10 * 60_000

/** States in which the agent may be changing files. A finished (idle) turn is not writing. */
export const WRITING_STATES: AgentSessionState[] = ['starting', 'running', 'needs-input']

/** Cursor and Antigravity cannot have their own sub-agent tool switched off, so the model is told not to use it. */
export const NATIVE_SUBAGENT_PREAMBLE = `Sub-agents run through Ramu in this chat. Do not use your built-in sub-agent, Task or delegation tools. To delegate work, call the ramu_agent tool with a description and prompt instead; it can run the helper on a different provider or model and tracks it for the user.`
