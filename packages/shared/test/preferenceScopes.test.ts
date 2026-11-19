import { describe, expect, test } from 'vitest'
import {
  clearOverride,
  emptyLayers,
  inheritedPreview,
  mergeLayer,
  offeredScopes,
  parseLayer,
  resolvePreference,
  setOverride,
  sourceLabel,
} from '../src/preferenceScopes'

describe('preference scopes', () => {
  test('device beats mobile beats all beats default', () => {
    let l = emptyLayers()
    expect(resolvePreference(l, 'appearance')).toEqual({ value: 'system', source: 'default' })
    l = setOverride(l, 'all', 'appearance', 'dark', 'desktop', 1)
    expect(resolvePreference(l, 'appearance')).toEqual({ value: 'dark', source: 'all' })
    l = setOverride(l, 'mobile', 'appearance', 'light', 'phone-a', 2)
    l = setOverride(l, 'device', 'appearance', 'system', 'phone-a', 3)
    expect(resolvePreference(l, 'appearance').source).toBe('device')
  })

  test('changing the baseline keeps narrower overrides, and clearing previews the inherited value', () => {
    let l = setOverride(emptyLayers(), 'device', 'textSize', 'large', 'p', 1)
    l = setOverride(l, 'mobile', 'textSize', 'small', 'p', 2)
    expect(inheritedPreview(l, 'textSize', 'device')).toEqual({ value: 'small', source: 'mobile' })
    expect(resolvePreference(clearOverride(l, 'device', 'textSize'), 'textSize').value).toBe('small')
  })

  test('rejects unknown fields and scopes a field does not support', () => {
    expect(() => setOverride(emptyLayers(), 'all', 'haptics', true, 'x', 1)).toThrow()
    expect(() => setOverride(emptyLayers(), 'all', 'textSize', 'large', 'x', 1)).toThrow()
  })

  test('merging works per field: stale edits lose, other fields survive, removals hold', () => {
    const local = setOverride(emptyLayers(), 'mobile', 'accent', 'blue', 'a', 10).mobile
    const remote = parseLayer({
      v: 2,
      fields: {
        accent: { value: 'red', at: 5, by: 'b' },
        language: { value: 'id', at: 6, by: 'b' },
        future: { value: 'kept', at: 7, by: 'b' },
        bad: { value: { nested: true }, at: 1, by: 'b' },
      },
    })
    const merged = mergeLayer(local, remote)
    expect(merged.fields.accent!.value).toBe('blue')
    expect(merged.fields.language!.value).toBe('id')
    expect(merged.fields.future!.value).toBe('kept')
    expect(merged.fields.bad).toBeUndefined()
    expect(merged.v).toBe(2)
    expect(mergeLayer(local, remote, ['language']).fields.language).toBeUndefined()
  })

  test('same-millisecond edits resolve identically on both sides', () => {
    const a = { v: 1, fields: { accent: { value: 'x', at: 1, by: 'a' } } }
    const b = { v: 1, fields: { accent: { value: 'y', at: 1, by: 'b' } } }
    expect(mergeLayer(a, b).fields.accent).toEqual(mergeLayer(b, a).fields.accent)
  })

  test('shared scopes are explained as unavailable without a transport; desktop has no mobile scope', () => {
    const offered = offeredScopes('appearance', 'phone', { shared: false })
    expect(offered.find((o) => o.scope === 'device')!.enabled).toBe(true)
    expect(offered.find((o) => o.scope === 'all')).toMatchObject({ enabled: false })
    expect(offeredScopes('appearance', 'desktop', { shared: true }).some((o) => o.scope === 'mobile')).toBe(false)
    expect(offeredScopes('textSize', 'phone', { shared: true }).some((o) => o.scope === 'all')).toBe(false)
    expect(sourceLabel('device', 'tablet')).toBe('Set on this tablet')
  })
})
