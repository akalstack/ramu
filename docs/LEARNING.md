# Learning and context efficiency

Ramu shares durable memories and reusable procedures across providers. Memory stays in the existing local SQLite store; generated procedures are managed separately from installed skills.

## Response styles

Choose a global style in **Settings → Chats → Response style**, or override it from a chat's composer: Default, Concise, Detailed, ADHD-friendly, Caveman, or Custom. Custom accepts presentation instructions and an optional installed skill name, resolved in the chat's scope. A missing skill is skipped; custom text still applies.

ADHD-friendly leads with the action or answer, keeps steps short, and avoids tangents. Caveman uses telegraphic prose. Exact code, commands, paths, structured output, material failures, and uncertainty must remain intact. Explicit user requests take precedence. Styles guide generation rather than shortening the answer after tokens have already been spent. Changes take effect on the next turn.

## Automatic learning

**Settings → Memory → Learning & skills** offers Off, Review first (default), and Automatic. Save changes before running maintenance. Review-first still uses model tokens to prepare proposals; it waits for you to apply them.

After a substantive turn finishes successfully, Ramu queues an idle review. Cancelled or failed turns are excluded. Background reviews wait for foreground chats and memory cleanup, have a one-minute settling delay, and share a rolling daily review limit (default five). **Run learning maintenance** bypasses the settling delay, while respecting activity and daily limits. Choose a maintenance model from your saved model steps, or use the source chat's model. The selected maintenance model also applies to memory cleanup; the review count limits learning reviews, while memory cleanup retains its existing daily schedule.

The model proposes durable memories, reusable skills, updates/consolidations of existing skills, and a session checkpoint. Proposals include their source chat and event boundary. A checkpoint records progress and unfinished verification; it does not declare the whole task complete. Review the proposed text, apply it, dismiss it, or retry a failed/outdated review. Jobs survive service restarts and an already-applied job cannot write twice. Off pauses learning; existing memory cleanup has its own switch.

Only Ramu-generated, self-contained Markdown skills are automatically maintained. Ramu does not rewrite installed provider/plugin/user skills or their scripts. Managed skills appear in the chat's skill picker and are searchable through `skill_search`; `skill_read` returns the procedure. Read counts indicate retrieval, not proven successful execution. Pin, disable, archive, restore, and inspect/restore revisions in the Memory page. Unused, unpinned skills are archived after the configured number of days. Consolidations require a surviving skill in the same scope and reject concurrent edits. Copies of generated `SKILL.md` files live under the profile's `skills/<id>/` directory; database revisions remain authoritative.

Model-generated learning can be wrong. Review-first makes changes inspectable before they affect later work. Memory cleanup and learning cannot rewrite or archive user-confirmed or essential memories. Conflicting evidence must be recorded separately. The Memory page compares earlier text with the current note and restores a revision as a new user-confirmed edit.

## Ramu tool search

With **Settings → Chats → Ramu tool search** enabled, essential conversation controls remain directly exposed. Optional Ramu tools are discovered using `tool_search`, then called using `tool_invoke` with the returned schema. This searches only tools exposed by Ramu, including newly registered capabilities. It uses lexical matching and aliases, with no embeddings or vector database. It does not search provider-native tools or external MCP catalogs.

Invocation validates the original schema and runs the original scope checks. Tool exposure mode is fixed for a provider connection; changing the preference applies to new connections. The portable search/invocation interface works without native provider deferred-tool support.

## Input compression and continuity

**Settings → Chats → Input compression** offers Off, Balanced (default), and Aggressive. It compacts large textual results from Ramu tools before the provider receives them. Omitted content is marked, and `tool_result_read` retrieves exact character ranges from the original result within the same chat. Error results pass through intact. Stored originals remain available for the lifetime of the chat.

The composer shows a character-based estimate of tokens avoided for compacted Ramu output. It excludes detail rereads, provider cache effects, and provider-native operations; provider usage remains the billing observation.

Memory supports concise search followed by `memory_read` for full text and sources. Approved session checkpoints can reduce older tool output in same-chat provider handoffs while retaining original user requirements and recent events. `session_recall` retrieves original events by sequence number when a checkpoint omits necessary evidence. Files should still be inspected live with the provider's ordinary tools.

The optional **RTK command tool** requires RTK installed on the server's PATH. It exposes `rtk_run` only to full-access chats, runs argument arrays without a shell in the chat working directory, and reports exit status/errors. RTK itself filters the underlying command output. Ramu does not install global hooks or alter native provider shell tools. Native provider history compaction also remains controlled by the provider.

## Validation

`pnpm check` covers shared contracts, queue persistence, review budgets, stale revisions, protected memory, exact output recovery, tool invocation validation, and provider guidance. `pnpm test:learning` runs an isolated Electron journey with simulated providers, screenshots, settings persistence, approval, pinned skills, memory revision restoration, and restart checks. `pnpm test:e2e` covers the wider desktop journey. Real-provider quality and token savings need opt-in live evaluations; simulated tests establish application behavior.
