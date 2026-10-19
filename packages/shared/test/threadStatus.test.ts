import { describe, expect, it } from 'vitest'
import { threadStatus } from '../src/chat/threadStatus'

const task = (patch: Partial<Parameters<typeof threadStatus>[0]> = {}) => ({
  status: 'idle' as never,
  waitingUntil: null,
  ...patch,
})

describe('threadStatus', () => {
  it('says nothing for a quiet, read thread', () => {
    expect(threadStatus(task(), false)).toBeNull()
  })

  it('puts live work before a waiting request, a limit, a failure and unread', () => {
    expect(threadStatus(task({ status: 'running', waitingUntil: 5 }), true)?.kind).toBe('working')
    expect(threadStatus(task({ status: 'needs-input', waitingUntil: 5 }), true)?.kind).toBe('input')
    expect(threadStatus(task({ status: 'failed', waitingUntil: 5 }), true)?.kind).toBe('limit')
    expect(threadStatus(task({ status: 'failed' }), true)?.kind).toBe('failed')
    expect(threadStatus(task(), true)?.kind).toBe('finished')
  })

  it('keeps the existing full wording and a shorter label', () => {
    const status = threadStatus(task({ status: 'needs-input' }), false)
    expect(status).toMatchObject({ short: 'Needs input', full: 'Waiting for your input' })
  })
})

describe('threadStatus with a goal', () => {
  const goal = (status: string, pausedBy?: string) => ({ status, pausedBy }) as never

  it('keeps an active goal unfinished between turns and while running', () => {
    expect(threadStatus(task({ status: 'ready-for-review' as never }), true, goal('active'))?.kind).toBe('goal')
    expect(threadStatus(task({ status: 'running' }), false, goal('active'))?.kind).toBe('goal')
    expect(threadStatus(task({ status: 'running' }), false, goal('paused', 'user'))?.kind).toBe('working')
  })

  it('tells a user pause, a block, a turn cap and a provider hold apart', () => {
    expect(threadStatus(task(), false, goal('paused'))?.kind).toBe('paused')
    expect(threadStatus(task(), false, goal('blocked'))?.kind).toBe('blocked')
    expect(threadStatus(task(), false, goal('turn-limit'))?.kind).toBe('turn-limit')
    expect(threadStatus(task(), false, goal('paused', 'provider-limit'))?.kind).toBe('limit')
    expect(threadStatus(task(), false, goal('waiting-provider'))?.kind).toBe('limit')
  })

  it('shows a failure ahead of a blocked goal, and nothing for a completed goal', () => {
    expect(threadStatus(task({ status: 'failed' }), false, goal('blocked'))?.kind).toBe('failed')
    expect(threadStatus(task(), false, goal('completed'))).toBeNull()
    expect(threadStatus(task(), true, goal('completed'))?.kind).toBe('finished')
  })

  it('lets a request waiting for the person lead a goal', () => {
    expect(threadStatus(task({ status: 'needs-input' }), false, goal('active'))?.kind).toBe('input')
  })
})
