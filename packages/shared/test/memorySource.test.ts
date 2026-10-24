import { describe, expect, it } from 'vitest'
import { memorySourceThread } from '../src/chat/memorySource'

describe('memory source thread', () => {
  const known = new Set(['t1'])

  it('offers a link only for a thread that still exists', () => {
    expect(memorySourceThread({ actor: 'agent', taskId: 't1', sessionId: 's1', eventSeq: 4 }, known)).toEqual({
      state: 'thread',
      taskId: 't1',
      sessionId: 's1',
      eventSeq: 4,
    })
    expect(memorySourceThread({ actor: 'agent', taskId: 't2', sessionId: 's2' }, known)).toEqual({
      state: 'unavailable',
    })
  })

  it('says the source is unavailable when only a session was recorded, and none for notes saved by hand', () => {
    expect(memorySourceThread({ actor: 'agent', sessionId: 's1' }, known)).toEqual({ state: 'unavailable' })
    expect(memorySourceThread({ actor: 'user', confirmed: true }, known)).toEqual({ state: 'none' })
    expect(memorySourceThread({ actor: 'dream' }, known)).toEqual({ state: 'none' })
  })

  it('leaves out the event when none was recorded', () => {
    expect(memorySourceThread({ actor: 'agent', taskId: 't1' }, known)).toEqual({ state: 'thread', taskId: 't1' })
  })
})
