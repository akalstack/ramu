import type { AgentProvider } from './agent'

export interface MemoryPreferences {
  /** Agents of every provider read and write Ramu's shared memory. */
  enabled: boolean
  /** Periodically consolidate memories with a model: merge duplicates, resolve contradictions and retire stale notes. */
  dream: boolean
  /** Unused, low-importance memories are archived after this many days. */
  staleAfterDays: number
}
export const DEFAULT_MEMORY_PREFERENCES: MemoryPreferences = { enabled: true, dream: true, staleAfterDays: 90 }
export const MEMORY_KINDS = ['user', 'feedback', 'project', 'reference'] as const
export type MemoryKind = (typeof MEMORY_KINDS)[number]
/** A durable note shared by every provider. projectId null means it applies everywhere. */
export interface Memory {
  id: string
  projectId: string | null
  kind: MemoryKind
  title: string
  content: string
  tags: string[]
  /** 1 (minor) to 4 (important) drive ranking and decay. 5 (essential) is set only by the user: never forgotten, always given to agents in full. */
  importance: number
  status: 'active' | 'archived'
  /** Why it was archived: stale, merged, contradicted, forgotten by an agent or by the user. */
  archivedReason: string | null
  /** Who created it. confirmed: the user wrote the current text, so it is never forgotten automatically and is quoted in agent instructions. */
  source: {
    actor: 'user' | 'agent' | 'dream'
    provider?: AgentProvider
    sessionId?: string
    taskId?: string
    confirmed?: boolean
    eventSeq?: number
  }
  createdAt: number
  updatedAt: number
  lastUsedAt: number | null
  useCount: number
  expiresAt: number | null
}
export interface MemoryInput {
  projectId: string | null
  kind: MemoryKind
  title: string
  content: string
  tags?: string[]
  importance?: number
  expiresAt?: number | null
}
export interface MemorySnapshot {
  memories: Memory[]
  dreamedAt: number | null
  dreaming: boolean
  error: string | null
  /** Folder holding the markdown files. */ dir?: string | null
}
