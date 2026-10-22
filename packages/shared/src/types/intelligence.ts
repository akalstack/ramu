import type { AgentProvider, ReasoningEffort } from './agent'

export interface IntelligencePreferences {
  toolSearch: boolean
  crossThreadRecall: boolean
  learning: 'off' | 'review' | 'auto'
  maintenanceModel: { provider: AgentProvider; model: string; effort: ReasoningEffort | null } | null
  dailyReviews: number
  archiveSkillDays: number
  /** How often "What Ramu learned" is written. */
  summaryInterval: 'off' | 'daily' | 'weekly'
  summaryMemory: boolean
  summarySkills: boolean
  summaryOnHome: boolean
}
export const DEFAULT_INTELLIGENCE_PREFERENCES: IntelligencePreferences = {
  toolSearch: true,
  crossThreadRecall: true,
  learning: 'review',
  maintenanceModel: null,
  dailyReviews: 5,
  archiveSkillDays: 90,
  summaryInterval: 'weekly',
  summaryMemory: true,
  summarySkills: true,
  summaryOnHome: true,
}
export interface ManagedSkill {
  /** Present only for approved external installs. Supporting files are base64, never executed by Ramu. */
  installation?: { source: string; skill: string; cliVersion: string; markdown: string; files: Record<string, string> }
  id: string
  projectId: string | null
  name: string
  description: string
  content: string
  status: 'active' | 'disabled' | 'archived'
  /** Providers whose exports carry it. Absent means every provider. */
  providers?: AgentProvider[]
  pinned: boolean
  revision: number
  createdAt: number
  updatedAt: number
  lastUsedAt: number | null
  useCount: number
  sourceSessionId: string
  sourceSeq: number
  /** Who made this revision. Absent on revisions saved before summaries existed. */
  changedBy?: 'learning' | 'cleanup' | 'user' | 'review'
  /** Why a review chat made this revision. */
  changeNote?: string
}

export interface SkillInstallPreview {
  id: string
  source: string
  projectId: string | null
  name: string
  description: string
  markdown: string
  files: { path: string; bytes: number; script: boolean }[]
  updatingId?: string
  changes: { added: string[]; changed: string[]; removed: string[] }
}
export interface LearningJob {
  sessionTitle?: string
  memoryVersions?: Record<string, number>
  skillVersions?: Record<string, number>
  id: string
  sessionId: string
  projectId: string | null
  seq: number
  status: 'queued' | 'running' | 'pending' | 'applied' | 'dismissed' | 'failed'
  createdAt: number
  error: string | null
  proposal: string | null
}
export interface LearningSnapshot {
  skills: ManagedSkill[]
  jobs: LearningJob[]
  running: boolean
}
export interface SessionCheckpoint {
  sessionId: string
  seq: number
  summary: string
  updatedAt: number
}
