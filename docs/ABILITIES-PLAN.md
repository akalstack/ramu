# Abilities: what is left

Abilities let a thread's agent ask Ramu for something its provider cannot do (an image, a web search, a very long read), and Ramu runs just that step on a signed-in provider that has it. The ability list, live checks, the `generate_image`, `edit_image`, `web_search` and `read_long` tools, `ramu_agent` `needs`, the transcript row and **Settings → Models → Abilities** are shipped and documented in [Agents](guide/agents.md#abilities), [Providers](guide/providers.md#abilities) and [SECURITY.md](../SECURITY.md#what-ramu-can-do). This plan covers the rest. Delete it when the items below and their acceptance are done.

## The need

- **Choices differ per project.** A client's project may have to stay on one provider, but ability choices are host-wide today.
- **Asking for an ability by name.** A person who wants a teammate for images has to know which model has image generation.
- **Auto is not cost-aware.** It follows the fallback order, not which provider is cheapest for good-enough results.
- **Abilities beyond the providers' own.** An image, speech or search service connected as a Shared MCP server cannot stand in for a provider.

## Delivery

### 1. More abilities

- Tools for `vision`, `video_generation` and `speech` once a provider is verified to offer them, each with its own live check.

### 2. Connection with the other plans

- **[Artifacts](ARTIFACTS-PLAN.md):**
  - Design, Slides and Doc artifacts use `generate_image` for their illustrations and `edit_image` for changes.
  - Motion can use `video_generation` and `speech` where they exist, and renders on the host where they do not.
  - A page's own AI (`ramuContent.ai`) can ask for an image through the same routing, within the page's grant.
- **[Shipping an app](SHIP-AN-APP-PLAN.md):**
  - Section 1's per-call `model` and `agent_models` are the base this builds on.
  - App icons, store screenshots and social images for a new project are `generate_image` calls.
  - "Research the best hosting for this" is a `web_search` call when the thread's provider has no search.
- **Fallback and teammates:** abilities reuse the fallback router and the accounts list, so usage limits, switch-back and "never move to another subscription on its own" apply unchanged.

### 3. Cost-aware Auto

- **Measure first:** for each ability, Ramu keeps a small set of fixed sample tasks (for example, five image prompts and five long-context questions with known answers). It runs them on each signed-in provider that has the ability when that provider is first checked and after each update, and stores a quality score with the result. The score comes from a reviewer model's rubric for images and from exact checks where answers are known.
- **Then choose:** with **Auto**, Ramu picks the cheapest provider whose score is within a margin of the best, using Activity's per-provider usage for the cost. Subscriptions count as cheaper than API keys while they have room.
- **Shown to the person:** the Abilities settings show each provider's score and typical cost per call, and the transcript row says "chosen as the cheapest good enough".

### 4. Abilities from Shared MCP servers

Image generation and web search can be mapped to an approved Shared MCP tool (see [Abilities](guide/agents.md#abilities)). Remaining:

- An MCP-provided ability is listed beside providers in Auto, with the same live check and quality score before it is used automatically.
- Speech, image editing and long reads on an MCP tool, once a way to pass files and audio to a generic tool is settled.

### 5. Music and sound effects

- `music` and `sound_effect` abilities, offered where a provider or a mapped MCP server provides them, for Motion artifacts' background music and cues. Each comes with the license terms its provider states, shown on the row and kept with the artifact.
- The host mixes them into the MP4 with the voice-over, and **Sound** in the Motion toolbar adjusts levels or removes a track.

## Acceptance

- **Cost-aware Auto:** with two providers that can make images, Auto picks the cheaper one whose score is within the margin, and the row says why.
- **Music:** a Motion explainer gets background music from a provider that offers it, and the exported MP4 has it mixed under the narration.
- Checks that need live providers are listed under [Acceptance](roadmap.md#acceptance) until run.
