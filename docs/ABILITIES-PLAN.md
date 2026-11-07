# Abilities: what is left

Abilities let a thread's agent ask Ramu for something its provider cannot do (an image, a web search, a very long read), and Ramu runs just that step on a signed-in provider that has it. The ability list, live checks, the `generate_image`, `edit_image`, `web_search` and `read_long` tools, `ramu_agent` `needs`, the transcript row and **Settings → Models → Abilities** are shipped and documented in [Agents](guide/agents.md#abilities), [Providers](guide/providers.md#abilities) and [SECURITY.md](../SECURITY.md#what-ramu-can-do). This plan covers the rest. Delete it when the items below and their acceptance are done.

## The need

- **Abilities beyond the providers' own.** A speech service, or one that edits images or reads long files, connected as a Shared MCP server cannot stand in for a provider yet.

## Delivery

### 1. More abilities

- Tools for `vision`, `video_generation` and `speech` once a provider is verified to offer them, each with its own live check.

### 2. Connection with the other plans

- **[Artifacts](ARTIFACTS-PLAN.md):**
  - Motion can use `video_generation` and `speech` where they exist, and renders on the host where they do not.
  - A page's own AI (`ramuContent.ai`) can ask for an image through the same routing, within the page's grant.
- **[Shipping an app](SHIP-AN-APP-PLAN.md):**
  - Section 1's per-call `model` and `agent_models` are the base this builds on.
  - App icons, store screenshots and social images for a new project are `generate_image` calls.
  - "Research the best hosting for this" is a `web_search` call when the thread's provider has no search.
- **Fallback and teammates:** abilities reuse the fallback router and the accounts list, so usage limits, switch-back and "never move to another subscription on its own" apply unchanged.

### 3. Abilities from Shared MCP servers

Image generation and web search can be mapped to an approved Shared MCP tool, or offered to Auto after the providers once its check passes (see [Abilities](guide/agents.md#abilities)). Remaining:

- Speech, image editing and long reads on an MCP tool, once a way to pass files and audio to a generic tool is settled.

### 4. Music and sound effects

- `music` and `sound_effect` abilities, offered where a provider or a mapped MCP server provides them, for Motion artifacts' background music and cues. Each comes with the license terms its provider states, shown on the row and kept with the artifact.
- The host mixes them into the MP4 with the voice-over, and **Sound** in the Motion toolbar adjusts levels or removes a track.

## Acceptance

- **Cost-aware Auto:** with two signed-in providers that can search, one on an API key, Auto picks the subscription, and the row says why; with two that make images, it picks the cheaper one whose sample images scored within the margin.
- **Music:** a Motion explainer gets background music from a provider that offers it, and the exported MP4 has it mixed under the narration.
- Checks that need live providers are listed under [Acceptance](roadmap.md#acceptance) until run.
