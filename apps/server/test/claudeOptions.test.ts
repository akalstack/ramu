import { expect, it } from 'vitest'
import { DEFAULT_APP_PREFERENCES } from '@ramu/shared/types'
import type { AgentSessionInfo, AppPreferences } from '@ramu/shared/types'
import { claudeLaunchOptions } from '../src/agent/claudeOptions'

const noAttribution = { attribution: { commit: '', pr: '', sessionUrl: false } }

const launch = (advisorModel: string | undefined, effort?: string, preferences?: Partial<AppPreferences>) =>
  claudeLaunchOptions({
    session: { cwd: '/tmp', additionalDirs: [], settings: { access: 'edits', effort } } as unknown as AgentSessionInfo,
    connection: undefined,
    advisorModel,
    abort: new AbortController(),
    canUseTool: async () => ({ behavior: 'deny', message: '' }),
    resume: null,
    preferences: preferences ? () => ({ ...DEFAULT_APP_PREFERENCES, ...preferences }) : undefined,
    hooks: undefined,
  })

it('asks Claude for thinking summaries so the chat has thinking text to show', () => {
  expect(launch(undefined).settings).toEqual({ showThinkingSummaries: true, ...noAttribution })
  expect(launch('').settings).toEqual({ showThinkingSummaries: true, advisorModel: '', ...noAttribution })
})

it("leaves Claude's co-author trailer and footer out unless the person keeps agent credits", () => {
  expect(launch(undefined, undefined, {}).settings).toMatchObject(noAttribution)
  expect(launch(undefined, undefined, { removeAgentCredits: false }).settings).not.toHaveProperty('attribution')
})

it('requests summarized thinking on the request itself for models with effort levels', () => {
  expect(launch(undefined, 'medium').thinking).toEqual({ type: 'adaptive', display: 'summarized' })
  expect(launch(undefined).thinking).toBeUndefined()
})

it("turns off Claude's own AskUserQuestion only when Ramu's question tools replace it", () => {
  const options = (replaceQuestions: boolean) =>
    claudeLaunchOptions({
      session: {
        cwd: '/tmp',
        additionalDirs: [],
        covers: [],
        settings: { access: 'edits' },
      } as unknown as AgentSessionInfo,
      connection: { url: 'http://127.0.0.1/mcp', token: 't', instructions: '', replaceQuestions },
      advisorModel: undefined,
      abort: new AbortController(),
      canUseTool: async () => ({ behavior: 'deny', message: '' }),
      resume: null,
      preferences: undefined,
      hooks: undefined,
    })
  expect(options(true).disallowedTools).toEqual(['AskUserQuestion'])
  expect(options(false).disallowedTools).toBeUndefined()
})

it("keeps Claude Code's own idle compaction only when Ramu asks on return, and declares the return prompt", () => {
  expect(launch(undefined, undefined, { idleCompaction: 'onReturn' }).settings).not.toHaveProperty('idleCompaction')
  expect(launch(undefined, undefined, { idleCompaction: 'beforeCacheExpires' }).settings).toMatchObject({
    idleCompaction: false,
  })
  expect(launch(undefined, undefined, { idleCompaction: 'off' }).settings).toMatchObject({ idleCompaction: false })
  expect(launch(undefined).supportedDialogKinds).toBeUndefined()
  const onUserDialog = async () => ({ behavior: 'cancelled' as const })
  const options = claudeLaunchOptions({
    session: { cwd: '/tmp', additionalDirs: [], settings: { access: 'edits' } } as unknown as AgentSessionInfo,
    connection: undefined,
    advisorModel: undefined,
    abort: new AbortController(),
    canUseTool: async () => ({ behavior: 'deny', message: '' }),
    onUserDialog,
    resume: null,
    preferences: undefined,
    hooks: undefined,
  })
  expect(options.onUserDialog).toBe(onUserDialog)
  expect(options.supportedDialogKinds).toEqual(['resume_return'])
})
