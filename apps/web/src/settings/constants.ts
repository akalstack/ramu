import type { Dispatch, SetStateAction } from 'react'
import type { AppPreferences } from '@ramu/shared/types'
import type { SettingsSection } from './SettingsPage'

export type DraftSetter = Dispatch<SetStateAction<AppPreferences>>

// Shared layout for a settings page body.
export const SETTINGS_FORM_CLASS =
  'settings-form [&_p]:m-[0_0_8px] [&_>_p.muted]:m-[12px_0] [&_>_p.muted]:leading-[1.55] flex flex-col gap-0'

export { GHOST_BUTTON_CLASS, GHOST_ICON_BUTTON_CLASS } from '@/components/button-classes'
export const SECONDARY_BUTTON_CLASS = 'bg-fill hover:bg-fill-hover'

// Preferences each section's "Reset to defaults" restores.
export const RESET_KEYS: Partial<Record<SettingsSection, (keyof AppPreferences)[]>> = {
  system: [
    'appUpdateChecks',
    'appAutoUpdate',
    'keepAwake',
    'keepAwakeWhen',
    'recapsEnabled',
    'recapTime',
    'localCrashReports',
  ],
  providers: ['providerBinaries', 'providerUpdateChecks', 'showUsageLimits'],
  appearance: ['language', 'accent', 'fontFamily', 'fontSize', 'fontSmoothing', 'reduceMotion', 'sidebarWidth'],
  editor: ['defaultMarkdownView', 'previewTabs', 'editorFontSize', 'terminalFontSize', 'defaultTerminalDock'],
  access: ['defaultAccess'],
  browser: ['agentBrowser'],
  models: ['defaultAutoFallback', 'fallback'],
  workflows: ['goals', 'subagents', 'advisor'],
  memory: ['memory'],
  chats: [
    'busyMessageAction',
    'includeTabContext',
    'warnModelChange',
    'autoProjectSelection',
    'autoProjectSplit',
    'agentThreads',
    'teammateSuggestions',
    'operator',
    'hostDescription',
    'liveViewDesktop',
    'notifyAgentDone',
    'resumeChatsOnRestart',
    'asyncQuestions',
    'autoBackgroundSeconds',
    'recentChats',
    'cleanupArchivedDays',
  ],
  git: [
    'defaultCheckoutMode',
    'worktreeBranchNaming',
    'worktreeBranchPrefix',
    'worktreeBranchInstructions',
    'pullMode',
    'autoPull',
    'autoWatchPullRequests',
    'commitStyle',
    'commitInstructions',
    'defaultCommitAction',
    'defaultCommitBranch',
    'commitModel',
  ],
}

// Chats and Memory each own part of `intelligence`; reset only their own fields.
export const CHATS_INTELLIGENCE_KEYS = ['toolSearch'] as const
export const MEMORY_INTELLIGENCE_KEYS = [
  'crossThreadRecall',
  'learning',
  'maintenanceModel',
  'dailyReviews',
  'archiveSkillDays',
] as const

export const MAX_MODEL_SETS = 20
export const MAX_SET_STEPS = 20

export const sizeOptions = (min: number, max: number) =>
  Array.from({ length: max - min + 1 }, (_, index) => ({ value: String(min + index), label: `${min + index} px` }))
