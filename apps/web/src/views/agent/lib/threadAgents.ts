import { createContext } from 'react'
import type { AgentTask } from '@ramu/shared/types'

/** The thread's sub-agents, so a report that comes back by name can show who sent it. */
export const ThreadAgents = createContext<readonly AgentTask[]>([])
