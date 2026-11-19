import { describe, expect, it } from 'vitest'
import {
  computerControllerLabel,
  computerKeyAction,
  computerShortcuts,
  frameOffset,
  needsHandoff,
  showsLocalInputLimit,
} from '../src/computerControl'

const base = {
  target: { id: 'display:main', kind: 'display' as const, name: 'Main display' },
  generation: 1,
  runtime: { id: 'local', name: 'Mac' },
  paused: false,
}

describe('computer control copy', () => {
  it('says when the person controls from another of their devices', () => {
    const human = { ...base, controller: { kind: 'human' as const, deviceId: 'phone' } }
    expect(computerControllerLabel({ ...human, controlledHere: true })).toBe('You are in control')
    expect(computerControllerLabel({ ...human, controlledHere: false })).toBe('Another of your devices has control')
  })
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

describe('keyboard on a remote computer', () => {
  const press = (key: string, held: Partial<Record<'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey', boolean>> = {}) => ({
    key,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...held,
  })
  it('types characters and presses named keys', () => {
    expect(computerKeyAction(press('a'))).toEqual({ kind: 'type', text: 'a' })
    expect(computerKeyAction(press('A', { shiftKey: true }))).toEqual({ kind: 'type', text: 'A' })
    expect(computerKeyAction(press('é'))).toEqual({ kind: 'type', text: 'é' })
    expect(computerKeyAction(press(' '))).toEqual({ kind: 'type', text: ' ' })
    expect(computerKeyAction(press('Enter'))).toEqual({ kind: 'key', key: 'Enter' })
    expect(computerKeyAction(press('Tab', { shiftKey: true }))).toEqual({
      kind: 'key',
      key: 'Tab',
      modifiers: ['Shift'],
    })
  })
  it('sends shortcuts with their modifiers and ignores lone modifiers and composition', () => {
    expect(computerKeyAction(press('c', { metaKey: true }))).toEqual({ kind: 'key', key: 'c', modifiers: ['Meta'] })
    expect(computerKeyAction(press('Z', { metaKey: true, shiftKey: true }))).toEqual({
      kind: 'key',
      key: 'z',
      modifiers: ['Meta', 'Shift'],
    })
    expect(computerKeyAction(press('Shift', { shiftKey: true }))).toBeNull()
    expect(computerKeyAction(press('Dead'))).toBeNull()
    expect(computerKeyAction(press('Process'))).toBeNull()
  })
  it('swaps Command and Control between a Mac and another computer', () => {
    expect(computerKeyAction(press('c', { metaKey: true }), { viewer: 'macos', target: 'linux' })).toEqual({
      kind: 'key',
      key: 'c',
      modifiers: ['Control'],
    })
    expect(computerKeyAction(press('c', { ctrlKey: true }), { viewer: 'windows', target: 'macos' })).toEqual({
      kind: 'key',
      key: 'c',
      modifiers: ['Meta'],
    })
    expect(computerKeyAction(press('c', { metaKey: true }), { viewer: 'macos', target: 'macos' })).toEqual({
      kind: 'key',
      key: 'c',
      modifiers: ['Meta'],
    })
  })
  it('uses the computer’s own command key for shortcuts', () => {
    const mac = computerShortcuts('macos').shortcuts.find((entry) => entry.id === 'copy')!
    const linux = computerShortcuts('linux').shortcuts.find((entry) => entry.id === 'copy')!
    expect(mac.action).toEqual({ kind: 'key', key: 'c', modifiers: ['Meta'] })
    expect(linux.action).toEqual({ kind: 'key', key: 'c', modifiers: ['Control'] })
    expect(computerShortcuts('linux').shortcuts.find((entry) => entry.id === 'redo')!.action).toEqual({
      kind: 'key',
      key: 'y',
      modifiers: ['Control'],
    })
    expect(computerShortcuts('macos').keys.map((entry) => entry.id)).toContain('escape')
  })
})
