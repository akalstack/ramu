import { expect, it, vi } from 'vitest'
import { SessionProcess, type SessionProcessHost } from '../src/agent/sessionProcess'

function processWith(shuttingDown: boolean) {
  const host = {
    shutdown: () => shuttingDown,
    record: vi.fn(),
    setState: vi.fn(),
    saveGoal: vi.fn(),
    getGoal: () => ({ id: 'g', objective: 'Ship it', status: 'active', turns: 2, reason: '', updatedAt: 1 }),
    retryQuietly: () => false,
    waitForGoalProvider: () => false,
  }
  return { host, process: new SessionProcess(host as unknown as SessionProcessHost, {} as never) }
}

it('a provider the service shutdown ends is not a failure: the run and its goal are left for restart recovery', () => {
  const { host, process } = processWith(true)
  process.fail('s1', new Error('Claude Code process exited with code 143'))
  expect(host.record).not.toHaveBeenCalled()
  expect(host.setState).not.toHaveBeenCalled()
  expect(host.saveGoal).not.toHaveBeenCalled()
})

it('a provider that fails while the service runs still reads as failed, with its goal blocked', () => {
  const { host, process } = processWith(false)
  process.fail('s1', new Error('Claude Code process exited with code 1'))
  expect(host.record).toHaveBeenCalledWith('s1', { kind: 'error', message: expect.stringContaining('code 1') })
  expect(host.setState).toHaveBeenCalledWith('s1', 'failed')
  expect(host.saveGoal).toHaveBeenCalledWith('s1', expect.objectContaining({ status: 'blocked' }))
})
