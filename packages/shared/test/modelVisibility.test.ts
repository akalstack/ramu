import { expect, it } from 'vitest'
import { isModelListed } from '../src/providers/modelVisibility'

it('lists everything until a provider has a list, then only that list', () => {
  const model = { provider: 'opencode', id: 'a' }
  expect(isModelListed(undefined, model)).toBe(true)
  expect(isModelListed({ codex: [] }, model)).toBe(true)
  expect(isModelListed({ opencode: ['a'] }, model)).toBe(true)
  expect(isModelListed({ opencode: [] }, model)).toBe(false)
})
