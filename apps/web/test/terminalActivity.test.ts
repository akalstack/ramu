import { expect, it } from 'vitest'
import { createOutputGate, createTerminalActivity, SETTLE_MS } from '../src/workspace/terminalActivity'

function clock() {
  let at = 1_000
  return {
    now: () => at,
    advance: (ms: number) => {
      at += ms
    },
  }
}

it('ignores a new shell’s startup output until it has been quiet', () => {
  const time = clock(),
    gate = createOutputGate(time.now)
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
  const { setShownTerminal, markTerminalOutput, hasUnseenTerminalOutput } = createTerminalActivity()
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

it("keeps each host's terminal dots apart, even for the same workspace id", () => {
  const local = createTerminalActivity(),
    studio = createTerminalActivity()
  let notified = 0
  studio.subscribe(() => notified++)
  local.markTerminalOutput('project:p')
  expect(local.hasUnseenTerminalOutput('project:p')).toBe(true)
  expect(studio.hasUnseenTerminalOutput('project:p')).toBe(false)
  expect(notified).toBe(0)
  studio.setShownTerminal('project:p')
  expect(local.hasUnseenTerminalOutput('project:p')).toBe(true)
})
