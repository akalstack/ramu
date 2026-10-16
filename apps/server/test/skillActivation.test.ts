import { expect, it } from 'vitest'
import type { ManagedSkill } from '@ramu/shared/types'
import { skillMetadata } from '../src/memory/skillFiles'
import { metadataActivation, skillCompatibility } from '../src/memory/skillActivation'

it('validates requirement metadata at installation rather than silently executing an invalid gate', () => {
  expect(() =>
    skillMetadata(
      '---\nname: test\ndescription: Test\nmetadata:\n  ramu:\n    requires_tools: shell\n---\nInstructions',
    ),
  ).toThrow()
  expect(
    metadataActivation({ metadata: { ramu: { requires_tools: ['shell'], fallback_for_toolsets: ['browser'] } } }),
  ).toEqual({ requires_tools: ['shell'], fallback_for_toolsets: ['browser'] })
})

it('requires all dependencies, disables fallbacks for any available dependency, and preserves unconditional skills', () => {
  const skill = {
    activation: {
      requires_tools: ['shell', 'read_file'],
      requires_toolsets: ['terminal'],
      fallback_for_tools: ['browser_open', 'browser_navigate'],
    },
  } as ManagedSkill
  expect(skillCompatibility(skill, ['shell', 'read_file'], ['terminal'], true).available).toBe(true)
  expect(skillCompatibility(skill, ['shell', 'read_file', 'browser_navigate'], ['terminal'], true).available).toBe(
    false,
  )
  expect(skillCompatibility(skill, ['shell'], ['terminal'], true).reasons).toContain('Requires tool: read_file')
  expect(skillCompatibility(skill, ['shell', 'read_file'], [], true).reasons).toContain('Requires toolset: terminal')
  expect(skillCompatibility(skill, ['shell', 'read_file'], ['terminal'], false).available).toBe(false)
  expect(skillCompatibility({} as ManagedSkill, [], [], false).available).toBe(true)
})
