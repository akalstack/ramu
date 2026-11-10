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
    'Make background music for a Motion artifact from a description (mood, tempo, instruments) and a length in seconds, on the media service or Shared MCP tool the person set up for music. The audio is saved as an attachment of this thread; give its attachmentId as the motion file named by music.path. Say the license terms the tool returned.',
  make_sound:
    'Make one short sound effect (a whoosh, a chime, a click) from a description, on the media service or Shared MCP tool the person set up for sound effects. The audio is saved as an attachment; give its attachmentId as the motion file a scene names in sound.path.',
  speak:
    "Record a motion scene's narration in a voice, on the media service or Shared MCP tool the person set up for speech. The audio is saved as an attachment; give its attachmentId as the motion file the scene names in voice.path, and it plays instead of the computer's own voice.",
  make_video:
    'Make a short video clip (3 to 15 seconds, with sound) from a description, on the media service the person saved an API key for (agent_models lists it), billed to their account. aspect: landscape (default) or portrait. The video is saved as an attachment of this thread. If it is refused, carry on without it and say so.',
  make_model:
    "Make a 3D model (a character, a prop, a building) as a GLB file, on the 3D service the person installed a plugin for (agent_models lists it). prompt describes it; image is an attachment id or a file in this thread's folder to turn into a model instead, such as concept art from generate_image. detail: low (for a phone game), medium or high; textured and rigged (a character that will be animated). It takes one to five minutes and spends the account's credits; the first call in a thread asks the person. The model is saved as an attachment of this thread (give its attachmentId as an App file), and in a project also at assets/models/<name>.glb. Rigging, animation and retexturing are the service's own tools. If it is refused, build the shape in code and say so.",
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
