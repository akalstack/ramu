import type { TerminalLinkKind } from '@ramu/shared/workspace/terminalLinks'

/** A link the terminal surface reported as tapped, checked before the screen acts on it; anything else is null. */
export function terminalLinkMessage(value: unknown): { kind: TerminalLinkKind; text: string } | null {
  if (!value || typeof value !== 'object') return null
  const { kind, link, text } = value as { kind?: unknown; link?: unknown; text?: unknown }
  return kind === 'link' &&
    (link === 'url' || link === 'path') &&
    typeof text === 'string' &&
    text.length > 0 &&
    text.length <= 8192
    ? { kind: link, text }
    : null
}
