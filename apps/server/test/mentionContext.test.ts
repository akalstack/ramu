import { expect, it } from 'vitest'
import type { AgentModel } from '@ramu/shared/types'
import type { CustomAgent } from '@ramu/shared/customAgents'
import { addContextLine, withMentionInstruction } from '../src/agent/mentionContext'

const opus = { provider: 'claude-code', id: 'claude-opus-5-5', name: 'Opus 5.5', efforts: [] } as unknown as AgentModel
const sources = (patch: Partial<Parameters<typeof withMentionInstruction>[1]> = {}) => ({
  models: async () => [opus],
  agents: () => [{ id: 'r', name: 'security-reviewer', readOnly: true } as CustomAgent],
  abilities: async () => ({ images: opus }),
  ...patch,
})

it('tells the main agent which helper an @mention asks for, inside the context Ramu already appended', async () => {
  const sent = await withMentionInstruction(
    '@opus-5.5 review the diff\n\n<ramu-context>\nFiles\n</ramu-context>',
    sources(),
  )
  expect(sent).toBe(
    '@opus-5.5 review the diff\n\n<ramu-context>\nFiles\nThe person addressed this message to a helper. Start one with ramu_agent, model "opus-5.5" and role "review", give it the request with the context it needs, then relay its report.\n</ramu-context>',
  )
  expect(await withMentionInstruction('@security-reviewer look', sources())).toContain('type "security-reviewer"')
  expect(await withMentionInstruction('@images a hero', sources())).toContain('needs ["image_generation"]')
})

it('leaves plain messages, unknown handles and failed lookups as they were', async () => {
  expect(await withMentionInstruction('review @opus-5.5', sources())).toBe('review @opus-5.5')
  expect(await withMentionInstruction('@someone hi', sources())).toBe('@someone hi')
  const failing = sources({
    models: async () => Promise.reject(new Error('offline')),
    agents: () => {
      throw new Error('no store')
    },
  })
  expect(await withMentionInstruction('@opus-5.5 hi', failing)).toBe('@opus-5.5 hi')
  expect(addContextLine('hi', 'note')).toBe('hi\n\n<ramu-context>\nnote\n</ramu-context>')
})
