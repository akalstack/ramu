import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { INLINE_UI_GUIDANCE, INLINE_UI_LIMITS } from '@ramu/shared/chat/inlineUi'
import type { AgentService } from '../agent'

/** Lets an agent show and change inline cards in its thread. Messages are checked whole before any card changes. */
export function registerInlineUiTools(
  server: McpServer,
  agents: Pick<AgentService, 'showInlineUi'>,
  sessionId: string,
) {
  server.registerTool(
    'show_ui',
    {
      description: INLINE_UI_GUIDANCE,
      inputSchema: {
        messages: z
          .array(z.record(z.string(), z.unknown()))
          .min(1)
          .max(INLINE_UI_LIMITS.messages)
          .describe(
            'A2UI v1.0 messages, applied in order: createSurface, updateComponents, updateDataModel, deleteSurface.',
          ),
      },
    },
    ({ messages }) => {
      const result = agents.showInlineUi(sessionId, messages)
      const text = (value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }]
      if (!result.ok) return { isError: true, content: text({ ok: false, error: result.error }) }
      return {
        content: text({
          ok: true,
          shown: result.surfaces.map((surface) => ({
            surfaceId: surface.surfaceId,
            revision: surface.revision,
            ...(surface.deleted ? { deleted: true } : {}),
          })),
        }),
      }
    },
  )
}
