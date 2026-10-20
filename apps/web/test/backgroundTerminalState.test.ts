import { expect, it } from 'vitest'
import type { BackgroundTerminalInfo } from '@ramu/shared/api'
import { canForceStop, isLiveTerminal, readBackgroundTerminals } from '../src/chat/backgroundTerminalState'

const terminal = (over: Partial<BackgroundTerminalInfo> = {}): BackgroundTerminalInfo => ({
  id: 't1',
  taskId: 'a',
  repoId: null,
  cwd: '/tmp',
  command: 'pnpm dev',
  state: 'running',
  startedAt: 1,
  endedAt: null,
  exitCode: null,
  cursor: 0,
  capabilities: { inspect: true, stop: true, forceStop: true, input: true },
  ...over,
})

it('reads the host list for the thread and keeps the last known rows when the host cannot be reached', async () => {
  const rows = [terminal()]
  expect(await readBackgroundTerminals(async () => rows, 'a', [])).toEqual({ terminals: rows, stale: false })
  const offline = async (): Promise<never> => {
    throw new Error('ECONNREFUSED')
  }
  expect(await readBackgroundTerminals(offline, 'a', rows)).toEqual({ terminals: rows, stale: true })
})

it('offers force stop only while stopping and when the owner supports it', () => {
  expect(canForceStop(terminal())).toBe(false)
  expect(canForceStop(terminal({ state: 'stopping' }))).toBe(true)
  expect(
    canForceStop(
      terminal({ state: 'stopping', capabilities: { inspect: true, stop: true, forceStop: false, input: true } }),
    ),
  ).toBe(false)
  expect(canForceStop(terminal({ state: 'exited' }))).toBe(false)
  expect(isLiveTerminal(terminal({ state: 'failed' }))).toBe(false)
  expect(isLiveTerminal(terminal({ state: 'unknown' }))).toBe(false)
  expect(canForceStop(terminal({ state: 'unknown' }))).toBe(false)
})
