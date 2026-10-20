import { expect, it } from 'vitest'
import type { AgentSessionInfo } from '@ramu/shared/types'
import { claudeLaunchOptions } from '../src/agent/claudeOptions'

const launch = (advisorModel: string | undefined) =>
  claudeLaunchOptions({
    session: { cwd: '/tmp', additionalDirs: [], settings: { access: 'edits' } } as unknown as AgentSessionInfo,
    connection: undefined,
    advisorModel,
    abort: new AbortController(),
    canUseTool: async () => ({ behavior: 'deny', message: '' }),
    resume: null,
    preferences: undefined,
    hooks: undefined,
  })

it('asks Claude for thinking summaries so the chat has thinking text to show', () => {
  expect(launch(undefined).settings).toEqual({ showThinkingSummaries: true })
  expect(launch('').settings).toEqual({ showThinkingSummaries: true, advisorModel: '' })
})

it("turns off Claude's own AskUserQuestion only when Ramu's question tools replace it", () => {
  const options = (replaceQuestions: boolean) =>
    claudeLaunchOptions({
      session: { cwd: '/tmp', additionalDirs: [], covers: [], settings: { access: 'edits' } } as unknown as AgentSessionInfo,
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
