import { INTERACTIVE_GUIDE } from '../interactive/tools'
import { BACKGROUND_TERMINAL_GUIDE } from './backgroundTerminalTools'
import { BACKGROUND_PREAMBLE } from '@ramu/shared/chat/agentTasks'
import { QUESTION_INPUT_GUIDANCE, QUESTION_PREAMBLE } from '@ramu/shared/chat/questions'
import { ADVISOR_PREAMBLE } from './advisor'
import { TOOL_PRESENTATION_PREAMBLE, USER_MESSAGE_PREAMBLE } from './agentInstructions'
import { NATIVE_TOOL_DISCOVERY_INSTRUCTIONS, TOOL_DISCOVERY_INSTRUCTIONS } from '../intelligence'
import { NATIVE_SUBAGENT_PREAMBLE } from './constants'
import { NO_AGENT_CREDITS_GUIDANCE } from '@ramu/shared/workspace/agentCredits'

// Async questions off: ask_user waits for answers, so the status, wait and close guidance would be unused tokens.
const BLOCKING_QUESTION_PREAMBLE = `Use Ramu's ask_user tool for clarification; it waits for the answer before returning. ${QUESTION_INPUT_GUIDANCE} Group related questions with grouping="together" when their answers must be used together; use "independent" only when each answer is independently useful. Set dependsOn to explain exactly which decision or work needs the answer. Native blocking questions and permission approvals still require an answer. Never assume an unanswered required decision.`

const SECRET_PREAMBLE =
  "A token, password, PIN or pairing code only the user can give: call Ramu's request_secret tool, never ask in chat or tell the user to set it up themselves. Not for access you already have."

/** Which optional sections a chat's guidance includes; the text of each section is supplied by the caller or defined here. */
export interface GuidanceSections {
  /** Ramu's async questions, Ramu's questions made blocking, or only the provider's own question tool. */
  questions: 'async' | 'blocking' | 'native'
  background: boolean
  advisor: boolean
  /** Main chats get request_secret; helpers have no card of their own to show. */
  secrets?: boolean
  /** Goal instructions; main chats only. */
  goal: string | null
  /** The provider's own sub-agent tool cannot be switched off, so the model is told not to use it. */
  nativeSubagentNote: boolean
  memory: string | undefined
  toolSearch: boolean
  /** The provider finds MCP tools on demand itself, so Ramu's tools are listed but may not be in view. */
  nativeToolSearch?: boolean
  learning: string | undefined
  /** User-written rules, labelled as the user's own instructions. */
  rules?: string | undefined
  browser?: string | undefined
  /** Asks the agent to leave its co-author trailers and attribution footers out of commits and pull requests. */
  noCredits?: boolean
}

/** The guidance appended to a chat's system prompt (or sent ahead of its first prompt) through the Ramu tool connection. */
export function sessionGuidance(sections: GuidanceSections): string {
  const questions =
    sections.questions === 'async'
      ? QUESTION_PREAMBLE
      : sections.questions === 'blocking'
        ? BLOCKING_QUESTION_PREAMBLE
        : 'When you need a decision from the user, ask with your built-in question tool and wait for the answer. Never assume an unanswered decision.'
  let instructions = `${USER_MESSAGE_PREAMBLE}\n\n${TOOL_PRESENTATION_PREAMBLE}\n\n${questions}`
  if (sections.background) instructions += `\n\n${BACKGROUND_PREAMBLE}`
  if (sections.advisor) instructions += `\n\n${ADVISOR_PREAMBLE}`
  if (sections.secrets) instructions += `\n\n${SECRET_PREAMBLE}`
  if (sections.goal !== null) instructions += `\n\n${sections.goal}`
  if (sections.nativeSubagentNote) instructions += `\n\n${NATIVE_SUBAGENT_PREAMBLE}`
  if (sections.memory) instructions += `\n\n${sections.memory}`
  instructions += `\n\n${BACKGROUND_TERMINAL_GUIDE}`
  // Whichever search defers the tools, the agent still needs to know artifacts exist.
  if (sections.toolSearch || sections.nativeToolSearch) instructions += `\n\n${INTERACTIVE_GUIDE}`
  if (sections.toolSearch) instructions += `\n\n${TOOL_DISCOVERY_INSTRUCTIONS}`
  else if (sections.nativeToolSearch) instructions += `\n\n${NATIVE_TOOL_DISCOVERY_INSTRUCTIONS}`
  if (sections.learning) instructions += `\n\n${sections.learning}`
  if (sections.browser) instructions += `\n\n${sections.browser}`
  if (sections.noCredits) instructions += `\n\n${NO_AGENT_CREDITS_GUIDANCE}`
  if (sections.rules) instructions += `\n\n${sections.rules}`
  return instructions
}
