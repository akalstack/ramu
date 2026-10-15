import { expect, it } from 'vitest'
import { fingerprint, InputGate } from '../src/background/inputGate'

const store = () => {
  const data = new Map<string, unknown>()
  return {
    data,
    getAppState: <T>(key: string, fallback: T) => (data.has(key) ? (data.get(key) as T) : fallback),
    setAppState: (key: string, value: unknown) => void data.set(key, value),
  }
}

it('fingerprints equal inputs equally regardless of key order, and different inputs differently', () => {
  expect(fingerprint({ a: 1, b: { c: [1, 2], d: 'x' } })).toBe(fingerprint({ b: { d: 'x', c: [1, 2] }, a: 1 }))
  expect(fingerprint({ a: 1 })).not.toBe(fingerprint({ a: 2 }))
  expect(fingerprint([1, 2])).not.toBe(fingerprint([2, 1]))
  expect(fingerprint({ model: 'a' })).not.toBe(fingerprint({ model: 'b' }))
  expect(fingerprint(undefined)).toBe(fingerprint(null))
})

it('runs until a fingerprint is recorded, then skips only that fingerprint', () => {
  const gate = new InputGate(store())
  expect(gate.shouldRun('job', 'one')).toBe(true)
  expect(gate.shouldRun('job', 'one')).toBe(true) // a failed run records nothing, so it retries
  gate.record('job', 'one')
  expect(gate.shouldRun('job', 'one')).toBe(false)
  expect(gate.shouldRun('job', 'two')).toBe(true)
  expect(gate.shouldRun('other', 'one')).toBe(true)
})

it('can be forced or cleared', () => {
  const gate = new InputGate(store())
  gate.record('job', 'one')
  expect(gate.shouldRun('job', 'one', true)).toBe(true)
  gate.clear('job')
  expect(gate.shouldRun('job', 'one')).toBe(true)
})

it('persists across service instances through the shared store', () => {
  const shared = store()
  new InputGate(shared).record('job', 'one')
  expect(new InputGate(shared).shouldRun('job', 'one')).toBe(false)
})
