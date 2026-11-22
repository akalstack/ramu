import { MEDIA_SERVICES } from '@ramu/shared/types/media'
import { z } from 'zod'
import { validBranchPrefix } from '@ramu/shared/workspaceDefaults'
import { intelligenceSchema } from '../intelligence'
import { goalPreferencesSchema } from '../agent/goals'
import {
  DEFAULT_APP_PREFERENCES,
  DEFAULT_TEST_DEVICE_PREFERENCES,
  DEFAULT_GOAL_PREFERENCES,
  DEFAULT_MEMORY_PREFERENCES,
  DEFAULT_FALLBACK_PREFERENCES,
  DEFAULT_SIDEBAR_WIDTH,
  DEFAULT_SUBAGENT_PREFERENCES,
  DEFAULT_ADVISOR_PREFERENCES,
  SIDEBAR_WIDTH_RANGE,
} from '@ramu/shared/types'
import { agentSettings, id, pullMode, providerId } from './schemas'
import { PERSON_ONLY, type SettingSchema } from '@ramu/shared/settingsCompatibility'
import {
  ABILITIES,
  DEFAULT_ABILITY_PREFERENCES,
  ASKED_MCP_ABILITIES,
  AUTO_MCP_ABILITIES,
  type AbilityPreferences,
} from '@ramu/shared/providers/abilities'

/** Only the person may change it: it widens what agents may do or who can reach the host (see `PERSON_ONLY`). */
const personOnly = { [PERSON_ONLY]: true }

export const providerBinaries = z
  .object(
    Object.fromEntries(
      ['claude-code', 'codex', 'opencode', 'cursor', 'antigravity'].map((provider) => [
        provider,
        z
          .object({
            binary: z
              .string()
              .trim()
              .max(4096)
              .refine((path) => !path.includes('\0'), 'Invalid binary path')
              .meta(personOnly),
            accounts: z
              .array(
                z.object({
                  id: z
                    .string()
                    .regex(/^[a-zA-Z0-9_-]{1,80}$/)
                    .refine((id) => id !== 'default'),
                  name: z.string().trim().max(80).optional(),
                  enabled: z.boolean().optional(),
                }),
              )
              .max(20)
              .optional()
              .meta(personOnly),
            accountId: z
              .string()
              .regex(/^[a-zA-Z0-9_-]{1,80}$/)
              .optional()
              .meta(personOnly),
            accountOrder: z
              .array(z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/))
              .max(21)
              .optional()
              .meta(personOnly),
            autoUpdate: z.boolean().optional(),
            enabled: z.boolean().optional(),
            defaultAccountEnabled: z.boolean().optional().meta(personOnly),
          })
          .optional(),
      ]),
    ),
  )
  .refine(
    (config) =>
      ['claude-code', 'codex', 'opencode', 'cursor', 'antigravity'].some(
        (provider) => (config as Record<string, { enabled?: boolean } | undefined>)[provider]?.enabled !== false,
      ),
    'Keep at least one provider turned on',
  )
export const fallbackStep = z.object({
  id: z.string().min(1).max(100),
  provider: providerId,
  model: z.string().max(200),
  effort: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']).nullable(),
  serviceTier: z.enum(['standard', 'fast']).optional(),
})
const threshold = z.union([z.literal(80), z.literal(90), z.literal(95), z.null()])
const order = z.array(fallbackStep).max(10)
const fallbackPreferences = z.object({
  switchAt: threshold.default(DEFAULT_FALLBACK_PREFERENCES.switchAt),
  order: order.optional(),
  autoResume: z.boolean().default(true),
})
const subagentPreferences = z.object({
  model: z.enum(['thread', 'auto', 'pick']).default('thread'),
  step: fallbackStep.nullable().default(null),
  codexHook: z.boolean().default(false),
})
const mcpTool = z.object({
  connectionId: z.string().min(1).max(200),
  tool: z.string().min(1).max(200),
  status: z.string().min(1).max(200).optional(),
  balance: z.string().min(1).max(200).optional(),
  fromImage: z.string().min(1).max(200).optional(),
  refine: z.string().min(1).max(200).optional(),
  downloads: z
    .array(
      z
        .string()
        .regex(/^https:\/\/(\*\.)?[a-z0-9.-]+$/)
        .max(300),
    )
    .max(5)
    .optional(),
})
const abilityChoice = z.union([
  z.enum(['auto', 'off']),
  z.object({ provider: providerId, model: z.string().max(200) }),
  mcpTool,
  z.object({ media: z.enum(MEDIA_SERVICES) }),
])
/** Auto, Off or one provider and model per ability; a project's `ramu.json` can set these over the host's. */
export const abilityChoices = z.object(
  Object.fromEntries(ABILITIES.map((ability) => [ability, abilityChoice.optional()])),
) as z.ZodType<AbilityPreferences['choices']>
const abilityPreferences = z.object({
  choices: abilityChoices.default({}),
  autoMcp: z
    .object(
      Object.fromEntries(
        [...AUTO_MCP_ABILITIES, ...ASKED_MCP_ABILITIES].map((ability) => [ability, mcpTool.optional()]),
      ),
    )
    .optional()
    .meta(personOnly),
  askBeforeOtherProvider: z.boolean().default(false).meta(personOnly),
})
const advisorPreferences = z.object({
  enabled: z.boolean().default(false),
  step: fallbackStep.nullable().default(null),
  wait: z.boolean().default(false),
})
export const appPreferences = z.object({
  defaultCheckoutMode: z.enum(['current', 'worktree']).default('current'),
  worktreeBranchNaming: z.enum(['fixed', 'semantic', 'custom']).default('fixed'),
  worktreeBranchPrefix: z.string().max(120).refine(validBranchPrefix, 'Invalid Git branch prefix').default('ramu/'),
  worktreeBranchInstructions: z.string().max(2000).default(''),
  intelligence: intelligenceSchema.default(() => intelligenceSchema.parse({})),
  language: z.enum(['system', 'en', 'id']).default('system'),
  recapsEnabled: z.boolean().default(true),
  recapTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .default('08:00'),
  accent: z.enum(['blue', 'violet', 'teal']).default(DEFAULT_APP_PREFERENCES.accent),
  fontFamily: z.enum(['system', 'geist']).default(DEFAULT_APP_PREFERENCES.fontFamily),
  fontSize: z.number().int().min(12).max(18).default(DEFAULT_APP_PREFERENCES.fontSize),
  fontSmoothing: z.boolean().default(true),
  reduceMotion: z.boolean().default(false),
  recentChatMode: z.boolean().default(false),
  threadRowBranches: z.boolean().default(false),
  defaultMarkdownView: z.enum(['source', 'edit', 'preview']).default(DEFAULT_APP_PREFERENCES.defaultMarkdownView),
  editorFontSize: z.number().int().min(10).max(22).default(DEFAULT_APP_PREFERENCES.editorFontSize),
  terminalFontSize: z.number().int().min(8).max(22).default(DEFAULT_APP_PREFERENCES.terminalFontSize),
  previewTabs: z.boolean().default(DEFAULT_APP_PREFERENCES.previewTabs),
  pullMode: pullMode.default('rebase'),
  autoPull: z.boolean().default(true),
  autoWatchPullRequests: z.boolean().default(false),
  removeAgentCredits: z.boolean().default(true),
  localCrashReports: z.boolean().default(false),
  commitStyle: z.enum(['conventional', 'repository', 'custom']).default('conventional'),
  commitInstructions: z.string().max(2000).default(''),
  defaultCommitAction: z.enum(['commit', 'push', 'sync']).default('commit'),
  defaultCommitBranch: z.enum(['new-branch', 'current']).default('new-branch'),
  commitModel: z
    .object({
      provider: z.enum(['claude-code', 'codex', 'opencode', 'cursor', 'antigravity']),
      model: z.string().max(200),
      effort: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']).nullable(),
    })
    .nullable()
    .default(null),
  recentChats: z.number().int().min(3).max(20).default(DEFAULT_APP_PREFERENCES.recentChats),
  cleanupArchivedDays: z.number().int().min(0).max(3650).default(DEFAULT_APP_PREFERENCES.cleanupArchivedDays),
  terminalTabPosition: z.enum(['top', 'right']).default(DEFAULT_APP_PREFERENCES.terminalTabPosition),
  defaultTerminalDock: z.enum(['right', 'bottom']).default(DEFAULT_APP_PREFERENCES.defaultTerminalDock),
  defaultAccess: agentSettings.shape.access.default(DEFAULT_APP_PREFERENCES.defaultAccess).meta(personOnly),
  defaultAutoFallback: z.boolean().default(DEFAULT_APP_PREFERENCES.defaultAutoFallback),
  busyMessageAction: z.enum(['queue', 'steer']).default('steer'),
  includeTabContext: z.boolean().default(true),
  warnModelChange: z.boolean().default(true),
  autoProjectSelection: z.boolean().default(true),
  agentThreads: z.boolean().default(true).meta(personOnly),
  modelCatalogLookups: z.boolean().default(true),
  newModelNotices: z.boolean().default(true),
  hostDescription: z.string().trim().max(80).default(''),
  liveViewDesktop: z.boolean().default(true),
  agentBrowser: z
    .object({
      agentBrowser: z.enum(['integrated', 'provider']).default('integrated'),
      providerOverrides: z.partialRecord(providerId, z.enum(['integrated', 'provider'])).default({}),
      defaultProfileId: z
        .string()
        .regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
        .default('default'),
    })
    .default({ agentBrowser: 'integrated', providerOverrides: {}, defaultProfileId: 'default' }),
  sidebarWidth: z.number().int().min(SIDEBAR_WIDTH_RANGE[0]).max(SIDEBAR_WIDTH_RANGE[1]).default(DEFAULT_SIDEBAR_WIDTH),
  favoriteModels: z.array(z.string().max(200)).max(100).default([]),
  visibleModels: z.record(z.string().max(40), z.array(z.string().max(200)).max(5000)).default({}),
  notifyAgentDone: z.boolean().default(true),
  resumeChatsOnRestart: z.boolean().default(true),
  asyncQuestions: z.boolean().default(true),
  autoBackgroundSeconds: z.number().int().min(0).max(3600).default(60),
  providerBinaries: providerBinaries.default({}),
  providerUpdateChecks: z.boolean().default(true),
  appUpdateChecks: z.boolean().default(true),
  updateWait: z.boolean().default(true),
  appAutoUpdate: z.boolean().default(true),
  keepAwake: z.boolean().default(false),
  keepAwakeWhen: z.enum(['plugged-in', 'always']).default('plugged-in'),
  testDevices: z
    .object({
      iosModel: z.string().trim().min(1).max(120).nullable().default(null),
      androidModel: z.string().trim().min(1).max(120).nullable().default(null),
      keepWarm: z.boolean().default(false),
      maxRunning: z.number().int().min(1).max(16).nullable().default(null),
      slim: z.boolean().default(false),
    })
    .default(DEFAULT_TEST_DEVICE_PREFERENCES),
  showUsageLimits: z.boolean().default(true),
  fallback: fallbackPreferences.default(DEFAULT_FALLBACK_PREFERENCES),
  subagents: subagentPreferences.default(DEFAULT_SUBAGENT_PREFERENCES),
  abilities: abilityPreferences.default(DEFAULT_ABILITY_PREFERENCES),
  advisor: advisorPreferences.default(DEFAULT_ADVISOR_PREFERENCES),
  goals: goalPreferencesSchema.default(DEFAULT_GOAL_PREFERENCES),
  memory: z
    .object({
      enabled: z.boolean().default(true),
      dream: z.boolean().default(true),
      staleAfterDays: z.number().int().min(7).max(3650).default(90),
    })
    .default(DEFAULT_MEMORY_PREFERENCES),
})

/** The JSON schema every host advertises for its portable settings, with each setting's constraints and marks. */
export const appPreferencesSchema = z.toJSONSchema(appPreferences, { unrepresentable: 'any' }) as SettingSchema

export const modelPreferences = z
  .object({
    defaultBarMode: z.enum(['effort', 'model']).optional(),
    mobileBarMode: z.enum(['effort', 'model']).optional(),
    sets: z
      .array(
        z.object({
          id,
          name: z.string().trim().min(1).max(80),
          generated: z.object({ fingerprint: z.string().max(50_000), defaultStepId: id }).optional(),
          steps: z
            .array(
              z.object({
                id,
                name: z.string().trim().min(1).max(260),
                provider: agentSettings.shape.provider,
                model: agentSettings.shape.model,
                effort: agentSettings.shape.effort,
              }),
            )
            .min(1)
            .max(20),
        }),
      )
      .min(1)
      .max(20),
    defaultSetId: id,
    defaultStepId: id,
  })
  .superRefine((value, context) => {
    const selected = value.sets.find((set) => set.id === value.defaultSetId)
    if (!selected?.steps.some((step) => step.id === value.defaultStepId))
      context.addIssue({ code: 'custom', message: 'Choose a default step in the default set' })
    if (
      new Set(value.sets.map((set) => set.id)).size !== value.sets.length ||
      value.sets.some((set) => new Set(set.steps.map((step) => step.id)).size !== set.steps.length)
    )
      context.addIssue({ code: 'custom', message: 'Set and step identifiers must be unique' })
  })
