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
