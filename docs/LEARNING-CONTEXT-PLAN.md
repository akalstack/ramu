# Learning, response styles, tool discovery, and memory

Research and implementation plan, 2026-10-14. The implementation now includes response styles, shared provider guidance, Ramu-only tool discovery/invocation, persistent learning reviews and managed Markdown skills, protected memory/history restoration, session checkpoints, exact tool-result recovery, and optional RTK execution. See [Learning and context efficiency](LEARNING.md) for shipped behavior and controls.

Confirmed design constraints: tool search covers only tools exposed by Ramu, including future additions. Use lexical matching and agent-directed inspection without embeddings or a vector database. For repository context, inspect the live filesystem with tools such as `rg`, glob, and find. Extra search calls and file reads are an accepted trade-off. Tool discovery searches a capability catalog; repository search inspects files. They serve separate purposes.

## Baseline before implementation

| Area | Current implementation | Gap |
| --- | --- | --- |
| Shared memory | `apps/server/src/memory.ts`: scoped SQLite notes, lexical BM25-style ranking, duplicate detection, usage/recency ranking, expiry, archival, and audit history | Limited evidence links and automatic extraction from completed turns; flat storage is adequate until evaluations show otherwise |
| Memory maintenance | Hourly hygiene; daily model-assisted cleanup after five changes; scope-separated operations and concurrent-edit checks | No shared maintenance queue or explicit model/token budget; cleanup inputs cap at 300 notes per scope |
| Skill discovery | `apps/server/src/context.ts`: bounded discovery of project and user skills, nearest project wins by name; explicit `$skill` references become file pointers | No Ramu-owned skill lifecycle, usage tracking, versioning, consolidation, or task-based selection |
| Tool exposure | `apps/server/src/index.ts`: authenticated, per-chat MCP tools for questions, goals, memory, schedules, reviews, advisor, and helpers | Full registration per HTTP request; no Ramu tool-search registry |
| Provider instructions | `agent.ts` builds shared instructions; Claude receives appended system instructions and Codex receives developer instructions | OpenCode and generic ACP adapters do not visibly consume `connection.instructions`; establish parity before relying on new styles or learning prompts |
| Context limits | `withContext` caps individual/total file characters; provider handoff keeps the beginning and end of a long transcript | Character limits and truncation do not preserve a structured account of decisions, open work, and evidence |
| Settings | Shared types, validated IPC preferences, React settings, English/Indonesian localization | New features need all these layers and capability-aware UI |

Relevant tests already exist in `apps/server/test/memory.test.ts` and `context.test.ts`. Memory history is exposed through IPC; the current browser restores archived notes, but does not expose a full revision diff/restore interface.

## Reference findings

- [Hermes skills](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills): records reusable procedures and lessons from corrections and successful workflows; supports targeted patches and optional staged writes. [Its curator](https://hermes-agent.nousresearch.com/docs/user-guide/features/curator) tracks usage, retires stale agent-created skills, and optionally consolidates whole skill packages, with rollback and pinned skills. Adopt the lifecycle and package integrity principles, with budgets suited to Ramu's background service.
- [Anthropic context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents): recommends compact, high-signal context, lightweight references, just-in-time retrieval, persistent notes, and careful compaction. It describes Claude Code combining upfront project instructions with live glob/grep exploration, and explicitly allows hybrid retrieval strategies. This supports incremental improvements to Ramu's existing memory; it does not establish that lexical search universally beats RAG.
- [Anthropic memory tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool): persistent memory operations are implemented by the host application, with on-demand reads across sessions. Ramu can retain SQLite and its shared tools; adopting this principle does not require copying Claude's file API or changing storage.
- [Anthropic long-running harnesses](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents): progress artifacts and verified incremental updates help subsequent sessions recover task state. Apply this to session checkpoints, separately from durable personal/project memory.
- [Anthropic tool design](https://www.anthropic.com/engineering/writing-tools-for-agents): use meaningful compact results, optional concise/detailed response formats, and realistic evaluations. Apply this to memory search/expansion and Ramu-owned tool discovery.
- [i-have-adhd](https://github.com/ayghri/i-have-adhd): action-first answers, numbered steps, bounded lists, fewer tangents, and matter-of-fact errors. Ramu can offer an ADHD-friendly preset and skill-backed custom styles. Avoid fabricated time estimates or unnecessary next-step requests once a task is complete.
- [Anthropic tool search](https://www.anthropic.com/engineering/advanced-tool-use): tools are discovered on demand, with only needed definitions entering context. Native deferred-tool references are provider-specific; returning a tool name in text alone does not make that tool callable.
- [RTK](https://github.com/rtk-ai/rtk): command-aware filtering, grouping, deduplication, and truncation reduce shell output before the model reads it. Its interception applies to supported shell calls, not every provider-native read/search tool.
- [Caveman](https://github.com/JuliusBrussee/caveman): combines shorter responses with input compression/proxy tooling. Its published savings depend on workload and configuration. Measure Ramu's own results instead of adopting upstream percentages as promises.

## Proposed Ramu behavior

### Automatic learning and skill maintenance

After a completed substantive turn, enqueue a bounded background review of new evidence: user corrections, repeated successful procedures, and failures with verified fixes. Persist a cursor so a restart cannot learn the same turn twice. Never interpret cancellation, pending input, a provider limit, or an unverified claim as a successful outcome.

Classify candidates as a durable memory, an improvement to an existing skill, a new reusable skill, or no change. Search existing knowledge before writing. Store the supporting session/event references and reason with every change. Repeated generated summaries do not count as independent evidence.

Maintain generated skills in a Ramu-owned directory. Discovered provider, plugin, and user skills remain available; automatic maintenance only changes managed skills or explicitly adopted copies. Support pin, disable, archive, restore, diff, and revision rollback. Preserve scripts, templates, references, and relative links when merging packages. Track actual invocation where observable; distinguish discovered, suggested, read, and used signals.

Offer automatic and review-first modes plus pause and manual run. Use cheap deterministic hygiene before bounded model analysis. Keep background jobs persistent, cancellable, scope-isolated, deduplicated, and aware of foreground activity and provider limits. Expose the selected maintenance model, budget, recent changes, and errors.

### Response styles

Add Default, Concise, Detailed, ADHD-friendly, Caveman, and Custom presets, with a global default and per-chat override. Style is separate from input compression: readable ADHD-friendly answers can still use compact tool results.

Compile a small provider-neutral presentation instruction. A custom style may reference a discovered skill; load its applicable instructions without granting it extra authority. Preserve code, commands, paths, structured results, and requested exact quotations. Explicit user requests override the preset. Foreground prose uses the chosen style; internal maintenance JSON uses its required schema. Surface when a provider cannot apply or refresh instructions reliably.

### Tool search

Move Ramu tool definitions and handlers into a registry with names, descriptions, schemas, scope/capability checks, and enabled state. Its catalog contains only tools exposed by Ramu and automatically includes newly registered tools. Keep essential conversation controls directly available. Search optional capabilities with bounded lexical ranking over names, descriptions, and curated aliases; support exact names and agent-directed query refinement. Do not add embeddings or a vector index. Resolve results against current registrations and enabled state so renamed, removed, or disabled tools cannot leave stale callable entries.

Use native deferred discovery where supported. For other providers, expose a stable search tool that returns matching schemas and an invocation tool that validates the chosen tool's arguments with the original schema. Authorization and scope checks run again at invocation time. Do not imply this searches every tool owned by a provider or every MCP server configured outside Ramu.

The MCP server is currently rebuilt for each POST. Any selected-tool state must live outside that request object and be keyed to the authenticated chat. Validate actual discovery and invocation behavior with each provider before claiming parity.

### Input and output token efficiency

Start with Ramu-controlled payloads: memory packs, context attachments, tool results, advisor/helper handoffs, and provider-switch transcripts. Keep the original data, return a compact view with a retrieval handle, and clearly indicate omissions. Preserve exit status, actionable errors, source locations, and enough surrounding context to diagnose failures. Use task-aware selection for files; keep editable source exact.

Add optional RTK integration through supported provider hooks or an explicit Ramu command tool. Formatting a tool event after the provider has already consumed it saves no input tokens. Unknown or unsupported provider tool paths must pass through unchanged and report their coverage accurately.

Output savings come from generation instructions, not shortening the displayed answer after generation. Keep style and compression controls independent. Expose off/balanced/aggressive input modes and per-chat statistics. Label tokenizer estimates; provider-reported usage is the billing observation. Evaluate cache effects, compression overhead, retrieval retries, latency, and task success alongside token reduction.

### Keep current shared memory; improve recall and continuity

Retain the current scoped SQLite notes, lexical ranking, tags, audit history, and cleanup. Improve recall and continuity incrementally, guided by Anthropic's context-engineering principles and evaluations against Ramu's current behavior.

Use a small orientation index plus on-demand search and direct reads by ID. Add concise search results with source/date/confidence metadata and a detail operation for full notes and supporting excerpts. Preserve the current full-content search response for existing callers unless they request concise mode. Allow query refinement and scope/kind/tag filters; evaluate optional task-specific initial recall without preloading the whole store. Existing limits are character budgets, not measured token counts.

Keep three forms of context distinct: durable memories for preferences and decisions; skills for reusable procedures; and session checkpoints for objectives, completed work, unresolved issues, verification, and next actions. Keep checkpoints attached to their session/goal rather than filling global memory with task logs. Retrieve original events or inspect live files when more detail is needed.

Add evidence references to learning writes and expose history/diffs with undo. Strengthen confirmed-note protection: current cleanup can rewrite confirmed text, and explicit agent updates can remove its confirmation. Require deliberate user authorization for changing protected content; generated learning should preserve contradictions as candidates instead of silently replacing a user-confirmed preference. Keep cleanup bounded and preserve exceptions and reasons during merges.

Improve Ramu-owned handoffs with structured checkpoints plus recent context and retrieval pointers instead of relying only on beginning/end transcript truncation. Validate recall before reducing context. Provider-native compaction remains under the provider's control unless an adapter exposes a supported integration.

Evaluate the current baseline against these incremental changes using held-out cases: recalling older decisions, exact identifiers, English/Indonesian phrasing, corrections and contradictions, cross-project isolation, resumed tasks, and recovering omitted details. Measure task success, correct source retrieval, false/conflicting recall, tokens, and latency. Consider optional topic grouping only if navigation or retrieval failures persist; a grouped UI need not change the storage model. No embeddings or vector database are planned.

## Implementation sequence and acceptance

1. **Provider instruction parity and response styles.** Add settings/types/IPC/UI/localization and verify instructions on initial launch, resume, provider switch, and style change. Test exact code preservation and user overrides.
2. **Tool registry and discovery.** Preserve current tools and authorization, add search/invocation fallback, verify scope isolation and invalid arguments, and measure definition tokens on real adapters.
3. **Managed skills and learning jobs.** Add ownership, revisions, evidence-backed candidate generation, restart-safe jobs, budgets, package-safe consolidation, archival, and undo. Test concurrent edits and repeated reviews.
4. **Incremental shared-memory improvements and session checkpoints.** Preserve existing IDs and storage; add source-linked concise search/detail reads, protected-note handling, history/undo, and structured session handoffs. Compare with the current baseline on recall and continuation quality.
5. **Compression and optional RTK hooks.** Introduce compact views on owned payloads, then supported native-command hooks. Compare enabled/disabled runs on diagnosis, exact values, retrieval recovery, usage, and latency before changing defaults.

Each stage should ship working behavior across the supported paths and identify unsupported capabilities in the UI. Run focused server tests during implementation, repository `pnpm check` before submission, and desktop smoke checks/screenshots for UI changes. Paid live-provider evaluations remain opt-in.

Additional useful features inferred from this research: session recall, source-linked memory explanations, a learning activity feed with undo, a maintenance model/budget selector, and diagnostics showing which token-efficiency paths are active. The unspecified “other” features in the request remain open; these additions are proposals.


## Implementation choices

- Use the portable search/schema/invocation gateway for every provider. Native deferred-reference optimizations can be added later without changing the registry.
- Maintain only generated, self-contained Markdown skills. Installed skill packages and support files are never rewritten or consolidated by this service.
- Bound learning with input/output sizes, a timeout, an idle delay, and a rolling daily review count. This is a review budget, not a billing-token cap.
- Use an explicit, opt-in RTK tool in full-access chats. Native shell hooks and provider-wide interception are not installed.
- Preserve SQLite memory and source histories. Validate retrieval/continuation behavior with fixtures; published quality or savings claims require opt-in live-provider evaluation.
