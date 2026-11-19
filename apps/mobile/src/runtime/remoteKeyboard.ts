import type { BrowserFieldFocus } from '@ramu/shared/browserBridge'

/** Kept at the start of the hidden field so deleting it reports Backspace even when nothing else was typed. */
export const KEYBOARD_SENTINEL = '\u200b'

export type RemoteKey = { kind: 'text'; text: string } | { kind: 'key'; key: 'Backspace' | 'Enter' }

/**
 * What the phone keyboard did to its hidden field, as keystrokes for the remote screen. Autocorrect and other
 * replacements become backspaces followed by the new text; a new line becomes Enter.
 */
export function remoteKeys(previous: string, next: string): RemoteKey[] {
  const before = [...previous]
  const after = [...next]
  let same = 0
  while (same < before.length && same < after.length && before[same] === after[same]) same++
  const keys: RemoteKey[] = []
  for (let index = same; index < before.length; index++) keys.push({ kind: 'key', key: 'Backspace' })
  after
    .slice(same)
    .join('')
    .split(/\r?\n/)
    .forEach((line, index) => {
      if (index > 0) keys.push({ kind: 'key', key: 'Enter' })
      if (line) keys.push({ kind: 'text', text: line })
    })
  return keys
}

export type KeyboardProps = {
  keyboardType: 'default' | 'email-address' | 'numbers-and-punctuation' | 'phone-pad' | 'url' | 'web-search'
  secureTextEntry: boolean
  multiline: boolean
  returnKeyType: 'default' | 'go' | 'search' | 'next'
  autoCapitalize: 'none' | 'sentences'
}

/** The phone keyboard that matches the focused field: email, number, phone, web address, password or free text. */
export function keyboardFor(kind: BrowserFieldFocus['kind']): KeyboardProps {
  const base: KeyboardProps = {
    keyboardType: 'default',
    secureTextEntry: false,
    multiline: false,
    returnKeyType: 'default',
    autoCapitalize: 'none',
  }
  if (kind === 'password') return { ...base, secureTextEntry: true, returnKeyType: 'go' }
  if (kind === 'email') return { ...base, keyboardType: 'email-address' }
  if (kind === 'number') return { ...base, keyboardType: 'numbers-and-punctuation' }
  if (kind === 'tel') return { ...base, keyboardType: 'phone-pad' }
  if (kind === 'url') return { ...base, keyboardType: 'url', returnKeyType: 'go' }
  if (kind === 'search') return { ...base, keyboardType: 'web-search', returnKeyType: 'search' }
  if (kind === 'multiline') return { ...base, multiline: true, returnKeyType: 'default', autoCapitalize: 'sentences' }
  return base
}
