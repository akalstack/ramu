type Target = { closest?: (selector: string) => unknown } | null

/**
 * Whether the focused element has its own use for a key the app also binds, like ⌘B meaning bold while writing. Rich
 * text and the chat box keep it; on Windows and Linux so does a terminal, where Ctrl+B belongs to the shell or tmux.
 * ⌘B in the code editor stays the side bar, since Monaco has no meaning for it.
 */
export function focusKeepsKey(target: EventTarget | Target, mac: boolean): boolean {
  const element = target as Target
  if (!element?.closest) return false
  return !!element.closest('[contenteditable="true"]') || (!mac && !!element.closest('.xterm'))
}
