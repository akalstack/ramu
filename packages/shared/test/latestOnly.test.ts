import { expect, it } from 'vitest'
import { latestOnly } from '../src/latestOnly'

it('accepts only the newest of overlapping reads, whatever order they finish in', () => {
  const start = latestOnly()
  const first = start()
  const second = start()
  expect(first()).toBe(false)
  expect(second()).toBe(true)
  const third = start()
  expect(second()).toBe(false)
  expect(third()).toBe(true)
})

it('keeps a lone read current until another starts', () => {
  const start = latestOnly()
  const only = start()
  expect(only()).toBe(true)
  expect(only()).toBe(true)
})
