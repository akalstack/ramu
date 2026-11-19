import type { AgentSessionState } from '@ramu/shared/types'

/** Session states that get a label in the chat header. */
export const STATE_LABEL: Partial<Record<AgentSessionState, string>> = {
  'needs-input': 'Needs your input',
  failed: 'Failed',
}

/** Session states in which the agent can take messages. */
export const LIVE: AgentSessionState[] = ['starting', 'running', 'needs-input', 'idle']
/** How close to the bottom the reader counts as following the latest output. */
export const NEAR_BOTTOM_PX = 80

/** Turns drawn at a time; a chat can have hundreds. */
export const TURN_PAGE = 20
/** Sent when you resume a stopped turn. The visible part is empty, so it never shows as a chat message. */
export const RESUME_PROMPT = '\n\n<ramu-context>\nContinue where you left off.\n</ramu-context>'
