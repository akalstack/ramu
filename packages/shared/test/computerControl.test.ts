import { describe, expect, it } from 'vitest'
import { computerControllerLabel, frameOffset, needsHandoff, showsLocalInputLimit } from '../src/computerControl'

const base = {
  target: { id: 'display:main', kind: 'display' as const, name: 'Main display' },
  generation: 1,
  runtime: { id: 'local', name: 'Mac' },
  paused: false,
}

describe('computer control copy', () => {
  it('explains a pause caused by local mouse or keyboard use', () => {
    expect(
      computerControllerLabel({
        ...base,
        controller: { kind: 'human', deviceId: 'local' },
        interruption: 'local-input',
      }),
    ).toMatch(/mouse or keyboard/)
    expect(computerControllerLabel({ ...base, controller: { kind: 'agent', runId: 'r' } })).toBe('Agent control')
  })

  it('recognizes the handoff refusal and the missing-detection limit', () => {
    expect(needsHandoff('Another device controls this computer. Request an explicit handoff.')).toBe(true)
    expect(needsHandoff('Observe first')).toBe(false)
    expect(showsLocalInputLimit({ ...base, controller: { kind: 'none' }, detectsLocalInput: false })).toBe(true)
    expect(showsLocalInputLimit({ ...base, controller: { kind: 'none' }, detectsLocalInput: true })).toBe(false)
    expect(showsLocalInputLimit({ ...base, controller: { kind: 'none' } })).toBe(false)
  })
})

describe('frame offsets', () => {
  const frame = { width: 1600, height: 900 }
  it('maps a touch straight through a box with the frame’s own shape', () => {
    expect(frameOffset({ x: 200, y: 112.5 }, { width: 400, height: 225 }, frame)).toEqual({ x: 800, y: 450 })
  })

  it('accounts for letterbox bars in landscape and ignores touches on them', () => {
    // A tall box: the frame is 400 wide and 225 high, centered with 87.5 above it.
    const box = { width: 400, height: 400 }
    expect(frameOffset({ x: 0, y: 87.5 }, box, frame)).toEqual({ x: 0, y: 0 })
    expect(frameOffset({ x: 399, y: 311 }, box, frame)).toMatchObject({ x: 1596 })
    expect(frameOffset({ x: 200, y: 10 }, box, frame)).toBeNull()
  })

  it('refuses an empty box', () => {
    expect(frameOffset({ x: 1, y: 1 }, { width: 0, height: 0 }, frame)).toBeNull()
  })
})
