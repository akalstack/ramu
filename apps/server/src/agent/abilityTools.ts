import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { ABILITY_TOOLS, type AbilityTool } from '@ramu/shared/providers/abilities'
import type { AgentSessionInfo } from '@ramu/shared/types'
import { abilityInputs, type AbilityService } from './abilities'

const DESCRIPTIONS: Record<AbilityTool, string> = {
  generate_image:
    'Make one to four images from a description, on whichever of the person\'s signed-in providers can (agent_models lists abilities). Only the description is sent; the images are saved as attachments of this thread and their paths come back. size: square, landscape or portrait; style: a few words such as "flat illustration". Use it instead of drawing a placeholder. If it is refused, carry on without the image and say so.',
  edit_image:
    "Change an image (remove the background, recolor, extend) on a signed-in provider that can. images: files in this thread's folder or attachment ids from this thread. Only the description and those images are sent; the result is saved as an attachment of this thread.",
  web_search:
    "Search the web and get an answer with cited sources, on a signed-in provider with web search, or Ramu's own search when none has it. Only the query is sent.",
  read_image:
    "Answer a question about one to four images on a signed-in model that can see them, when yours cannot: what a screenshot shows, the text in a photo, whether a chart has a label. images: files in this thread's folder or attachment ids from this thread. Only the question and those images are sent.",
  make_music:
    'Make background music for a Motion artifact from a description (mood, tempo, instruments) and a length in seconds, on the Shared MCP tool the person mapped to music. The audio is saved as an attachment of this thread; give its attachmentId as the motion file named by music.path. Say the license terms the tool returned.',
  make_sound:
    'Make one short sound effect (a whoosh, a chime, a click) from a description, on the Shared MCP tool the person mapped to sound effects. The audio is saved as an attachment; give its attachmentId as the motion file a scene names in sound.path.',
  read_long:
    "Answer one question about a large set of files or a long text on the signed-in model with the largest context window. files: paths in this thread's folder (up to about 1.2 million characters together); text: pasted text. Only the question and those inputs are sent.",
}

/**
 * Ramu's ability tools, offered to every provider's threads. A tool is left out when the thread's own provider has the
 * ability natively, so its agent uses its own tool directly.
 */
export function registerAbilityTools(server: McpServer, abilities: AbilityService, source: AgentSessionInfo) {
  for (const tool of Object.keys(ABILITY_TOOLS) as AbilityTool[]) {
    if (abilities.native(source.provider, ABILITY_TOOLS[tool])) continue
    server.registerTool(
      tool,
      { description: DESCRIPTIONS[tool], inputSchema: abilityInputs[tool] },
      async (args: Record<string, unknown>, extra: { signal: AbortSignal }) => {
        const answer = await abilities.call(source.id, tool, args, extra.signal)
        return {
          ...(answer.status === 'done' ? {} : { isError: true }),
          content: [{ type: 'text' as const, text: JSON.stringify(answer) }],
        }
      },
    )
  }
}
