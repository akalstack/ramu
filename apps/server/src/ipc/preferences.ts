import { z } from 'zod'
import { validBranchPrefix } from '@ramu/shared/workspaceDefaults'
import { intelligenceSchema } from '../intelligence'
import { goalPreferencesSchema } from '../agent/goals'
import {
  DEFAULT_APP_PREFERENCES,
  DEFAULT_GOAL_PREFERENCES,
  DEFAULT_MEMORY_PREFERENCES,
  DEFAULT_FALLBACK_PREFERENCES,
  DEFAULT_SIDEBAR_WIDTH,
  DEFAULT_SUBAGENT_PREFERENCES,
  DEFAULT_ADVISOR_PREFERENCES,
  SIDEBAR_WIDTH_RANGE,
} from '@ramu/shared/types'
import { agentSettings, id, pullMode, providerId } from './schemas'

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
              .refine((path) => !path.includes('\0'), 'Invalid binary path'),
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
              .optional(),
            accountId: z
              .string()
              .regex(/^[a-zA-Z0-9_-]{1,80}$/)
              .optional(),
            accountOrder: z
              .array(z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/))
              .max(21)
              .optional(),
            autoUpdate: z.boolean().optional(),
            enabled: z.boolean().optional(),
            usageKeychain: z.boolean().optional(),
            defaultAccountEnabled: z.boolean().optional(),
            harness: z
              .string()
              .trim()
              .max(4096)
              .refine((path) => !path.includes('\0'), 'Invalid helper path')
              .optional(),
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
const effortCap = fallbackStep.shape.effort
const threshold = z.union([z.literal(80), z.literal(90), z.literal(95), z.null()])
const order = z.array(fallbackStep).max(10)
/** Settings saved with a list per provider become one order: the Claude Code list (or the first set), led by that provider. */
export function migrateChains(value: unknown): unknown {
  if (!value || typeof value !== 'object' || 'order' in value || !('chains' in value)) return value
  const { chains, ...rest } = value as { chains?: Record<string, unknown[] | undefined> }
  const provider = chains?.['claude-code']?.length
    ? 'claude-code'
    : Object.keys(chains ?? {}).find((key) => chains?.[key]?.length)
  return provider
    ? {
        ...rest,
        order: [{ id: `migrated-${provider}`, provider, model: '', effort: null }, ...chains![provider]!].slice(0, 10),
      }
    : rest
}
const fallbackPreferences = z.preprocess(
  migrateChains,
  z.object({
    switchAt: threshold.default(DEFAULT_FALLBACK_PREFERENCES.switchAt),
    order: order.optional(),
    autoResume: z.boolean().default(true),
  }),
)
const subagentPreferences = z.preprocess(
  migrateChains,
  z.object({
    mode: z.enum(['native', 'single', 'per-provider']).default('native'),
    autoSelect: z.enum(['off', 'model-and-effort', 'effort-only']).default('off'),
    maxEffort: effortCap.default(null),
    modelMaxEffort: z.record(z.string().max(400), effortCap.unwrap()).default({}),
    single: fallbackStep.nullable().default(null),
    perProvider: z.partialRecord(providerId, fallbackStep.nullable()).default({}),
    byType: z
      .array(z.object({ id: z.string().min(1).max(100), type: z.string().max(80), step: fallbackStep.nullable() }))
      .max(20)
      .default([]),
    fallback: z.enum(['same', 'separate']).default('same'),
    order: order.optional(),
    switchAt: z.union([threshold, z.literal('same')]).default('same'),
    continueNative: z.boolean().default(true),
    isolate: z.boolean().default(false),
    codexHook: z.boolean().default(false),
    maxConcurrent: z.number().int().min(1).max(8).default(3),
    shareContext: z.boolean().default(false),
  }),
)
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
  accent: z.enum(['blue', 'violet', 'teal']),
  fontFamily: z.enum(['system', 'geist']),
  fontSize: z.number().int().min(12).max(18),
  fontSmoothing: z.boolean().default(true),
  reduceMotion: z.boolean().default(false),
  recentChatMode: z.boolean().default(false),
  defaultMarkdownView: z.enum(['source', 'edit', 'preview']).default(DEFAULT_APP_PREFERENCES.defaultMarkdownView),
  editorFontSize: z.number().int().min(10).max(22),
  terminalFontSize: z.number().int().min(8).max(22),
  previewTabs: z.boolean(),
  pullMode: pullMode.default('rebase'),
  autoPull: z.boolean().default(true),
  autoWatchPullRequests: z.boolean().default(false),
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
  recentChats: z.number().int().min(3).max(20),
  cleanupArchivedDays: z.number().int().min(0).max(3650).default(DEFAULT_APP_PREFERENCES.cleanupArchivedDays),
  terminalTabPosition: z.enum(['top', 'right']),
  defaultTerminalDock: z.enum(['right', 'bottom']).default(DEFAULT_APP_PREFERENCES.defaultTerminalDock),
  defaultAccess: agentSettings.shape.access,
  defaultAutoFallback: z.boolean(),
  busyMessageAction: z.enum(['queue', 'steer']).default('steer'),
  includeTabContext: z.boolean().default(true),
  warnModelChange: z.boolean().default(true),
  sidebarWidth: z.number().int().min(SIDEBAR_WIDTH_RANGE[0]).max(SIDEBAR_WIDTH_RANGE[1]).default(DEFAULT_SIDEBAR_WIDTH),
  messageBehaviorVersion: z.literal(4).default(4),
  favoriteModels: z.array(z.string().max(200)).max(100).default([]),
  notifyAgentDone: z.boolean().default(true),
  resumeChatsOnRestart: z.boolean().default(true),
  asyncQuestions: z.boolean().default(true),
  autoBackgroundSeconds: z.number().int().min(0).max(3600).default(60),
  providerBinaries: providerBinaries.default({}),
  providerUpdateChecks: z.boolean().default(true),
  appUpdateChecks: z.boolean().default(true),
  appAutoUpdate: z.boolean().default(false),
  keepAwake: z.boolean().default(false),
  keepAwakeWhen: z.enum(['plugged-in', 'always']).default('plugged-in'),
  showUsageLimits: z.boolean().default(true),
  fallback: fallbackPreferences.default(DEFAULT_FALLBACK_PREFERENCES),
  subagents: subagentPreferences.default(DEFAULT_SUBAGENT_PREFERENCES),
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

export const modelPreferences = z
  .object({
    defaultBarMode: z.enum(['effort', 'model']).optional(),
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
