# Abilities: what is left

Abilities let a thread's agent ask Ramu for something its provider cannot do (an image, a web search, a very long read), and Ramu runs just that step on a signed-in provider that has it. The ability list, live checks, the `generate_image`, `edit_image`, `web_search` and `read_long` tools, `ramu_agent` `needs`, the transcript row and **Settings → Models → Abilities** are shipped and documented in [Agents](guide/agents.md#abilities), [Providers](guide/providers.md#abilities) and [SECURITY.md](../SECURITY.md#what-ramu-can-do). This plan covers the rest. Delete it when the items below and their acceptance are done.

## The need

- **Abilities beyond the providers' own.** A speech service, or one that edits images or reads long files, connected as a Shared MCP server cannot stand in for a provider yet.

## Delivery

### 1. More abilities

`read_image` (vision) is built on Codex and Claude, with a live check on a picture of one color ([Abilities](guide/agents.md#abilities)). Remaining:

- Tools for `video_generation` and `speech` once a provider is verified to offer them, each with its own live check.

### 2. Connection with the other plans

A page's own AI asks for an image through the same routing (`ramuContent.ai.image`, within its AI grant), and `project_create` points the agent to `generate_image` for icons, store screenshots and social images and to `web_search` for comparing hosting. Remaining:

- **[Artifacts](ARTIFACTS-PLAN.md):** Motion narration is spoken on the host today; it uses `speech` (and scenes `video_generation`) where a provider offers them (waiting on §1).

### 3. Abilities from Shared MCP servers

Image generation, image editing, web search and long reads can be mapped to an approved Shared MCP tool (images as data URLs in its image field, a long read's files in its prompt), and image generation and search offered to Auto after the providers once their check passes (see [Abilities](guide/agents.md#abilities)). Remaining:

- **Speech on an MCP tool,** with the `speech` ability of §1: audio a tool returns as MCP `audio` content, kept with the Motion artifact.

### 4. Music and sound effects

`make_music` and `make_sound` on a mapped Shared MCP tool (its audio kept as an attachment, its license words on the row), a motion's music and scene sounds mixed into the MP4 and WebM under the narration, and **Sound** in the Motion toolbar are built ([Abilities](guide/agents.md#abilities), [Kinds](guide/artifacts.md#kinds)). Remaining:

- **From a provider:** `music` and `sound_effect` on a signed-in provider that offers them, with a live check, once one does.

## Acceptance

- **Cost-aware Auto:** with two signed-in providers that can search, one on an API key, Auto picks the subscription, and the row says why; with two that make images, it picks the cheaper one whose sample images scored within the margin.
- **Music:** a Motion explainer gets background music from a provider that offers it, and the exported MP4 has it mixed under the narration.
- Checks that need live providers are listed under [Acceptance](roadmap.md#acceptance) until run.
