import type { ComputerSessionSummary } from './api'
import type { ComputerAction, ComputerModifier } from './computerBridge'

/** Who controls the computer, in the words every viewer shows. Copy keys are English source strings. */
export function computerControllerLabel(session: ComputerSessionSummary): string {
  if (session.interruption === 'local-input') return 'Paused while you use this computer’s mouse or keyboard'
  if (session.paused) return 'Control paused'
  if (session.controller.kind === 'human')
    return session.controlledHere === false ? 'Another of your devices has control' : 'You are in control'
  if (session.controller.kind === 'agent') return 'Agent control'
  return 'Ready'
}

/** The server refuses a take-over from a second device with this wording; the viewer then asks the controller instead. */
export const needsHandoff = (message: string): boolean => /handoff/i.test(message)

/** A display whose host cannot see the person using the real mouse or keyboard says so before automation relies on it. */
export const LOCAL_INPUT_LIMIT =
  'Ramu cannot tell when you use this computer’s mouse or keyboard. Take control before using it yourself.'

export const showsLocalInputLimit = (session: ComputerSessionSummary): boolean =>
  session.target.kind === 'display' && session.detectsLocalInput === false

/** Where a tap or click lands on a frame drawn with `contain` inside a box: letterbox bars are outside the frame. */
export function frameOffset(
  touch: { x: number; y: number },
  box: { width: number; height: number },
  frame: { width: number; height: number },
): { x: number; y: number } | null {
  if (!(box.width > 0 && box.height > 0 && frame.width > 0 && frame.height > 0)) return null
  const fit = Math.min(box.width / frame.width, box.height / frame.height)
  const shown = { width: frame.width * fit, height: frame.height * fit }
  const left = (box.width - shown.width) / 2
  const top = (box.height - shown.height) / 2
  const x = touch.x - left
  const y = touch.y - top
  if (x < 0 || y < 0 || x > shown.width || y > shown.height) return null
  return {
    x: Math.min(frame.width - 1, Math.max(0, Math.round((x / shown.width) * frame.width))),
    y: Math.min(frame.height - 1, Math.max(0, Math.round((y / shown.height) * frame.height))),
  }
}

export type ComputerOs = 'macos' | 'linux' | 'windows'

/** Keys every computer runtime presses by name; printable characters are typed instead. */
const NAMED_KEYS = new Set([
  'Enter',
  'Tab',
  'Backspace',
  'Delete',
  'Escape',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
])

/**
 * One keystroke from the viewer's own keyboard, as the action for the remote computer. Command on a Mac and Control
 * elsewhere are the same shortcut, so they swap when the viewer and the computer differ. Returns null for keys the
 * computer cannot press (lone modifiers, dead keys, input-method composition).
 */
export function computerKeyAction(
  event: { key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean },
  os: { viewer?: ComputerOs; target?: ComputerOs } = {},
): ComputerAction | null {
  const { key } = event
  if (!key || ['Shift', 'Control', 'Alt', 'Meta', 'Dead', 'Process', 'Unidentified', 'CapsLock'].includes(key))
    return null
  let { ctrlKey: control, metaKey: meta } = event
  const viewerMac = os.viewer === 'macos'
  const targetMac = os.target === 'macos'
  if (os.viewer && os.target && viewerMac !== targetMac) [control, meta] = [meta, control]
  const modifiers: ComputerModifier[] = [
    ...(control ? (['Control'] as const) : []),
    ...(event.altKey ? (['Alt'] as const) : []),
    ...(meta ? (['Meta'] as const) : []),
  ]
  const chord = modifiers.length > 0
  const withShift = (): ComputerModifier[] => (event.shiftKey ? [...modifiers, 'Shift'] : modifiers)
  if (NAMED_KEYS.has(key)) return { kind: 'key', key, ...(withShift().length ? { modifiers: withShift() } : {}) }
  if (key === ' ') return chord ? { kind: 'key', key: 'Space', modifiers: withShift() } : { kind: 'type', text: ' ' }
  if ([...key].length !== 1) return null
  if (!chord) return { kind: 'type', text: key }
  const letter = key.toLowerCase()
  return /^[a-z0-9]$/.test(letter) ? { kind: 'key', key: letter, modifiers: withShift() } : null
}

export type ComputerShortcut = { id: string; label: string; action: ComputerAction }

/** Keys a phone keyboard lacks, then the everyday shortcuts with the computer's own command key. */
export function computerShortcuts(os: ComputerOs | undefined): {
  keys: ComputerShortcut[]
  shortcuts: ComputerShortcut[]
} {
  const command: ComputerModifier = os === 'macos' ? 'Meta' : 'Control'
  const key = (id: string, label: string, name: string, modifiers?: ComputerModifier[]): ComputerShortcut => ({
    id,
    label,
    action: { kind: 'key', key: name, ...(modifiers ? { modifiers } : {}) },
  })
  return {
    keys: [
      key('escape', 'Esc', 'Escape'),
      key('tab', 'Tab', 'Tab'),
      key('enter', 'Enter', 'Enter'),
      key('backspace', 'Backspace', 'Backspace'),
      key('delete', 'Delete', 'Delete'),
      key('up', '↑', 'ArrowUp'),
      key('down', '↓', 'ArrowDown'),
      key('left', '←', 'ArrowLeft'),
      key('right', '→', 'ArrowRight'),
      key('home', 'Home', 'Home'),
      key('end', 'End', 'End'),
      key('pageUp', 'Page up', 'PageUp'),
      key('pageDown', 'Page down', 'PageDown'),
    ],
    shortcuts: [
      key('copy', 'Copy', 'c', [command]),
      key('paste', 'Paste', 'v', [command]),
      key('cut', 'Cut', 'x', [command]),
      key('undo', 'Undo', 'z', [command]),
      os === 'macos' ? key('redo', 'Redo', 'z', ['Meta', 'Shift']) : key('redo', 'Redo', 'y', ['Control']),
      key('selectAll', 'Select all', 'a', [command]),
      key('find', 'Find', 'f', [command]),
      key('switchApp', 'Switch app', 'Tab', [os === 'macos' ? 'Meta' : 'Alt']),
      key('closeWindow', 'Close window', 'w', [command]),
    ],
  }
}
