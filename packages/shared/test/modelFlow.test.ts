import { describe, expect, it } from 'vitest'
import { applyLayerEdit, inheritedModelFlow, resolveModelFlow } from '../src/modelFlow'
import { emptyLayer, parseLayer } from '../src/preferenceScopes'

const layers = (mobile = emptyLayer(), device = emptyLayer()) => ({ mobile, device })

describe('model flow scopes', () => {
  it('uses the host setting until a narrower scope overrides it', () => {
    expect(resolveModelFlow('model', layers())).toEqual({ value: 'model', source: 'all' })
    const mobile = applyLayerEdit(emptyLayer(), 'modelFlow', { value: 'effort', at: 5, by: 'a' }).layer
    expect(resolveModelFlow('model', layers(mobile))).toEqual({ value: 'effort', source: 'mobile' })
    const device = applyLayerEdit(emptyLayer(), 'modelFlow', { value: 'model', at: 6, by: 'p1' }).layer
    expect(resolveModelFlow('effort', layers(mobile, device))).toEqual({ value: 'model', source: 'device' })
  })

  it('previews what clearing an override inherits', () => {
    const mobile = applyLayerEdit(emptyLayer(), 'modelFlow', { value: 'effort', at: 5, by: 'a' }).layer
    const device = applyLayerEdit(emptyLayer(), 'modelFlow', { value: 'model', at: 6, by: 'p1' }).layer
    expect(inheritedModelFlow('model', layers(mobile, device), 'device')).toEqual({ value: 'effort', source: 'mobile' })
    expect(inheritedModelFlow('model', layers(mobile, device), 'mobile')).toEqual({ value: 'model', source: 'device' })
  })

  it('ignores unreadable stored values instead of changing the visible flow', () => {
    const bad = parseLayer({ v: 2, fields: { modelFlow: { value: 'future-mode', at: 9, by: 'x' } } })
    expect(resolveModelFlow('effort', layers(bad, bad))).toEqual({ value: 'effort', source: 'all' })
  })

  it('discards stale edits and keeps unrelated fields when clearing', () => {
    const first = applyLayerEdit(emptyLayer(), 'modelFlow', { value: 'effort', at: 10, by: 'a' })
    const stale = applyLayerEdit(first.layer, 'modelFlow', { value: 'model', at: 9, by: 'b' })
    expect(stale.applied).toBe(false)
    expect(stale.layer.fields.modelFlow?.value).toBe('effort')
    const withOther = parseLayer({
      v: 1,
      fields: { ...first.layer.fields, textSize: { value: 'large', at: 1, by: 'a' } },
    })
    const cleared = applyLayerEdit(withOther, 'modelFlow', { at: 11, by: 'a' })
    expect(cleared.applied).toBe(true)
    expect(Object.keys(cleared.layer.fields).sort()).toEqual(['modelFlow', 'textSize'])
    // The marker keeps an older value from coming back, and reads as not set.
    expect(cleared.layer.fields.modelFlow).toMatchObject({ cleared: true, at: 11 })
    expect(applyLayerEdit(cleared.layer, 'modelFlow', { value: 'model', at: 10, by: 'b' }).applied).toBe(false)
    expect(parseLayer(JSON.parse(JSON.stringify(cleared.layer))).fields.modelFlow?.cleared).toBe(true)
    expect(resolveModelFlow('effort', layers(cleared.layer))).toEqual({ value: 'effort', source: 'all' })
  })
})
