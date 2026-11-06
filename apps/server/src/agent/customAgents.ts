import { randomUUID } from 'node:crypto'
import { CUSTOM_AGENT_LIMIT, customAgentHandle, type CustomAgent } from '@ramu/shared/customAgents'
import type { Workspace } from '../workspace/workspace'

const KEY = 'custom-agents'

/**
 * Teammates ready from the first `@`, so a review or tests need no setup first. Ordinary custom agents: the person
 * edits or deletes them like their own, and they are added only to a host that has never saved one.
 */
export const STARTER_AGENTS: Omit<CustomAgent, 'id' | 'updatedAt'>[] = [
  {
    name: 'security-reviewer',
    description: 'Reviews a change for security problems before it ships.',
    instructions:
      'Review the latest changes for security problems: injection, missing authorization checks, secrets in code or logs, unsafe file or shell use, unvalidated input and risky dependencies. Report only real, specific problems, most serious first, each with its file and line and a suggested fix. Say plainly when you find nothing.',
    model: null,
    readOnly: true,
  },
  {
    name: 'test-writer',
    description: 'Adds or updates focused tests for a change.',
    instructions:
      'Write focused tests for the latest change, in the project’s existing test framework and folders. Cover the behavior and the edge cases that matter, not implementation details. Run the tests you touched until they pass. Change the code under test only when a test proves it wrong, and say so.',
    model: null,
    readOnly: false,
  },
  {
    name: 'second-opinion',
    description: 'Gives an independent second look at a plan or a change.',
    instructions:
      'Give an independent second opinion on the current plan or the latest changes. Look for wrong assumptions, missed cases, simpler approaches and anything that could break for people using it. Lead with what you would change and why, then what looks right. Do not repeat what the lead already said.',
    model: null,
    readOnly: true,
  },
  {
    name: 'simplifier',
    description: 'Finds ways to make a change smaller and simpler.',
    instructions:
      'Read the latest changes and point out what could be simpler: duplicated code, abstractions nothing needs, dead code, long functions, and existing helpers the change could reuse. Suggest concrete edits with file paths, most valuable first. Leave style-only changes out.',
    model: null,
    readOnly: true,
  },
]

/** Custom agents live on the host beside its other settings. Provider agent files are neither read nor written. */
export class CustomAgentStore {
  constructor(private readonly workspace: Pick<Workspace, 'getAppState' | 'setAppState'>) {}

  list(): CustomAgent[] {
    const saved = this.workspace.getAppState<CustomAgent[] | null>(KEY, null)
    if (saved) return saved
    const now = Date.now()
    const starters = STARTER_AGENTS.map((agent) => ({ ...agent, id: randomUUID(), updatedAt: now }))
    this.workspace.setAppState(KEY, starters)
    return starters
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
