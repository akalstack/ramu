import { describe, expect, it, vi } from 'vitest'
import { createEventPump, createHostEventRouter, ownHostOnly } from '../src/workspace/hostEvents'
import { fakeBridge } from './fakeBridge'

describe('host event router', () => {
  it('delivers each event only to listeners of its host', () => {
    const bridge = fakeBridge()
    const router = createHostEventRouter(bridge as never, () => 'local')
    const local = vi.fn(),
      studio = vi.fn()
    router.on('local', 'workspace:changed', local)
    router.on('studio', 'workspace:changed', studio)
    bridge.emit('workspace:changed', { a: 1 }, 'studio')
    expect(studio).toHaveBeenCalledWith({ a: 1 })
    expect(local).not.toHaveBeenCalled()
    bridge.emit('workspace:changed', { a: 2 }, 'local')
    expect(local).toHaveBeenCalledWith({ a: 2 })
    expect(studio).toHaveBeenCalledTimes(1)
  })

  it('treats an event without a host as the window’s own (per-window delivery, flag off)', () => {
    const bridge = fakeBridge()
    let own = 'studio'
    const router = createHostEventRouter(bridge as never, () => own)
    const studio = vi.fn(),
      local = vi.fn()
    router.on('studio', 'term:changed', studio)
    router.on('local', 'term:changed', local)
    bridge.emit('term:changed', { taskId: 't' })
    expect(studio).toHaveBeenCalledTimes(1)
    expect(local).not.toHaveBeenCalled()
    own = 'local'
    bridge.emit('term:changed', { taskId: 't' })
    expect(local).toHaveBeenCalledTimes(1)
  })

  it('subscribes the bridge once per channel and lets go when the last listener leaves', () => {
    const bridge = fakeBridge()
    const router = createHostEventRouter(bridge as never, () => 'local')
    const offA = router.on('local', 'agent:event', () => {})
    const offB = router.on('studio', 'agent:event', () => {})
    expect(bridge.on).toHaveBeenCalledTimes(1)
    offA()
    offA()
    expect(bridge.count('agent:event')).toBe(1)
    offB()
    expect(bridge.count('agent:event')).toBe(0)
    router.on('local', 'agent:event', () => {})
    expect(bridge.on).toHaveBeenCalledTimes(2)
  })
})

describe('event pump', () => {
  const manual = () => {
    const ticks: (() => void)[] = []
    return { schedule: (run: () => void) => void ticks.push(run), run: () => ticks.shift()?.(), ticks }
  }

  it('coalesces work under one key, the latest winning', () => {
    const clock = manual()
    const pump = createEventPump({ schedule: clock.schedule })
    const seen: number[] = []
    for (let i = 0; i < 50; i++) pump.defer('studio', 'refresh', () => seen.push(i))
    expect(pump.pending('studio')).toBe(1)
    expect(clock.ticks).toHaveLength(1)
    clock.run()
    expect(seen).toEqual([49])
    expect(pump.pending()).toBe(0)
  })

  it('shares each turn between hosts so a busy host cannot starve a quiet one', () => {
    const clock = manual()
    const pump = createEventPump({ schedule: clock.schedule, budget: 4 })
    const order: string[] = []
    for (let i = 0; i < 10; i++) pump.defer('busy', `k${i}`, () => order.push(`busy${i}`))
    pump.defer('quiet', 'refresh', () => order.push('quiet'))
    clock.run()
    // The quiet host runs in the first turn, not after the busy host's backlog.
    expect(order).toHaveLength(4)
    expect(order).toContain('quiet')
    // The rest follows in later turns, within the budget each time.
    while (clock.ticks.length) clock.run()
    expect(order).toHaveLength(11)
  })

  it('runs a host’s pending work at once when it comes on screen, and drops it when its store unmounts', () => {
    const clock = manual()
    const pump = createEventPump({ schedule: clock.schedule })
    const run = vi.fn()
    pump.defer('studio', 'a', run)
    pump.flush('studio')
    expect(run).toHaveBeenCalledTimes(1)
    const dropped = vi.fn()
    pump.defer('lab', 'a', dropped)
    pump.cancel('lab')
    clock.run()
    expect(dropped).not.toHaveBeenCalled()
  })

  it('keeps going when one item throws', () => {
    const clock = manual()
    const report = vi.fn()
    const pump = createEventPump({ schedule: clock.schedule, report })
    const after = vi.fn()
    pump.defer('a', 'x', () => {
      throw new Error('boom')
    })
    pump.defer('b', 'x', after)
    clock.run()
    expect(report).toHaveBeenCalled()
    expect(after).toHaveBeenCalled()
  })
})

it('filters a frozen Electron bridge without overriding proxy invariants', () => {
  const bridge = Object.freeze(fakeBridge())
  const own = ownHostOnly(bridge as never, () => 'local') as typeof bridge
  const receive = vi.fn()
  own.on('agent:event', receive)
  bridge.emit('agent:event', 'remote', 'studio')
  bridge.emit('agent:event', 'local', 'local')
  expect(receive).toHaveBeenCalledTimes(1)
  expect(receive).toHaveBeenCalledWith('local', 'local')
  expect(own.on).not.toBe(bridge.on)
  expect(own.emit).toBe(bridge.emit)
})
