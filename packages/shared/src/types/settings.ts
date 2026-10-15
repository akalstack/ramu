import type { ProviderConfiguration } from '../providers'
import type { AgentProvider, AgentSettings, ReasoningEffort } from './agent'
import { DEFAULT_ADVISOR_PREFERENCES, DEFAULT_FALLBACK_PREFERENCES, DEFAULT_SUBAGENT_PREFERENCES } from './fallback'
import type { AdvisorPreferences, FallbackPreferences, SubagentPreferences } from './fallback'
import type { CommitAction, CommitStyle, PullMode } from './git'
import { DEFAULT_GOAL_PREFERENCES } from './goal'
import type { GoalPreferences } from './goal'
import { DEFAULT_INTELLIGENCE_PREFERENCES } from './intelligence'
import type { IntelligencePreferences } from './intelligence'
import { DEFAULT_MEMORY_PREFERENCES } from './memory'
import type { MemoryPreferences } from './memory'

export interface ModelStep {
  id: string
  name: string
  provider: AgentProvider
  model: string
  effort: ReasoningEffort | null
}
export interface ModelSet {
  id: string
  name: string
  steps: ModelStep[]
}
export interface ModelPreferences {
  defaultBarMode?: 'effort' | 'model'
  sets: ModelSet[]
  defaultSetId: string
  defaultStepId: string
}

export interface AppPreferences {
  language: 'system' | 'en' | 'id'
  recapsEnabled: boolean
  recapTime: string
  accent: 'blue' | 'violet' | 'teal'
  fontFamily: 'system' | 'geist'
  fontSize: number
  editorFontSize: number
  terminalFontSize: number
  previewTabs: boolean
  hideEmptyStaged: boolean
  /** How Pull and Sync integrate incoming commits. */
  pullMode: PullMode
  autoPull: boolean
  /** Wording rules for AI-drafted commit messages. */
  commitStyle: CommitStyle
  /** Used when commitStyle is custom. */
  commitInstructions: string
  /** Last reusable action selected in Source Control's commit menu. */
  defaultCommitAction: CommitAction
  /** Primary choice when committing from the default branch. */
  defaultCommitBranch: 'new-branch' | 'current'
  recentChats: number
  /** Archived chats idle this many days are deleted automatically; 0 keeps them forever. */
  cleanupArchivedDays: number
  terminalTabPosition: 'top' | 'right'
  /** Default dock for terminals without a saved checkout position. */
  defaultTerminalDock: 'right' | 'bottom'
  defaultAccess: AgentSettings['access']
  defaultAutoFallback: boolean
  busyMessageAction: 'queue' | 'steer'
  /** Send the files open in editor tabs along with each message. */
  includeTabContext: boolean
  /** Ask before changing a chat's model mid-conversation: the new model has no cache of it, so the next message costs more. */
  warnModelChange: boolean
  /** Dragged width of the sidebar, in px. */
  sidebarWidth: number
  messageBehaviorVersion: 4
  defaultChatDockOpen: boolean
  /** Starred models, as `provider:model-id`; they get their own tab and ⌘1–⌘9 shortcuts in the model picker. */
  favoriteModels: string[]
  /** Tell me when an agent finishes, needs input or fails: a system notification when Ramu is in the background, a toast when it is open. */
  notifyAgentDone: boolean
  /** Resume interrupted chats when the background service starts again. */
  resumeChatsOnRestart: boolean
  asyncQuestions: boolean
  /** Seconds a Claude command may run in the foreground before Ramu moves it to the background; 0 leaves it to the agent. */
  autoBackgroundSeconds: number
  providerBinaries: ProviderConfiguration
  providerUpdateChecks: boolean
  appUpdateChecks: boolean
  appAutoUpdate: boolean
  /** Sidebar chat list: one flat list by recent activity, with project names, instead of groups per project. */
  recentChatMode: boolean
  /** Render text with thin grayscale antialiasing instead of the macOS default. */
  fontSmoothing: boolean
  /** Disable interface animations in addition to the system motion preference. */
  reduceMotion: boolean
  keepAwake: boolean
  keepAwakeWhen: 'plugged-in' | 'always'
  /** Show the 5-hour and weekly plan usage gauges. */
  showUsageLimits: boolean
  fallback: FallbackPreferences
  subagents: SubagentPreferences
  advisor: AdvisorPreferences
  goals: GoalPreferences
  intelligence: IntelligencePreferences
  memory: MemoryPreferences
}

export const DEFAULT_SIDEBAR_WIDTH = 268
export const SIDEBAR_WIDTH_RANGE = [200, 520] as const
export const DEFAULT_APP_PREFERENCES: AppPreferences = {
  language: 'system',
  recapsEnabled: true,
  recapTime: '08:00',
  accent: 'violet',
  fontFamily: 'system',
  fontSize: 14,
  fontSmoothing: true,
  reduceMotion: false,
  recentChatMode: false,
  editorFontSize: 13,
  terminalFontSize: 12,
  previewTabs: true,
  hideEmptyStaged: true,
  pullMode: 'rebase',
  autoPull: true,
  commitStyle: 'conventional',
  commitInstructions: '',
  defaultCommitAction: 'commit',
  defaultCommitBranch: 'new-branch',
  recentChats: 10,
  cleanupArchivedDays: 90,
  terminalTabPosition: 'top',
  defaultTerminalDock: 'bottom',
  defaultAccess: 'auto',
  defaultAutoFallback: true,
  defaultChatDockOpen: true,
  favoriteModels: [],
  notifyAgentDone: true,
  resumeChatsOnRestart: true,
  asyncQuestions: true,
  autoBackgroundSeconds: 60,
  providerBinaries: {},
  providerUpdateChecks: true,
  appUpdateChecks: true,
  appAutoUpdate: false,
  keepAwake: false,
  keepAwakeWhen: 'plugged-in',
  showUsageLimits: true,
  fallback: DEFAULT_FALLBACK_PREFERENCES,
  subagents: DEFAULT_SUBAGENT_PREFERENCES,
  advisor: DEFAULT_ADVISOR_PREFERENCES,
  goals: DEFAULT_GOAL_PREFERENCES,
  memory: DEFAULT_MEMORY_PREFERENCES,
  intelligence: DEFAULT_INTELLIGENCE_PREFERENCES,
  includeTabContext: true,
  warnModelChange: true,
  sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
  busyMessageAction: 'steer',
  messageBehaviorVersion: 4,
}
