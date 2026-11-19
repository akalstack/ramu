/** Named VT/xterm keys, shared by the compact rail and the expanded keyboard. */
export const terminalKeyGroups = [
  { title: 'Navigation', keys: ['left', 'up', 'down', 'right', 'home', 'end', 'page up', 'page down'] },
  { title: 'Editing', keys: ['esc', 'tab', 'shift tab', 'enter', 'backspace', 'delete', 'insert', '^C', '^D', '^Z'] },
  { title: 'Function keys', keys: Array.from({ length: 12 }, (_, i) => `F${i + 1}`) },
  { title: 'Symbols', keys: ['/', '\\', '|', '~', '-', '_', '$', '&', ';', '=', '<', '>', '{', '}', '[', ']'] },
]
export function terminalKeySequence(label: string, applicationCursorKeys = false): string {
  const arrow: Record<string, string> = { left: 'D', right: 'C', up: 'A', down: 'B', home: 'H', end: 'F' }
  if (Object.hasOwn(arrow, label)) return '\x1b' + (applicationCursorKeys ? 'O' : '[') + arrow[label]
  const codes: Record<string, string> = {
    esc: '\x1b',
    tab: '\t',
    'shift tab': '\x1b[Z',
    enter: '\r',
    backspace: '\x7f',
    delete: '\x1b[3~',
    insert: '\x1b[2~',
    'page up': '\x1b[5~',
    'page down': '\x1b[6~',
    '^C': '\x03',
    '^D': '\x04',
    '^Z': '\x1a',
    F1: '\x1bOP',
    F2: '\x1bOQ',
    F3: '\x1bOR',
    F4: '\x1bOS',
    F5: '\x1b[15~',
    F6: '\x1b[17~',
    F7: '\x1b[18~',
    F8: '\x1b[19~',
    F9: '\x1b[20~',
    F10: '\x1b[21~',
    F11: '\x1b[23~',
    F12: '\x1b[24~',
  }
  return Object.hasOwn(codes, label) ? codes[label]! : label
}

/** The quiet key rail's default keys, in order. `ctrl` and `alt` are latches, not sequences. */
export const DEFAULT_RAIL = [
  'esc',
  'tab',
  'ctrl',
  'alt',
  '/',
  '|',
  '~',
  '-',
  'left',
  'up',
  'down',
  'right',
  '^C',
  '^D',
  '^Z',
]
export const RAIL_LIMIT = 24
const LATCHES = ['ctrl', 'alt']
/** Every key a person may pin: the named keys and symbols plus the two latches. */
export const RAIL_CHOICES: readonly string[] = [...LATCHES, ...terminalKeyGroups.flatMap((group) => group.keys)]
const isChoice = (key: unknown): key is string => typeof key === 'string' && RAIL_CHOICES.includes(key)

/** The saved rail, or the default when nothing valid is stored. Unknown or repeated keys are dropped; the rail never exceeds its limit. */
export function parseRail(stored: string | undefined): string[] {
  if (!stored) return [...DEFAULT_RAIL]
  try {
    const parsed: unknown = JSON.parse(stored)
    if (!Array.isArray(parsed)) return [...DEFAULT_RAIL]
    const keys = [...new Set(parsed.filter(isChoice))].slice(0, RAIL_LIMIT)
    return keys.length ? keys : [...DEFAULT_RAIL]
  } catch {
    return [...DEFAULT_RAIL]
  }
}

/** Pins a key at the end of the rail, or unpins it. The last key cannot be removed and a full rail refuses another. */
export function toggleRailKey(rail: readonly string[], key: string): string[] {
  if (!isChoice(key)) return [...rail]
  if (rail.includes(key)) return rail.length > 1 ? rail.filter((k) => k !== key) : [...rail]
  return rail.length >= RAIL_LIMIT ? [...rail] : [...rail, key]
}

/** Moves a pinned key one place earlier (-1) or later (1). */
export function moveRailKey(rail: readonly string[], key: string, by: -1 | 1): string[] {
  const from = rail.indexOf(key)
  const to = from + by
  if (from < 0 || to < 0 || to >= rail.length) return [...rail]
  const next = [...rail]
  ;[next[from], next[to]] = [next[to]!, next[from]!]
  return next
}
