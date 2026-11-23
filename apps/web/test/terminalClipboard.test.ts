import { describe, expect, it } from 'vitest'
import { terminalClipboardKey, terminalPlatform } from '../src/workspace/terminalClipboard'

const key = (key: string, mods: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean } = {}) => ({
  type: 'keydown',
  key,
  ctrlKey: !!mods.ctrl,
  shiftKey: !!mods.shift,
  altKey: !!mods.alt,
  metaKey: !!mods.meta,
})

describe('terminalClipboardKey', () => {
  it('copies with Ctrl+C only while text is selected, so Ctrl+C still interrupts', () => {
    expect(terminalClipboardKey(key('c', { ctrl: true }), 'linux', true)).toBe('copy')
    expect(terminalClipboardKey(key('c', { ctrl: true }), 'linux', false)).toBeNull()
  })

  it('always copies and pastes with Ctrl+Shift+C and Ctrl+Shift+V', () => {
    expect(terminalClipboardKey(key('C', { ctrl: true, shift: true }), 'windows', false)).toBe('copy')
    expect(terminalClipboardKey(key('V', { ctrl: true, shift: true }), 'linux', false)).toBe('paste')
  })

  it('pastes with Ctrl+V on Windows and leaves it to the shell on Linux', () => {
    expect(terminalClipboardKey(key('v', { ctrl: true }), 'windows', false)).toBe('paste')
    expect(terminalClipboardKey(key('v', { ctrl: true }), 'linux', false)).toBeNull()
  })

  it('leaves the Mac to its Edit menu and ignores key releases and other chords', () => {
    expect(terminalClipboardKey(key('c', { ctrl: true }), 'mac', true)).toBeNull()
    expect(terminalClipboardKey({ ...key('c', { ctrl: true }), type: 'keyup' }, 'linux', true)).toBeNull()
    expect(terminalClipboardKey(key('c', { ctrl: true, alt: true }), 'linux', true)).toBeNull()
  })

  it('reads the platform from the user agent', () => {
    expect(terminalPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('mac')
    expect(terminalPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('windows')
    expect(terminalPlatform('Mozilla/5.0 (X11; Linux x86_64)')).toBe('linux')
  })
})
