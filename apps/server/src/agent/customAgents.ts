import { randomUUID } from 'node:crypto'
import { CUSTOM_AGENT_LIMIT, customAgentHandle, type CustomAgent } from '@ramu/shared/customAgents'
import type { Workspace } from '../workspace/workspace'

const KEY = 'custom-agents'

/** Custom agents live on the host beside its other settings. Provider agent files are neither read nor written. */
export class CustomAgentStore {
  constructor(private readonly workspace: Pick<Workspace, 'getAppState' | 'setAppState'>) {}

  list(): CustomAgent[] {
    return this.workspace.getAppState<CustomAgent[]>(KEY, [])
  }

  save(input: Omit<CustomAgent, 'id' | 'updatedAt'> & { id?: string }): CustomAgent {
    const agents = this.list()
    const clash = agents.find(
      (agent) => agent.id !== input.id && customAgentHandle(agent.name) === customAgentHandle(input.name),
    )
    if (clash) throw new Error(`A custom agent named ${clash.name} already exists.`)
    if (!input.id && agents.length >= CUSTOM_AGENT_LIMIT)
      throw new Error(`Keep at most ${CUSTOM_AGENT_LIMIT} custom agents. Remove one first.`)
    const saved: CustomAgent = { ...input, id: input.id ?? randomUUID(), updatedAt: Date.now() }
    this.workspace.setAppState(KEY, [...agents.filter((agent) => agent.id !== saved.id), saved])
    return saved
  }

  remove(id: string): void {
    this.workspace.setAppState(
      KEY,
      this.list().filter((agent) => agent.id !== id),
    )
  }
}
