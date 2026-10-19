import { parseAgentDraft, type AgentDraftChoice } from '@ramu/shared/workspace/agentDefaults'
import type { Store } from '../hostStorage'
const keyOf = (project: string) => `ramu.new-thread-agent:${project}`
const empty: AgentDraftChoice = { version: 1 }
export interface StoredAgentDraft {
  choice: AgentDraftChoice
  problem?: 'storage' | 'invalid'
  serialized?: string | null
}
export function loadAgentDraft(project: string, store: Store | null, now = Date.now()): StoredAgentDraft {
  try {
    if (!store) return { choice: empty, problem: 'storage' }
    const raw = store.getItem(keyOf(project))
    if (raw === null) return { choice: empty, serialized: null }
    if (raw.length > 8192) return { choice: empty, problem: 'invalid' }
    const value = JSON.parse(raw)
    const choice = parseAgentDraft(value)
    if (!choice || typeof value.at !== 'number' || !Number.isFinite(value.at))
      return { choice: empty, problem: 'invalid' }
    return { choice: now - value.at > 30 * 24 * 60 * 60 * 1000 ? empty : choice, serialized: raw }
  } catch {
    return { choice: empty, problem: 'storage' }
  }
}
export function saveAgentDraft(
  project: string,
  choice: AgentDraftChoice,
  store: Store | null,
  now = Date.now(),
): boolean {
  try {
    if (!store || !parseAgentDraft(choice)) return false
    store.setItem(keyOf(project), JSON.stringify({ ...choice, at: now }))
    return true
  } catch {
    return false
  }
}
export function clearAgentDraft(
  project: string,
  expected: AgentDraftChoice,
  store: Store | null,
  serialized?: string | null,
): boolean {
  try {
    if (!store) return false
    if (serialized !== undefined && store.getItem(keyOf(project)) !== serialized) return false
    const current = loadAgentDraft(project, store)
    if (current.problem || JSON.stringify(current.choice) !== JSON.stringify(expected)) return false
    store.removeItem(keyOf(project))
    return true
  } catch {
    return false
  }
}
