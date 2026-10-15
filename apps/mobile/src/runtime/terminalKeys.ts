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
