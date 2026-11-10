import { DEFAULT_WORKSPACE_PREFERENCES, type WorkspaceDefaults } from '../workspaceDefaults'
import type { ProviderConfiguration } from '../providers/providers'
import type { AgentProvider, AgentSettings, ReasoningEffort } from './agent'
import { DEFAULT_ADVISOR_PREFERENCES, DEFAULT_FALLBACK_PREFERENCES, DEFAULT_SUBAGENT_PREFERENCES } from './fallback'
import type { AdvisorPreferences, FallbackPreferences, SubagentPreferences } from './fallback'
import type { CommitAction, CommitStyle, PullMode } from './git'
import { DEFAULT_GOAL_PREFERENCES } from './goal'
import type { GoalPreferences } from './goal'
import { DEFAULT_INTELLIGENCE_PREFERENCES } from './intelligence'
import type { IntelligencePreferences } from './intelligence'
import { DEFAULT_MEMORY_PREFERENCES } from './memory'
import { DEFAULT_ABILITY_PREFERENCES, type AbilityPreferences } from '../providers/abilities'
import { DEFAULT_IDLE_COMPACTION, type IdleCompactionMode } from '../chat/idleCompaction'
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
  /** Snapshot identity for safe catalog refresh. Editing any generated content makes it user-owned. */
  generated?: { fingerprint: string; defaultStepId: string }
}
export interface ModelPreferences {
  defaultBarMode?: 'effort' | 'model'
  /** Overrides defaultBarMode for phones and tablets using this host; absent follows defaultBarMode. */
  mobileBarMode?: 'effort' | 'model'
  sets: ModelSet[]
  defaultSetId: string
  defaultStepId: string
}

export interface AppPreferences extends WorkspaceDefaults {
  language: 'system' | 'en' | 'id'
  recapsEnabled: boolean
  recapTime: string
  accent: 'blue' | 'violet' | 'teal'
  fontFamily: 'system' | 'geist'
  fontSize: number
  /** Opening mode for Markdown files without a requested source selection. */
  defaultMarkdownView: 'source' | 'edit' | 'preview'
  editorFontSize: number
  terminalFontSize: number
  previewTabs: boolean
  /** How Pull and Sync integrate incoming commits. */
  pullMode: PullMode
  autoPull: boolean
  /** Keep agents' Co-authored-by trailers and "Generated with" footers out of commits and pull requests. */
  removeAgentCredits: boolean
  /** Watch newly created PRs in their originating thread. Existing watches are controlled per PR. */
  autoWatchPullRequests: boolean
  localCrashReports: boolean
  /** Wording rules for AI-drafted commit messages. */
  commitStyle: CommitStyle
  /** Used when commitStyle is custom. */
  commitInstructions: string
  /** Last reusable action selected in Source Control's commit menu. */
  defaultCommitAction: CommitAction
  /** Primary choice when committing from the default branch. */
  defaultCommitBranch: 'new-branch' | 'current'
  /** Model that drafts commit messages; null follows the default model step in Model sets. */
  commitModel: IntelligencePreferences['maintenanceModel']
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
  /** Home starts in Auto: Ramu picks the project from the first prompt and asks when it is unclear. */
  autoProjectSelection: boolean
  /** Agents may start threads the person owns, here and on other hosts, and a paired host's agents may start them here. */
  agentThreads: boolean
  /** The main agent may suggest a model to bring in as a teammate; each suggestion asks the person first. */
  teammateSuggestions: boolean
  /** The host reads public model catalogs (models.dev, LiteLLM) daily for release and retirement dates. */
  modelCatalogLookups: boolean
  /** Every device is told once when a provider starts offering a model the host has not seen it offer before. */
  newModelNotices: boolean
  /** A few words the person writes about this host (`GPU box`, `office network`), matched when suggesting one. */
  hostDescription: string
  /** Float, the small live view of a thread's Browser, Computer or test device on the desktop. */
  liveViewDesktop: boolean
  /** Opt-in until integrated runtime/provider acceptance passes; website identities stay on the runtime's desktop. */
  agentBrowser?: import('../browser').AgentBrowserPreferences
  /** Dragged width of the sidebar, in px. */
  sidebarWidth: number
  /** Starred models, as `provider:model-id`; they get their own tab and ⌘1–⌘9 shortcuts in the model picker. */
  favoriteModels: string[]
  /** Models listed per provider in pickers and dropdowns; a provider with no entry lists all of its models. */
  visibleModels: Partial<Record<AgentProvider, string[]>>
  /** Tell me when an agent finishes, needs input or fails: a system notification when Ramu is in the background, a toast when it is open. */
  notifyAgentDone: boolean
  /** Resume interrupted chats when the background service starts again. */
  resumeChatsOnRestart: boolean
  asyncQuestions: boolean
  /** Seconds a Claude command may run in the foreground before Ramu moves it to the background; 0 leaves it to the agent. */
  autoBackgroundSeconds: number
  /** What happens to a long Claude thread left idle: ask on return, compact before its prompt cache expires, or keep it. */
  idleCompaction: IdleCompactionMode
  providerBinaries: ProviderConfiguration
  providerUpdateChecks: boolean
  appUpdateChecks: boolean
  appAutoUpdate: boolean
  /** Sidebar chat list: one flat list by recent activity, with project names, instead of groups per project. */
  recentChatMode: boolean
  /** Thread rows inside a project's group add a second line naming their branch. */
  threadRowBranches: boolean
  /** Render text with thin grayscale antialiasing instead of the macOS default. */
  fontSmoothing: boolean
  /** Disable interface animations in addition to the system motion preference. */
  reduceMotion: boolean
  keepAwake: boolean
  keepAwakeWhen: 'plugged-in' | 'always'
  testDevices: TestDevicePreferences
  /** Show the 5-hour and weekly plan usage gauges. */
  showUsageLimits: boolean
  fallback: FallbackPreferences
  subagents: SubagentPreferences
  /** Which provider runs each ability for threads on other providers. */
  abilities: AbilityPreferences
  advisor: AdvisorPreferences
  goals: GoalPreferences
  intelligence: IntelligencePreferences
  memory: MemoryPreferences
}

/** Test devices on this host: the model a thread gets when it names none, and whether a spare stays ready. */
export interface TestDevicePreferences {
  /** null: the platform's own default phone. */
  iosModel: string | null
  androidModel: string | null
  /** A spare device of the kind last used stays booted, so the next thread starts sooner; it holds memory. */
  keepWarm: boolean
  /** How many devices may run at once; null leaves it to this host's memory. */
  maxRunning: number | null
  /** iOS Simulators boot with fewer system services: quicker and lighter, without some system apps. */
  slim: boolean
}

export const DEFAULT_TEST_DEVICE_PREFERENCES: TestDevicePreferences = {
  iosModel: null,
  androidModel: null,
  keepWarm: false,
  maxRunning: null,
  slim: false,
}

export const DEFAULT_SIDEBAR_WIDTH = 312
export const SIDEBAR_WIDTH_RANGE = [200, 520] as const
export const DEFAULT_APP_PREFERENCES: AppPreferences = {
  ...DEFAULT_WORKSPACE_PREFERENCES,
  agentBrowser: { agentBrowser: 'integrated', providerOverrides: {}, defaultProfileId: 'default' },
  language: 'system',
  recapsEnabled: true,
  recapTime: '08:00',
  accent: 'violet',
  fontFamily: 'system',
  fontSize: 14,
  fontSmoothing: true,
  reduceMotion: false,
  recentChatMode: false,
  threadRowBranches: false,
  defaultMarkdownView: 'preview',
  editorFontSize: 13,
  terminalFontSize: 12,
  previewTabs: true,
  pullMode: 'rebase',
  autoPull: true,
  removeAgentCredits: true,
  autoWatchPullRequests: false,
  localCrashReports: false,
  commitStyle: 'conventional',
  commitInstructions: '',
  defaultCommitAction: 'commit',
  defaultCommitBranch: 'new-branch',
  commitModel: null,
  recentChats: 10,
  cleanupArchivedDays: 90,
  terminalTabPosition: 'top',
  defaultTerminalDock: 'bottom',
  defaultAccess: 'full',
  defaultAutoFallback: true,
  favoriteModels: [],
  visibleModels: {},
  notifyAgentDone: true,
  resumeChatsOnRestart: true,
  asyncQuestions: true,
  autoBackgroundSeconds: 60,
  idleCompaction: DEFAULT_IDLE_COMPACTION,
  providerBinaries: {},
  providerUpdateChecks: true,
  appUpdateChecks: true,
  appAutoUpdate: false,
  keepAwake: false,
  keepAwakeWhen: 'plugged-in',
  testDevices: DEFAULT_TEST_DEVICE_PREFERENCES,
  showUsageLimits: true,
  fallback: DEFAULT_FALLBACK_PREFERENCES,
  subagents: DEFAULT_SUBAGENT_PREFERENCES,
  abilities: DEFAULT_ABILITY_PREFERENCES,
  advisor: DEFAULT_ADVISOR_PREFERENCES,
  goals: DEFAULT_GOAL_PREFERENCES,
  memory: DEFAULT_MEMORY_PREFERENCES,
  intelligence: DEFAULT_INTELLIGENCE_PREFERENCES,
  includeTabContext: true,
  warnModelChange: true,
  autoProjectSelection: true,
  agentThreads: true,
  teammateSuggestions: true,
  modelCatalogLookups: true,
  newModelNotices: true,
  hostDescription: '',
  liveViewDesktop: true,
  sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
  busyMessageAction: 'steer',
}
