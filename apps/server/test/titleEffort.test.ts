import { expect, it, vi } from 'vitest'
import { BackgroundAnalysis } from '../src/agent/backgroundAnalysis'
import { DEFAULT_AGENT_SETTINGS, type AgentSettings } from '@ramu/shared/types'

it('drafts a thread title on the thread’s own model at its lightest effort, so it answers within the time limit', async () => {
  const analyze = vi.fn(async (_prompt: string, settings: AgentSettings) => ({
    message: '{"title":"Add login","needsRefinement":false}',
    provider: settings.provider,
    model: settings.model,
  }))
  const analysis = new BackgroundAnalysis({
    titleContext: () => ({ users: ['Add a login page'], replies: [] }),
    catalog: async () => [
      {
        provider: 'claude-code',
        models: [{ id: 'opus', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' }],
      },
    ],
    analyze,
  } as never)
  await analysis.draftTitleResult('t', {
    ...DEFAULT_AGENT_SETTINGS,
    provider: 'claude-code',
    model: 'opus',
    effort: 'high',
  })
  expect(analyze.mock.calls[0]![1]).toMatchObject({ provider: 'claude-code', model: 'opus', effort: 'low' })
})
