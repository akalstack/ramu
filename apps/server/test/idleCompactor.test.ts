import { describe, expect, it, vi, afterEach } from 'vitest'
import { IdleCompactor, IDLE_COMPACT_MIN_TOKENS, type IdleCompactorHost } from '../src/agent/idleCompactor'

function setup(over: { used?: number; enabled?: boolean; provider?: string; queued?: number; tasks?: boolean } = {}) {
  const pushed: string[] = []
  const states: string[] = []
  const session = { provider: over.provider ?? 'claude-code', parentId: undefined, state: 'idle' }
  const host = {
    preferences: () => ({ idleCompaction: over.enabled ?? true }),
    shutdown: () => false,
    live: new Map([['a', { input: { push: (text: string) => pushed.push(text) } }]]),
    runners: new Map(),
    setState: (_id: string, state: string) => states.push(state),
    get: () => session,
    hasRunningTasks: () => over.tasks ?? false,
    queued: () => Array.from({ length: over.queued ?? 0 }),
    context: () => ({ used: over.used ?? IDLE_COMPACT_MIN_TOKENS, max: 200_000 }),
  } as unknown as IdleCompactorHost
  return { compactor: new IdleCompactor(host, 1000), pushed, states }
}

afterEach(() => vi.useRealTimers())

describe('IdleCompactor', () => {
  it('summarizes a long idle Claude thread before its cache lapses', () => {
    vi.useFakeTimers()
    const { compactor, pushed, states } = setup()
    compactor.stateChanged('a', 'idle')
    vi.advanceTimersByTime(999)
    expect(pushed).toEqual([])
    vi.advanceTimersByTime(1)
    expect(pushed).toEqual(['/compact'])
    expect(states).toEqual(['running'])
  })

  it('does nothing when the thread resumes before the delay', () => {
    vi.useFakeTimers()
    const { compactor, pushed } = setup()
    compactor.stateChanged('a', 'idle')
    compactor.stateChanged('a', 'running')
    vi.advanceTimersByTime(5000)
    expect(pushed).toEqual([])
  })

  it.each([
    ['the setting is off', { enabled: false }],
    ['the context is short', { used: IDLE_COMPACT_MIN_TOKENS - 1 }],
    ['another provider', { provider: 'codex' }],
    ['messages are queued', { queued: 1 }],
    ['background tasks run', { tasks: true }],
  ])('skips when %s', (_name, over) => {
    vi.useFakeTimers()
    const { compactor, pushed, states } = setup(over)
    compactor.stateChanged('a', 'idle')
    vi.advanceTimersByTime(5000)
    expect(pushed).toEqual([])
    expect(states).toEqual([])
  })
})
