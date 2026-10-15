import { clipText } from '@ramu/shared/text'

/** About a line of text around the first match, on one line, with ellipses where it was cut. */
export function excerpt(text: string, needle: string): string {
  // Markdown markers (emphasis, code ticks, headings, list bullets) read as noise in a one-line excerpt.
  const plain = text
    .replace(/`+/g, '')
    .replace(/\*\*|__/g, '')
    .replace(/^\s*(#{1,6}|[-*+]|\d+\.)\s+/gm, '')
  const flat = plain.replace(/\s+/g, ' ').trim()
  const at = Math.max(0, flat.toLowerCase().indexOf(needle))
  const start = Math.max(0, at - 48),
    end = Math.min(flat.length, at + needle.length + 96)
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`
}

/** Cuts long prompt context, marking the cut so the model knows it saw part of it. */
export const limitSection = (value: string, max: number) =>
  value.length <= max ? value : `${value.slice(0, max)}\n\n[truncated]`

export function truncate(s: string, n = 400): string {
  return s.length > n ? `${clipText(s, n)}…` : s
}

/**
 * Drops a leading line that is only an inline code span, such as a model router's `auto → flash · low` banner.
 * A ``` fence is left alone: that is real content.
 */
export function stripRouterLine(text: string): string {
  const trimmed = text.trim()
  const end = trimmed.indexOf('\n'),
    first = (end < 0 ? trimmed : trimmed.slice(0, end)).trim()
  if (end < 0 || first.startsWith('```') || !/^`[^`\n]+`$/.test(first)) return trimmed
  return trimmed.slice(end + 1).trim()
}

/** One plain line from a model's title reply, or null when there is nothing usable. */
export function cleanTitle(raw: string): string | null {
  const line =
    stripRouterLine(raw)
      .split('\n')
      .map((l) => l.trim())
      .find(Boolean) ?? ''
  const title = line
    .replace(/^(title\s*:\s*)/i, '')
    .replace(/^[#>*\-\s"'`“”‘’]+|["'`“”‘’*\s]+$/g, '')
    .replace(/[.。]+$/, '')
    .replace(/\s+/g, ' ')
  return title ? (title.length > 60 ? `${clipText(title, 59).trimEnd()}…` : title) : null
}

/** Takes a trailing `Branch: name` line off a drafted commit message. */
export function splitBranchLine<T extends { message: string }>(draft: T): T & { branch?: string } {
  const match = /\n?[ \t]*branch:[ \t]*`?([^`\n]+?)`?[ \t]*$/i.exec(draft.message.trimEnd())
  if (!match) return draft
  return { ...draft, message: draft.message.trimEnd().slice(0, match.index).trimEnd(), branch: match[1]!.trim() }
}
