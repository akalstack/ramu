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
}
export const DEFAULT_INTELLIGENCE_PREFERENCES: IntelligencePreferences = {
  toolSearch: true,
  crossThreadRecall: true,
  // Every proposal is checked for credentials before it is saved, and the person's own notes outrank learned ones, so
  // learning saves on its own rather than stacking reviews for the person to apply.
  learning: 'auto',
  maintenanceModel: null,
  dailyReviews: 5,
  archiveSkillDays: 90,
  summaryInterval: 'weekly',
  summaryMemory: true,
  summarySkills: true,
}
export interface ManagedSkill {
  /** Present only for approved external installs. Supporting files are base64, never executed by Ramu. */
  installation?: { source: string; skill: string; cliVersion: string; markdown: string; files: Record<string, string> }
  /** Approved files and original frontmatter retained by an independently editable copy. Updated only after explicit review. */
  bundle?: { markdown: string; files: Record<string, string> }
  /** The exact managed source revision this editable copy last incorporated. */
  copiedFrom?: { id: string; revision: number }
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
  /** Who made this revision. */
  changedBy: 'learning' | 'cleanup' | 'user' | 'review'
  /** Why a review chat made this revision. */
  changeNote?: string
}

/** A skill listed in the public directory at skills.sh, installed from its GitHub repository by name. */
export interface DirectorySkill {
  /** `owner/repo/skill`. */
  id: string
  /** The GitHub `owner/repo` it installs from. */
  source: string
  /** The skill's name inside that repository. */
  skill: string
  name: string
  installs: number
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

export interface SkillCopyUpdate {
  id: string
  revision: number
  sourceRevision: number
  sourceName: string
  description: { before: string; local: string; source: string; proposed: string; conflict: boolean }
  content: { before: string; local: string; source: string; proposed: string; conflict: boolean }
  files: { path: string; change: 'added' | 'changed' | 'removed'; conflict: boolean }[]
  /** Bounded UTF-8 excerpts are included only when the whole file fits; binary/large files show byte counts. */
  fileVersions: Record<string, Record<'before' | 'local' | 'source', { bytes: number; text?: string } | null>>
}
