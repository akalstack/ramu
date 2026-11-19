import { expect, it } from 'vitest'
import { openCodeStepTokens } from '../src/providers/opencode'
import { addTokens } from '../src/providers/turnTokens'

it("adds each OpenCode step's tokens, cached reads as input and reasoning as output", () => {
  const first = openCodeStepTokens({ input: 900, output: 40, reasoning: 10, cache: { read: 100, write: 0 } })
  const second = openCodeStepTokens({ input: 50, output: 5, reasoning: 0, cache: { read: 0, write: 20 } })
  expect(first).toEqual({ input: 1000, output: 50 })
  expect(addTokens(addTokens(null, first), second)).toEqual({ input: 1050, output: 55 })
  expect(openCodeStepTokens(undefined)).toBeNull()
  expect(openCodeStepTokens({ input: 'x', output: 1 })).toBeNull()
})
