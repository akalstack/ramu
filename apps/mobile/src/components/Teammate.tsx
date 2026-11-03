import type { AgentTask } from '@ramu/shared/types'
import { activeTeammates } from '@ramu/shared/chat/agentTasks'
import type { Chat } from '../runtime/types'

/** The thread's teammates, read from its helper cards; the newest card for each helper wins. */
export function teammatesOf(chat: Chat): AgentTask[] {
  const cards = new Map<string, AgentTask>()
  for (const item of chat.items)
    if (item.kind === 'agents') for (const agent of item.agents) cards.set(agent.agentId, agent)
  return activeTeammates([...cards.values()])
}
