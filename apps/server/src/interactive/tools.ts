import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { interactiveInput, type InteractiveStore } from './store'
export const INTERACTIVE_GUIDE = `Create Interactive Content when a working visual/tool helps the user. Use preview_interactive then publish_interactive. Write self-contained HTML/CSS/JS; external network, packages, files, frames and app commands are unavailable. Controls run locally with no model call. Use accessible labels and meaningful outcomes. Include check actions with expected visible text. Preview validates rendering/observed behavior, not factual accuracy. For custom state use window.ramuContent.setState(JSON-compatible data), onRestore(state=>...), and onActive(active=>...) to pause offscreen animation. Standard input/select/textarea values restore automatically. Use --background, --foreground, --primary and --muted CSS tokens. Preserve content id/expected version when revising. Set stateSchema to the same explicit identifier across revisions ONLY when control keys and custom JSON retain the exact same meaning; otherwise use a new identifier or omit it. Users can choose to copy a saved scenario between matching schemas. Do not put document bytes in chat or claim static screenshots are working interactions.`
export function registerInteractiveTools(server: McpServer, store: InteractiveStore, session: string) {
  const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] })
  server.registerTool(
    'preview_interactive',
    { description: INTERACTIVE_GUIDE, inputSchema: interactiveInput.shape },
    async (input, extra) => {
      const preview = await store.preview(session, input, extra.signal)
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify({ ...preview, screenshot: undefined }) },
          { type: 'image' as const, mimeType: 'image/png', data: preview.screenshot.split(',')[1]! },
        ],
      }
    },
  )
  server.registerTool(
    'publish_interactive',
    {
      description:
        'Publish a previewed Interactive Content version in this conversation. Supply a stable requestId for retries; use previous to revise an existing version. Failed/expired previews cannot publish. The saved event appears independently of this tool result.',
      inputSchema: {
        previewId: z.string().uuid(),
        requestId: z.string().min(1).max(160),
        previous: z.object({ id: z.string().uuid(), version: z.number().int().positive() }).optional(),
      },
    },
    ({ previewId, requestId, previous }) => result(store.publish(session, previewId, requestId, previous)),
  )
  server.registerTool(
    'interactive_read',
    {
      description:
        'Read the saved source of an Interactive Content version before revising it. Only this conversation can read it.',
      inputSchema: { id: z.string().uuid(), version: z.number().int().positive() },
    },
    ({ id, version }) => result(store.get(session, id, version)),
  )
  server.registerTool(
    'interactive_list',
    { description: 'List saved Interactive Content versions belonging to this conversation.', inputSchema: {} },
    () => result(store.list(session)),
  )
}
