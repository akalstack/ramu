import { expect, it } from 'vitest'
import { createOutputGate, hasUnseenTerminalOutput, markTerminalOutput, setShownTerminal, SETTLE_MS } from '../src/terminalActivity'

function clock() { let at = 1_000; return { now: () => at, advance: (ms: number) => { at += ms } } }

it('ignores a new shell’s startup output until it has been quiet', () => {
  const time = clock(), gate = createOutputGate(time.now)
  expect(gate.output()).toBe(false) // prompt
  time.advance(SETTLE_MS - 1)
  expect(gate.output()).toBe(false) // slow rc file output keeps it in startup
  time.advance(SETTLE_MS)
  expect(gate.output()).toBe(true) // later output is news
  expect(gate.output()).toBe(true)
})

it('counts output straight away once someone types or a command runs', () => {
  const gate = createOutputGate(clock().now)
  gate.arm()
  expect(gate.output()).toBe(true)
})

it('marks only workspaces whose terminal is not on screen, and showing one clears it', () => {
  setShownTerminal('a')
  markTerminalOutput('a')
  markTerminalOutput('b')
  expect(hasUnseenTerminalOutput('a')).toBe(false)
  expect(hasUnseenTerminalOutput('b')).toBe(true)
  setShownTerminal('b')
  expect(hasUnseenTerminalOutput('b')).toBe(false)
  setShownTerminal(null)
  expect(hasUnseenTerminalOutput('b')).toBe(false)
  expect(hasUnseenTerminalOutput(null)).toBe(false)
})
