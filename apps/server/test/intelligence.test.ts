import { createDispatcher, type Services } from '../src/ipc'
import { configureProviderBinaries } from '../src/providerBinaries'
import { expect, it } from 'vitest'
import { DEFAULT_AGENT_SETTINGS, DEFAULT_INTELLIGENCE_PREFERENCES } from '@ramu/shared/types'
import { intelligenceSchema, responseInstructions } from '../src/intelligence'

it('uses per-chat style over the global default and keeps exact artifacts outside prose shortening', () => {
  const saved = { ...DEFAULT_INTELLIGENCE_PREFERENCES, responseStyle: 'detailed' as const }
  expect(responseInstructions({ ...DEFAULT_AGENT_SETTINGS, responseStyle: 'adhd' }, saved)).toContain('numbered steps')
  expect(responseInstructions({ ...DEFAULT_AGENT_SETTINGS, responseStyle: 'adhd' }, saved)).not.toContain(
    'Explain the reasoning',
  )
  expect(responseInstructions({ ...DEFAULT_AGENT_SETTINGS, responseStyle: 'inherit' }, saved)).toContain(
    'Explain the reasoning',
  )
  expect(responseInstructions({ ...DEFAULT_AGENT_SETTINGS, responseStyle: 'caveman' }, saved)).toContain(
    'Preserve exact code',
  )
  expect(responseInstructions({ ...DEFAULT_AGENT_SETTINGS, responseStyle: 'default' }, saved)).toBe('')
  expect(() => intelligenceSchema.parse({ dailyReviews: 0 })).toThrow()
})

it('lists managed skills for a new-chat project context before a task exists', () => {
  const dispatcher = createDispatcher({ userData: '/tmp/ramu-style-test', send: () => {}, native: async () => null }, {
    workspace: {
      getAppState: (_key: string, fallback: unknown) => fallback,
      projectIdOf: (context: string) => {
        if (context !== 'project:alpha') throw new Error('Unexpected context')
        return 'alpha'
      },
      agentScope: () => ({ cwd: '/nonexistent-ramu-fixture', additionalDirs: [] }),
    },
    learning: {
      catalog: (projectId: string) => [
        { name: `managed-${projectId}`, description: 'Managed procedure', path: '/managed/SKILL.md' },
      ],
    },
  } as unknown as Services)
  try {
    expect(dispatcher.invoke('skills.list', ['project:alpha'])).toContainEqual({
      name: 'managed-alpha',
      description: 'Managed procedure',
      path: '/managed/SKILL.md',
    })
  } finally {
    dispatcher.close()
    configureProviderBinaries({})
  }
})
