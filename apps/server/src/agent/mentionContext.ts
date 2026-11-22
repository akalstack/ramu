// A message that starts with `@model`, `@custom-agent` or `@images` tells the main agent which helper to start.
import type { AgentModel } from '@ramu/shared/types'
import type { CustomAgent } from '@ramu/shared/customAgents'
import { mentionInstruction, resolveMention, type AbilityModels } from '@ramu/shared/chat/helperMentions'
import { visibleMessage } from '@ramu/shared/chat/visibleMessage'

export interface MentionSources {
  models(): Promise<AgentModel[]>
  agents(): CustomAgent[]
  abilities(): Promise<AbilityModels>
}

/** Adds a line to the message's `<ramu-context>`, joining the block already there or starting one. */
export function addContextLine(prompt: string, line: string): string {
  const close = prompt.lastIndexOf('\n</ramu-context>')
  if (close >= 0 && prompt.includes('<ramu-context>')) return `${prompt.slice(0, close)}\n${line}${prompt.slice(close)}`
  return `${prompt}\n\n<ramu-context>\n${line}\n</ramu-context>`
}

/** The message with the helper it asks for named in its context; unchanged when it names none or a lookup fails. */
export async function withMentionInstruction(prompt: string, sources: MentionSources): Promise<string> {
  const text = visibleMessage(prompt)
  if (!text.trimStart().startsWith('@')) return prompt
  const [models, abilities] = await Promise.all([
    sources.models().catch(() => []),
    sources.abilities().catch(() => ({})),
  ])
  let agents: CustomAgent[] = []
  try {
    agents = sources.agents()
  } catch {
    // Custom agents are optional; a model or ability can still be named.
  }
  const target = resolveMention(text, models, agents, abilities)
  return target ? addContextLine(prompt, mentionInstruction(target)) : prompt
}
