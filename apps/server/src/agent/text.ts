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

export interface TitleDraft {
  title: string
  needsRefinement: boolean
}

/** Structured output is optional, but malformed structured output is never displayed as a title. */
export function parseTitleDraft(raw: string): TitleDraft | null {
  const text = stripRouterLine(raw)
    .trim()
    .replace(/^```(?:json)?\s*\n/, '')
    .replace(/\n```$/, '')
  let value: unknown = text
  if (/^[{["\]]/.test(text)) {
    try {
      value = JSON.parse(text)
    } catch {
      if (!text.startsWith('"')) return null
    }
  }
  let needsRefinement = false
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const draft = value as Record<string, unknown>
    if (draft.needsRefinement !== undefined && typeof draft.needsRefinement !== 'boolean') return null
    needsRefinement = draft.needsRefinement === true
    value = draft.title
  }
  if (typeof value !== 'string' || value.length > 2000) return null
  if (
    [...value].some((character) => {
      const code = character.codePointAt(0)!
      return (code < 32 && ![9, 10, 13].includes(code)) || code === 127
    })
  )
    return null
  const title = cleanTitle(value)
  if (!title || /^(?:new (?:thread|chat)|untitled(?: thread| chat)?|chat title)$/i.test(title)) return null
  return { title, needsRefinement }
}

/** Takes a trailing `Branch: name` line off a drafted commit message. */
export function splitBranchLine<T extends { message: string }>(draft: T): T & { branch?: string } {
  const match = /\n?[ \t]*branch:[ \t]*`?([^`\n]+?)`?[ \t]*$/i.exec(draft.message.trimEnd())
  if (!match) return draft
  return { ...draft, message: draft.message.trimEnd().slice(0, match.index).trimEnd(), branch: match[1]!.trim() }
}
