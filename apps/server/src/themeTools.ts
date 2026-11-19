import { randomUUID } from 'node:crypto'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { DEFAULT_THEME, THEME_ROLES, type RamuTheme } from '@ramu/shared/theme'
import { NO_LOCKED_ROLES, ROLE_MEANING, readGeneratedTheme } from '@ramu/shared/themeGeneration'

const variant = (overlay: 'black' | 'white') =>
  z.object({
    overlay: z.literal(overlay),
    colors: z.record(z.string().max(40), z.string().max(16)),
  })

const GUIDE = `Draft a color theme for Ramu when the person asks for one in this conversation. It appears as a card with a Preview theme button; the person previews, edits and keeps it themselves, and you cannot apply it. Give a name and both appearances (light uses overlay "black", dark uses "white"). Every color is a lowercase #rrggbb value, and every role is required:
${THEME_ROLES.map((role) => `- ${role}: ${ROLE_MEANING[role]}`).join('\n')}
Readability is checked: text on canvas at least 7:1; body, secondary, muted text and accent on canvas at least 4.5:1; text on primary at least 4.5:1; placeholder, success, warning and error on canvas at least 3:1. Success, warning and error must stay recognisably green, amber and red and differ from each other. If the result lists failures, fix only those and call again.`

/**
 * Lets an agent offer a theme draft in a thread. The draft is validated like any other, then recorded as a card; this
 * tool cannot apply or save a theme, so the person's appearance only changes through their own Preview and Keep.
 */
export function registerThemeTools(server: McpServer, propose: (theme: RamuTheme) => void) {
  server.registerTool(
    'propose_theme',
    {
      description: GUIDE,
      inputSchema: { name: z.string().min(1).max(80), light: variant('black'), dark: variant('white') },
    },
    ({ name, light, dark }) => {
      const read = readGeneratedTheme(
        JSON.stringify({ name, light, dark }),
        DEFAULT_THEME,
        NO_LOCKED_ROLES,
        `ai-${randomUUID().slice(0, 8)}`,
      )
      const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] })
      if (!read.ok) return { ...text({ ok: false, error: read.error }), isError: true }
      if (read.issues.length)
        return {
          ...text({
            ok: false,
            failures: read.issues.map((issue) => `${issue.variant}.${issue.role}: ${issue.message}`),
          }),
          isError: true,
        }
      propose(read.theme)
      return text({ ok: true, shown: 'The person can preview it from the card; it is not applied.' })
    },
  )
}
