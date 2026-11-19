import { expect, it } from 'vitest'
import { claudeTokens } from '../src/agent/claudeStreamPump'

it("counts a Claude turn's cached and uncached input with its output, and nothing when usage is missing", () => {
  expect(
    claudeTokens({
      input_tokens: 20,
      cache_read_input_tokens: 9000,
      cache_creation_input_tokens: 400,
      output_tokens: 350,
    }),
  ).toEqual({ tokens: { input: 9420, output: 350 } })
  expect(claudeTokens({ input_tokens: 5, output_tokens: 1 })).toEqual({ tokens: { input: 5, output: 1 } })
  expect(claudeTokens(undefined)).toEqual({})
  expect(claudeTokens({ output_tokens: 3 })).toEqual({})
})
