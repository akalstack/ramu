/**
 * What a person typed to add a host: `user@host` or a name from their SSH config connects over SSH; anything else is a
 * pairing link or an address that needs a code.
 */
export function isSshTarget(text: string, aliases: readonly string[]): boolean {
  const value = text.trim()
  if (!value || /\s/.test(value) || /^[a-z][a-z0-9+.-]*:/i.test(value)) return false
  return /^[^@/:]+@[^@/:]+$/.test(value) || aliases.includes(value)
}
