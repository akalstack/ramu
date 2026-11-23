// Copy and paste keys in a terminal. On a Mac ⌘C and ⌘V never reach the shell, so the Edit menu handles them. On
// Windows and Linux Ctrl+C is the shell's interrupt, so it copies only while text is selected, as Windows Terminal does;
// Ctrl+Shift+C and Ctrl+Shift+V always copy and paste, and on Windows Ctrl+V pastes too.

export type TerminalPlatform = 'mac' | 'windows' | 'linux'

interface Key {
  type: string
  key: string
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
}

export const terminalPlatform = (userAgent: string): TerminalPlatform =>
  /Mac/.test(userAgent) ? 'mac' : /Windows/.test(userAgent) ? 'windows' : 'linux'

export function terminalClipboardKey(
  event: Key,
  platform: TerminalPlatform,
  selected: boolean,
): 'copy' | 'paste' | null {
  if (platform === 'mac' || event.type !== 'keydown' || !event.ctrlKey || event.altKey || event.metaKey) return null
  const key = event.key.toLowerCase()
  if (key === 'c' && (event.shiftKey || selected)) return 'copy'
  if (key === 'v' && (event.shiftKey || platform === 'windows')) return 'paste'
  return null
}
