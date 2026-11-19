import { describe, expect, it } from 'vitest'
import { inheritedModelFlow, resolveModelFlow } from '../src/providers/modelFlow'

describe('model selection flow scopes', () => {
  it('lets a phone override beat the all-mobile value, which beats the all-device value', () => {
    const prefs = { defaultBarMode: 'effort', mobileBarMode: 'model' } as const
    expect(resolveModelFlow(prefs, { mobile: true, device: 'effort' })).toEqual({ flow: 'effort', source: 'device' })
    expect(resolveModelFlow(prefs, { mobile: true })).toEqual({ flow: 'model', source: 'mobile' })
    expect(resolveModelFlow({ defaultBarMode: 'effort' }, { mobile: true })).toEqual({ flow: 'effort', source: 'all' })
  })

  it('ignores mobile layers on desktop and falls back to Steps', () => {
    expect(resolveModelFlow({ mobileBarMode: 'effort' }, { mobile: false, device: 'effort' })).toEqual({
      flow: 'model',
      source: 'default',
    })
    expect(resolveModelFlow(null, { mobile: true, device: 'bogus' })).toEqual({ flow: 'model', source: 'default' })
  })

  it('previews what clearing an override inherits', () => {
    const prefs = { defaultBarMode: 'model', mobileBarMode: 'effort' } as const
    expect(inheritedModelFlow(prefs, 'device')).toEqual({ flow: 'effort', source: 'mobile' })
    expect(inheritedModelFlow(prefs, 'mobile')).toEqual({ flow: 'model', source: 'all' })
    expect(inheritedModelFlow(prefs, 'mobile', 'effort')).toEqual({ flow: 'effort', source: 'device' })
  })
})
