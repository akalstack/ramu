import { expect, it } from 'vitest'
import {
  customAgentFor,
  customAgentList,
  interpretDraft,
  teammateRecipe,
  teammateRecipeName,
  type CustomAgent,
} from '../src/customAgents'
import { helperActions, helperStatusLabel } from '../src/chat/helperPresentation'

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

it('saves a teammate as a recipe: its brief, its model, and Review as read-only', () => {
  const task = {
    name: 'Opus 5.5',
    prompt: 'Review the reset flow for security problems.\nCheck token expiry too.',
    teammate: 'review' as const,
    provider: 'claude-code' as const,
    model: 'claude-opus-5-5',
    effort: 'high' as const,
  }
  expect(teammateRecipeName(task)).toBe('opus-5.5-reviewer')
  expect(teammateRecipe(task, 'Auth Reviewer')).toEqual({
    name: 'auth-reviewer',
    description: 'Review the reset flow for security problems.',
    instructions: 'Review the reset flow for security problems.\nCheck token expiry too.',
    model: { provider: 'claude-code', model: 'claude-opus-5-5', effort: 'high' },
    readOnly: true,
  })
  // Take over may edit; without a brief it gets the mode's own.
  const helper = teammateRecipe({ name: 'GPT', teammate: 'take-over' }, 'fixer')
  expect(helper).toMatchObject({ readOnly: false, model: null })
  expect(helper.instructions).toMatch(/Take over/)
  expect(teammateRecipeName({ name: 'GPT', teammate: 'take-over' })).toBe('gpt-helper')
})

it('names a paused teammate as waiting for the person and offers Continue only while connected', () => {
  const task = { agentId: 'm', name: 'Opus', status: 'completed' as const, teammate: 'review' as const, paused: true }
  expect(helperStatusLabel(task)).toBe('Paused for you')
  expect(helperActions(task, true).canContinue).toBe(true)
  expect(helperActions(task, false).canContinue).toBe(false)
  expect(helperActions({ ...task, paused: false }, true).canContinue).toBe(false)
})
