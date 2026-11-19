import { expect, it } from 'vitest'
import { createFinishedGate } from '../src/chat/finishedGate'

const ended = { turnEnded: true, helpers: 0 }

it('finishes a plain turn once', () => {
  const gate = createFinishedGate()
  expect(gate.settle('s', 'idle', ended)).toBe(true)
  expect(gate.settle('s', 'idle', { turnEnded: false, helpers: 0 })).toBe(false)
})

it('does not finish a thread whose goal continues or is blocked', () => {
  const gate = createFinishedGate()
  expect(gate.settle('s', 'idle', { ...ended, goal: { status: 'active' } })).toBe(false)
  expect(gate.settle('s', 'idle', { ...ended, goal: { status: 'blocked' } })).toBe(false)
  expect(gate.settle('s', 'idle', { ...ended, goal: { status: 'paused', pausedBy: 'user' } })).toBe(true)
})

it('holds the notice while helpers run, then sends it once when they settle', () => {
  const gate = createFinishedGate()
  expect(gate.settle('s', 'idle', { turnEnded: true, helpers: 2 })).toBe(false)
  expect(gate.settle('s', 'idle', { turnEnded: false, helpers: 1 })).toBe(false)
  expect(gate.settle('s', 'idle', { turnEnded: false, helpers: 0 })).toBe(true)
  expect(gate.settle('s', 'idle', { turnEnded: false, helpers: 0 })).toBe(false)
})

it('forgets a held notice when the thread works again', () => {
  const gate = createFinishedGate()
  gate.settle('s', 'idle', { turnEnded: true, helpers: 1 })
  gate.settle('s', 'running', { turnEnded: false, helpers: 1 })
  expect(gate.settle('s', 'idle', { turnEnded: false, helpers: 0 })).toBe(false)
})
