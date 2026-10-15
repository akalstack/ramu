import type { AgentProvider, ReasoningEffort, ResponseStyle } from './agent'

export interface IntelligencePreferences {
  responseStyle: ResponseStyle
  responseInstructions: string
  responseSkill: string
  toolSearch: boolean
  rtk: boolean
  compression: 'off' | 'balanced' | 'aggressive'
  learning: 'off' | 'review' | 'auto'
  maintenanceModel: { provider: AgentProvider; model: string; effort: ReasoningEffort | null } | null
  dailyReviews: number
  archiveSkillDays: number
}
export const DEFAULT_INTELLIGENCE_PREFERENCES: IntelligencePreferences = {
  responseStyle: 'default',
  responseInstructions: '',
  responseSkill: '',
  toolSearch: true,
  rtk: false,
  compression: 'balanced',
  learning: 'auto',
  maintenanceModel: null,
  dailyReviews: 5,
  archiveSkillDays: 90,
}
export interface ManagedSkill {
  id: string
  projectId: string | null
  name: string
  description: string
  content: string
  status: 'active' | 'disabled' | 'archived'
  pinned: boolean
  revision: number
  createdAt: number
  updatedAt: number
  lastUsedAt: number | null
  useCount: number
  sourceSessionId: string
  sourceSeq: number
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
