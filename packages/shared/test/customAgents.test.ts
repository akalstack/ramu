import { expect, it } from 'vitest'
import { customAgentFor, customAgentList, interpretDraft, type CustomAgent } from '../src/customAgents'

const agent = (name: string, patch: Partial<CustomAgent> = {}): CustomAgent => ({
  id: name,
  name,
  description: `${name} work`,
  instructions: 'Do it.',
  model: null,
  readOnly: true,
  updatedAt: 0,
  ...patch,
})

it('accepts a draft only with the fields a person can edit, and defaults to read-only', () => {
  expect(interpretDraft('Here: {"name":"Security Reviewer","description":"d","instructions":"i"}')).toEqual({
    name: 'security-reviewer',
    description: 'd',
    instructions: 'i',
    readOnly: true,
  })
  expect(interpretDraft('{"name":"x","description":"d","instructions":"i","readOnly":false}')?.readOnly).toBe(false)
  expect(interpretDraft('{"name":"x"}')).toBeNull()
  expect(interpretDraft('not json')).toBeNull()
})

it('finds a custom agent by type name, so it wins over a type rule of the same name', () => {
  const list = [agent('security-reviewer'), agent('Explore')]
  expect(customAgentFor(list, 'Security Reviewer')?.id).toBe('security-reviewer')
  expect(customAgentFor(list, 'explore')?.id).toBe('Explore')
  expect(customAgentFor(list, 'Plan')).toBeUndefined()
  expect(customAgentList(list)).toContain('security-reviewer: security-reviewer work')
  expect(customAgentList([])).toBe('')
})
