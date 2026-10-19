import type { Dispatch, SetStateAction } from 'react'
import type { AppPreferences } from '@ramu/shared/types'
import type { SettingsSection } from './SettingsPage'

export type DraftSetter = Dispatch<SetStateAction<AppPreferences>>

// Shared layout for a settings page body.
export const SETTINGS_FORM_CLASS =
  'settings-form [&_p]:m-[0_0_8px] [&_>_p.muted]:m-[12px_0] [&_>_p.muted]:leading-[1.55] flex flex-col gap-0'

export const GHOST_BUTTON_CLASS =
  'ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover'
export const GHOST_ICON_BUTTON_CLASS = `${GHOST_BUTTON_CLASS} icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)`
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
  editor: ['previewTabs', 'editorFontSize', 'terminalFontSize', 'defaultTerminalDock'],
  access: ['defaultAccess', 'defaultAutoFallback', 'fallback'],
  workflows: ['goals', 'subagents', 'advisor'],
  memory: ['memory'],
  chats: [
    'busyMessageAction',
    'includeTabContext',
    'warnModelChange',
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
  'toolAwareSkills',
  'learning',
  'maintenanceModel',
  'dailyReviews',
  'archiveSkillDays',
] as const

export const MAX_MODEL_SETS = 20
export const MAX_SET_STEPS = 20

export const sizeOptions = (min: number, max: number) =>
  Array.from({ length: max - min + 1 }, (_, index) => ({ value: String(min + index), label: `${min + index} px` }))
