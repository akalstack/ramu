import { BACKGROUND_PREAMBLE } from '@ramu/shared/agentTasks'
import { QUESTION_PREAMBLE } from '@ramu/shared/questions'
import { ADVISOR_PREAMBLE } from './advisor'
import { TOOL_PRESENTATION_PREAMBLE, USER_MESSAGE_PREAMBLE } from './agentInstructions'
import { TOOL_DISCOVERY_INSTRUCTIONS } from '../intelligence'
import { NATIVE_SUBAGENT_PREAMBLE } from './constants'

/** Which optional sections a chat's guidance includes; the text of each section is supplied by the caller or defined here. */
export interface GuidanceSections {
  asyncQuestions: boolean
  background: boolean
  advisor: boolean
  /** Goal instructions; main chats only. */
  goal: string | null
  /** The provider's own sub-agent tool cannot be switched off, so the model is told not to use it. */
  nativeSubagentNote: boolean
  memory: string | undefined
  toolSearch: boolean
  learning: string | undefined
}

/** The guidance appended to a chat's system prompt (or sent ahead of its first prompt) through the Ramu tool connection. */
export function sessionGuidance(sections: GuidanceSections): string {
  const questions = sections.asyncQuestions
    ? QUESTION_PREAMBLE
    : `${QUESTION_PREAMBLE}\nAsync questions are disabled. Use ask_user (Ramu will wait for an answer) or a native blocking question. Do not use request_user_input_async.`
  let instructions = `${USER_MESSAGE_PREAMBLE}\n\n${TOOL_PRESENTATION_PREAMBLE}\n\n${questions}`
  if (sections.background) instructions += `\n\n${BACKGROUND_PREAMBLE}`
  if (sections.advisor) instructions += `\n\n${ADVISOR_PREAMBLE}`
  if (sections.goal !== null) instructions += `\n\n${sections.goal}`
  if (sections.nativeSubagentNote) instructions += `\n\n${NATIVE_SUBAGENT_PREAMBLE}`
  if (sections.memory) instructions += `\n\n${sections.memory}`
  if (sections.toolSearch) instructions += `\n\n${TOOL_DISCOVERY_INSTRUCTIONS}`
  if (sections.learning) instructions += `\n\n${sections.learning}`
  return instructions
}
