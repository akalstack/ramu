import { describe, expect, it } from 'vitest'
import { BROWSER_INPUT_KEY, browserShortcuts } from '../src/browserBridge'
import { computerShortcuts } from '../src/computerControl'

describe('browser keys and shortcuts', () => {
  it('offers only keys the host browser accepts from a person', () => {
    const { keys, shortcuts } = browserShortcuts()
    for (const entry of [...keys, ...shortcuts]) expect(entry.input.key).toMatch(BROWSER_INPUT_KEY)
  })

  it('uses the host’s own shortcut key and matches the computer viewer’s keys', () => {
    const { keys, shortcuts } = browserShortcuts()
    expect(shortcuts.find((entry) => entry.id === 'copy')!.input).toEqual({
      kind: 'key',
      key: 'c',
      modifiers: ['Primary'],
    })
    expect(shortcuts.some((entry) => entry.id === 'paste')).toBe(false)
    expect(keys.map((entry) => entry.id)).toEqual(computerShortcuts('macos').keys.map((entry) => entry.id))
  })
})
