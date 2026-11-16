import { describe, expect, it } from 'vitest'
import { emptyLayer, inheritedPreview, offeredScopes, parseLayer, resolvePreference } from '../src/preferenceScopes'
import { applyLayerEdit } from '../src/modelFlow'
import { SHARED_MOBILE_FIELDS, isSharedMobileField, planLayerSync, sharedValue } from '../src/sharedFields'

describe('shared mobile fields', () => {
  it('knows exactly the fields the host will carry, and checks each value against its own field', () => {
    expect(Object.keys(SHARED_MOBILE_FIELDS)).toEqual([
      'modelFlow',
      'queueWhileBusy',
      'modelChangeWarning',
      'recentChatMode',
    ])
    expect(isSharedMobileField('queueWhileBusy')).toBe(true)
    expect(isSharedMobileField('toString')).toBe(false)
    expect(isSharedMobileField('appearance')).toBe(false)
    expect(SHARED_MOBILE_FIELDS.queueWhileBusy('queue')).toBe(true)
    expect(SHARED_MOBILE_FIELDS.queueWhileBusy('effort')).toBe(false)
    expect(SHARED_MOBILE_FIELDS.modelChangeWarning(false)).toBe(true)
    expect(SHARED_MOBILE_FIELDS.modelChangeWarning('false')).toBe(false)
  })

  it('reads a stored value only when it is valid for its field; anything else reads as not set', () => {
    const set = (id: string, value: unknown) =>
      applyLayerEdit(emptyLayer(), id, { value: value as never, at: 1, by: 'p' }).layer
    expect(sharedValue(set('queueWhileBusy', 'queue'), 'queueWhileBusy')).toBe('queue')
    expect(sharedValue(set('queueWhileBusy', 'sideways'), 'queueWhileBusy')).toBeUndefined()
    expect(sharedValue(set('modelChangeWarning', false), 'modelChangeWarning')).toBe(false)
    expect(sharedValue(null, 'modelChangeWarning')).toBeUndefined()
    expect(sharedValue(emptyLayer(), 'modelFlow')).toBeUndefined()
  })
})

describe('offeredScopes with a host that holds the all-mobile layer', () => {
  it('offers the mobile scope when the host holds it while all-device sharing still needs a transport', () => {
    const scopes = offeredScopes('queueWhileBusy', 'phone', { shared: false, mobile: true })
    expect(scopes.find((s) => s.scope === 'mobile')?.enabled).toBe(true)
    expect(scopes.find((s) => s.scope === 'all')?.enabled).toBe(false)
    expect(scopes.find((s) => s.scope === 'device')?.enabled).toBe(true)
    // Without the flag nothing beyond this phone is offered, as before.
    const before = offeredScopes('queueWhileBusy', 'phone', { shared: false })
    expect(before.filter((s) => s.enabled).map((s) => s.scope)).toEqual(['device'])
  })
})

describe('planLayerSync', () => {
  const layer = (edits: [string, unknown, number, string?][]) =>
    edits.reduce(
      (current, [id, value, at, by = 'p']) =>
        applyLayerEdit(current, id, { ...(value === undefined ? {} : { value: value as never }), at, by }).layer,
      emptyLayer(),
    )

  it('copies the newest entry to every host that holds an older one or none', () => {
    const plan = planLayerSync({
      a: layer([['queueWhileBusy', 'queue', 5]]),
      b: layer([['queueWhileBusy', 'steer', 9]]),
      c: emptyLayer(),
    })
    expect(plan.b).toBeUndefined()
    expect(plan.a).toEqual([{ id: 'queueWhileBusy', value: 'steer', at: 9, by: 'p' }])
    expect(plan.c).toEqual([{ id: 'queueWhileBusy', value: 'steer', at: 9, by: 'p' }])
  })

  it('spreads a clear instead of bringing the cleared value back', () => {
    const plan = planLayerSync({
      a: layer([['modelChangeWarning', false, 5]]),
      b: layer([
        ['modelChangeWarning', false, 5],
        ['modelChangeWarning', undefined, 8],
      ]),
    })
    expect(plan.a).toEqual([{ id: 'modelChangeWarning', at: 8, by: 'p' }])
    expect(plan.b).toBeUndefined()
  })

  it('leaves unreachable hosts and already-equal hosts alone, and does not overwrite a newer unreadable one', () => {
    const same = layer([['queueWhileBusy', 'queue', 5]])
    expect(planLayerSync({ a: same, b: same, c: null })).toEqual({})
    const bad = parseLayer({ v: 1, fields: { queueWhileBusy: { value: 'sideways', at: 99, by: 'x' } } })
    // A newer value this client cannot read (a newer app version) is never overwritten with an older one.
    expect(planLayerSync({ a: same, b: bad }).b).toBeUndefined()
  })
})

describe('a cleared marker', () => {
  it('does not count as an override when resolving or previewing', () => {
    const cleared = applyLayerEdit(emptyLayer(), 'queueWhileBusy', { at: 5, by: 'p' }).layer
    const layers = { all: emptyLayer(), mobile: cleared, device: emptyLayer() }
    expect(resolvePreference(layers, 'queueWhileBusy')).toEqual({ value: null, source: 'default' })
    expect(inheritedPreview(layers, 'queueWhileBusy', 'mobile')).toEqual({ value: null, source: 'default' })
  })
})
