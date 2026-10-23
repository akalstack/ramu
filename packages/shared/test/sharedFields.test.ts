import { describe, expect, it } from 'vitest'
import { emptyLayer, offeredScopes } from '../src/preferenceScopes'
import { applyLayerEdit } from '../src/modelFlow'
import { SHARED_MOBILE_FIELDS, isSharedMobileField, sharedValue } from '../src/sharedFields'

describe('shared mobile fields', () => {
  it('knows exactly the fields the host will carry, and checks each value against its own field', () => {
    expect(Object.keys(SHARED_MOBILE_FIELDS)).toEqual(['modelFlow', 'queueWhileBusy', 'modelChangeWarning'])
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
