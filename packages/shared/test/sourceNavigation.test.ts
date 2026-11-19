import { afterEach, describe, expect, it, vi } from 'vitest'
import { highlightSource, persistentTaskUi } from '../src/workspace/sourceNavigation'

afterEach(() => vi.useRealTimers())
describe('temporary message navigation', () => {
  it('removes the highlight even when navigation cancels its timer', () => {
    vi.useFakeTimers()
    const classes = new Set<string>(),
      consume = vi.fn()
    const cleanup = highlightSource(
      {
        classList: {
          add: (name) => {
            classes.add(name)
          },
          remove: (name) => {
            classes.delete(name)
          },
        },
      },
      consume,
    )
    expect(classes.has('recap-source-highlight')).toBe(true)
    cleanup()
    vi.advanceTimersByTime(5000)
    expect(classes.size).toBe(0)
    expect(consume).toHaveBeenCalledTimes(1)
  })
  it('expires after four seconds and cleanup is idempotent', () => {
    vi.useFakeTimers()
    const remove = vi.fn(),
      consume = vi.fn()
    const cleanup = highlightSource({ classList: { add: vi.fn(), remove } }, consume)
    vi.advanceTimersByTime(4000)
    cleanup()
    expect(remove).toHaveBeenCalledTimes(1)
    expect(consume).toHaveBeenCalledTimes(1)
  })
  it('preserves tabs and layout while dropping jump requests from saved state', () => {
    const state = {
      views: [{ kind: 'agent' as const, id: 'a', sessionId: 's', sourceSeq: 12, sourceRequestId: 'jump' }],
      activeViewId: 'a',
      dockWidth: 400,
    }
    expect(persistentTaskUi(state)).toEqual({ ...state, views: [{ kind: 'agent', id: 'a', sessionId: 's' }] })
    expect(state.views[0]!.sourceSeq).toBe(12)
  })
})
