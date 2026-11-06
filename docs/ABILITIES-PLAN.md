# Abilities: the right provider for each part of a task

A thread runs on one provider, but the task often needs something that provider cannot do. Claude cannot generate images; Codex can. One provider can search the web natively and another cannot; one reads a 1M-token context and another does not. Today the person notices, starts another thread on the other provider, copies the result back and returns. This plan lets the thread's agent ask Ramu for an **ability** ("generate an image") and has Ramu run just that step on a signed-in provider that has it, then hand the result back, while the thread keeps its own model. It extends helpers and teammates rather than adding a third kind of agent. Document shipped behavior in [Agents](guide/agents.md) and delete this plan when implementation and acceptance are finished.

## The need

- **Missing abilities stop the work.** "Make the hero image for the landing page" on a Claude thread ends with the agent saying it cannot make images, or writing an SVG placeholder.
- **The person routes by hand.** They know Codex can do it, so they open a thread there, ask, download the file and attach it back: four steps and a context switch for one image.
- **Helpers do not know what other providers can do.** `ramu_agent` picks a helper's model from **Sub-agents → Routing**. Nothing says "this part needs image generation, so run it where image generation exists".
- **Nobody can tell what a provider can do.** Abilities differ by provider, model, login type and installed version. Neither the agent nor the person has one place to look.

**Easier for the person:** they ask for the whole task on their usual model. The image, the web lookup or the long-document read happens on whichever of their signed-in providers can do it. The thread shows one row, "Image made with Codex", with the result in place, and nothing has to be switched, copied or attached.

## Decision

**Abilities are a host fact, and calling one is a Ramu tool.**

- **The fact:** each provider adapter declares the abilities it can provide, per model where they differ, next to the `NativeFeatures` it already declares. An ability is offered only after a live check on that host's installed version, the same rule as provider titles and terminals.
- **The tool:** the thread's agent calls one of Ramu's ability tools, such as `generate_image`. Ramu runs that single step as a narrow, tool-limited run on a provider that has the ability, and returns the result (a file, an attachment, text) to the caller. This works the same whatever provider the thread is on, because Ramu's tools are offered to all of them.
- **Abilities are not teammates.** A teammate is another model that talks in the thread. An ability is one bounded call, with no conversation and nothing else in the other provider's context.
- **Helpers choose by ability.** `ramu_agent` gains `needs` (a list of abilities) beside the shipping plan's per-call `model`, so a helper whose whole job needs an ability starts on a provider that has it. For example: "make the six store screenshots" with `needs: ['image_generation']`.
- **The person's own logins only.** An ability runs on a provider and login the person has already signed in and turned on, within its plan and its terms, like every other call Ramu makes. Ramu never adds a key, a service or a reseller.

## Abilities

Each is offered only where a provider is verified to provide it on the installed version. The table is the starting set, not a promise of support.

| Ability | What the tool does | Typical providers (verified per host) |
| --- | --- | --- |
| `image_generation` | Make one or more images from a prompt, with size and style | Codex's built-in image tool; others when verified |
| `image_edit` | Change an image the caller passes (remove background, recolor, extend) | Codex; others when verified |
| `web_search` | Search the web and return cited results | Providers with a native search tool; Ramu's keyless search as the fallback (built for page runs) |
| `long_context` | Read a large set of files or a long document and answer one question | The signed-in model with the largest context window |
| `vision` | Read an image or screenshot and answer | Most models; listed so a text-only model can still be helped |
| `video_generation` | Make a short clip from a prompt or storyboard | When a provider offers it; Motion artifacts can render on the host instead |
| `speech` | Turn text into narration audio | When a provider offers it |

The list is data in `packages/shared`, so the phone and desktop show the same thing. A new ability is one entry plus the adapters that provide it.

## The person's path

1. **Asking.** On a Claude thread: "Design the landing page and make a hero image of a calm workspace." Claude writes the page and calls `generate_image`.
2. **Ramu routes it.** Ramu checks **Settings → Models → Abilities**: image generation is on **Auto**, and Codex is the signed-in provider with it. Ramu runs the step there with only the prompt and any images the caller passed, saves the result as an attachment of the thread, and returns its path and a short description to Claude, which places it in the page.
3. **The thread shows it.** One row: "Image made with Codex · gpt-image" with a thumbnail, the prompt, the time and the usage it cost. **Open**, **Make another**, and **Use another provider** are on the row.
4. **When nothing has it.** The tool answers that no signed-in provider can make images, and the row offers **Set up a provider** (Settings → Providers) and **Not now**. The agent continues without it and says so in its reply, rather than inventing a placeholder silently.
5. **Choosing.** In **Settings → Models → Abilities**, each ability has **Auto** (the best signed-in provider for it, following the usual fallback order), a fixed provider and model, or **Off**. A project can override this, for example to keep a client's project to one provider. **Ask before using another provider** is a switch (off by default) that turns each routed call into an approval card naming the provider and what will be sent.

## Delivery

### 1. Abilities on the host

- `NativeFeatures` gains `abilities` (per model where needed): which abilities a provider's runtime offers and how it is invoked (a native tool name, a request option, or a model that has it).
- **Live checks:** a check per ability runs one small request (for example, generate a 64×64 image) when a provider is signed in or updated. The result is kept with the provider's compatibility record, and only checked abilities are offered.
- **`agent_abilities`:** the shipping plan's `agent_models` tool gains an `abilities` field, so an agent can see what the host can do before it plans the task, for example "images available via Codex; video not available".

### 2. Ability tools

- `generate_image`, `edit_image`, `web_search`, `read_long` (long context) and later the rest, registered with Ramu's other tools for every provider. They are hidden from a thread whose own provider already has the ability natively, so a Codex thread uses its own image tool directly.
- **Each call is a tool-limited run** on the chosen provider and login, with no files, shell, Git or MCP:
  - **Input:** only the caller's prompt and the inputs it passed.
  - **Output:** a file saved as a thread attachment, plus a text summary.
  - **Bounds:** size, count and time limits per ability.
- **Fallback:** a call follows the person's usual fallback order at usage limits, and is refused with a clear message when every provider with the ability is limited or signed out.
- Each call is recorded in **Activity** and in the thread's usage under the provider that ran it.

### 3. Helpers that need an ability

- `ramu_agent` takes `needs: Ability[]`. Ramu picks the helper's provider from those that have every listed ability (by Abilities settings, then Routing), or refuses with what is missing.
- A teammate added with `@` can name an ability instead of a model ("@images"). Ramu picks the provider, and the teammate's chip shows which one it is.
- Helpers keep the existing rule that they never get broader access than their parent.

### 4. Desktop and phone

- The ability row in the transcript, on both clients: icon, provider, result preview, and **Open**, **Make another** and **Use another provider**. The phone shows the image or audio natively.
- **Settings → Models → Abilities** on the desktop. The phone shows it read-only, like other host settings, with changes allowed under the **Change settings** permission.
- **Ask before using another provider** approval cards use the existing approval UI on both.

### 5. Connection with the other plans

- **[Artifacts](ARTIFACTS-PLAN.md):**
  - Design, Slides and Doc artifacts use `generate_image` for their illustrations and `edit_image` for changes.
  - Motion can use `video_generation` and `speech` where they exist, and renders on the host where they do not.
  - A page's own AI (`ramuContent.ai`) can ask for an image through the same routing, within the page's grant.
- **[Shipping an app](SHIP-AN-APP-PLAN.md):**
  - Section 1's per-call `model` and `agent_models` are the base this builds on.
  - App icons, store screenshots and social images for a new project are `generate_image` calls.
  - "Research the best hosting for this" is a `web_search` call when the thread's provider has no search.
- **Fallback and teammates:** abilities reuse the fallback router and the accounts list, so usage limits, switch-back and "never move to another subscription on its own" apply unchanged.

### 6. Documentation

- [Agents](guide/agents.md) gets **Abilities**: what they are, Auto, per-project overrides, Ask before using another provider, and how `needs` picks a helper. [Providers](guide/providers.md) lists which abilities each provider was verified to offer and where the check result shows. [SECURITY.md](../SECURITY.md) says what an ability call sends to the other provider. The mobile README is updated too.
- Every string goes through `t()` with its Indonesian translation.

## Safety

- An ability call sends the other provider only the caller's prompt and the inputs it passed. It never sends the conversation, files, memory or credentials, and the row shows exactly what was sent.
- It runs on the person's own signed-in logins within their plans. A project or the person can turn any ability Off, or require approval for every routed call.
- Generated files are ordinary thread attachments. Nothing is published or shared unless the person or the agent does so through the usual, approved paths.

## Acceptance

- **Image on a Claude thread:** "make a hero image of a calm workspace for this page" produces an image through Codex. The row says so, and the page uses it, with no thread switch.
- **No provider:** with Codex signed out, the same request answers that no provider can make images, offers **Set up a provider**, and the agent finishes the rest of the task.
- **Helper by need:** "make 6 store screenshots" started as a helper with `needs: ['image_generation']` runs on Codex while the lead stays on Claude.
- **Search fallback:** a thread on a provider without native search gets cited results from `web_search`.
- **Settings respected:** with image generation set to Off for a project, the tool is refused there and offered elsewhere. With **Ask before using another provider** on, each call waits for approval.
- Checks that need live providers are listed under [Acceptance](roadmap.md#acceptance) until run.

## Later options

- **Cost-aware Auto:** prefer the cheapest provider that can do an ability well enough, using Activity's per-provider usage. It needs measured quality per ability first.
- **Abilities from Shared MCP servers:** an MCP server the person connected (an image or speech service) could provide an ability like a provider does, with its own grant.
- **Music and sound effects**, for Motion artifacts.
