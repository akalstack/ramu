import { createDispatcher, type Services } from '../src/ipc'
import { configureProviderBinaries } from '../src/providers/providerBinaries'
import { expect, it } from 'vitest'
import { intelligenceSchema } from '../src/intelligence'

it('rejects out-of-range intelligence values', () => {
  expect(() => intelligenceSchema.parse({ dailyReviews: 0 })).toThrow()
})

it('defaults recall and tool-aware skills on for existing profiles and keeps them independent of learning', () => {
  expect(intelligenceSchema.parse({ learning: 'off' })).toMatchObject({
    crossThreadRecall: true,
    toolAwareSkills: true,
  })
  expect(intelligenceSchema.parse({ crossThreadRecall: false })).toMatchObject({
    crossThreadRecall: false,
    toolAwareSkills: true,
  })
  expect(intelligenceSchema.parse({ toolAwareSkills: false })).toMatchObject({
    crossThreadRecall: true,
    toolAwareSkills: false,
  })
  expect(() => intelligenceSchema.parse({ crossThreadRecall: 'false' })).toThrow()
})

it('lists managed skills for a new-thread project context before a task exists', () => {
  const dispatcher = createDispatcher({ userData: '/tmp/ramu-style-test', send: () => {}, native: async () => null }, {
    workspace: {
      getAppState: (_key: string, fallback: unknown) => fallback,
      projectIdOf: (context: string) => {
        if (context !== 'project:alpha') throw new Error('Unexpected context')
        return 'alpha'
      },
      agentScope: () => ({ cwd: '/nonexistent-ramu-fixture', additionalDirs: [], covers: [] }),
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
