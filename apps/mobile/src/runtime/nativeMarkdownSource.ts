import { chatReferences } from '@ramu/shared/chat/chatReferences'

export const FILE_SCHEME = 'ramu-file:'
export const SKILL_SCHEME = 'ramu-skill:'

/**
 * Explicit references (`@file`, `$skill`) become links, so the native view draws and opens them; fenced and inline code
 * are left alone, as chatReferences skips them. Workspace images need the host to fetch them, which this view cannot.
 */
export function nativeMarkdownSource(text: string): string | null {
  if (/!\[[^\]]*\]\((?!https?:|data:image\/)/i.test(text)) return null
  return chatReferences(text)
    .map((part) =>
      part.kind === 'text'
        ? part.text
        : part.kind === 'skill'
          ? `[${part.text}](${SKILL_SCHEME}${encodeURIComponent(part.target)})`
          : `[${part.text}](${FILE_SCHEME}${encodeURIComponent(part.target)})`,
    )
    .join('')
}
