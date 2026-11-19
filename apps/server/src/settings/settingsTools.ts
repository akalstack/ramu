import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { SettingsChanges } from './settingsChanges'

const GUIDE =
  'Ramu’s own settings, only when the person asks to change how Ramu behaves. Find the row with settings_find, then change it with settings_change; never edit Ramu’s settings files. In Full access a change applies at once and its card offers Undo; in every other mode the card waits for the person to press Apply: say it is waiting, never claim it was done. A row marked change: "yourself" (permissions, the access mode, remote access, pairing, accounts, credentials, environment variables, computer and test device access) cannot be changed by you: tell the person its page and row instead.'

/** The settings tools of one thread; the authenticated MCP connection supplies the session. */
export function registerSettingsTools(server: McpServer, sessionId: string, changes: SettingsChanges) {
  const result = async (work: () => unknown) => {
    try {
      return { content: [{ type: 'text' as const, text: JSON.stringify(await work()) }] }
    } catch (error) {
      return {
        isError: true,
        content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
      }
    }
  }
  server.registerTool(
    'settings_find',
    {
      description: `Finds Ramu settings by words ("simulator model", "commit message", "notifications"), as Settings search does. Each result has its title, page, help, current value, allowed values (a JSON schema), its path, and whether you may change it. ${GUIDE}`,
      inputSchema: { query: z.string().trim().min(1).max(200) },
    },
    ({ query }) =>
      result(async () => {
        const settings = await changes.find(query)
        return settings.length
          ? { settings }
          : { settings, note: 'Nothing matched. Try fewer or other words, such as the page name.' }
      }),
  )
  server.registerTool(
    'settings_change',
    {
      description: `Changes one or more Ramu settings in one card. Give each setting's path from settings_find and its new value, matching the allowed values, and a one-line reason the person reads on the card. ${GUIDE}`,
      inputSchema: {
        changes: z
          .array(z.object({ path: z.string().trim().min(1).max(200), value: z.unknown() }))
          .min(1)
          .max(20),
        reason: z.string().trim().min(1).max(200),
      },
    },
    ({ changes: requested, reason }) =>
      result(async () => {
        const outcome = await changes.request(sessionId, requested, reason)
        return {
          ...outcome,
          meaning:
            outcome.state === 'unchanged'
              ? 'Every setting already had that value. Nothing changed.'
              : outcome.state === 'applied'
                ? 'Applied. The card offers Undo.'
                : outcome.error
                  ? 'Not applied; the error is in the card too.'
                  : 'Waiting in the card for the person to press Apply. Nothing changed yet.',
        }
      }),
  )
}
