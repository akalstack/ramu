import { expect, it } from 'vitest'
import { modelContextWindow } from '../src/providers/modelContext'

it('reads positive provider-reported capacities without guessing from model names', () => {
  expect(modelContextWindow({ contextWindow: 32_000 })).toBe(32_000)
  expect(modelContextWindow({ contextWindowTokens: 64_000 })).toBe(64_000)
  expect(modelContextWindow({ context_window: 128_000 })).toBe(128_000)
  expect(modelContextWindow({ limit: { context: 200_000 } })).toBe(200_000)
  for (const value of [
    null,
    {},
    { id: 'model-1m' },
    { contextWindow: '32000' },
    { contextWindow: -1 },
    { contextWindow: Infinity },
    { contextWindow: NaN },
  ])
    expect(modelContextWindow(value)).toBeUndefined()
})
