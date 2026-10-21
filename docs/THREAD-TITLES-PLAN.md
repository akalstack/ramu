# Provider-aware thread titles

## Human need and delivery

People need to recognize a thread later without paying for duplicate title generation or losing a name they chose. Prefer a useful title already supplied by the active provider, then use Ramu's isolated generation when no title is available. Keep the opening-message title as an immediate placeholder and preserve the existing Rename and Regenerate title actions on desktop and mobile.

**Easier for the person:** Threads are findable by a useful name with no manual renaming, and chosen names are never overwritten.

Ship one verified provider title integration together with the shared server policy and fallback. Unsupported providers must keep working through Ramu's existing generator. Do not require every adapter to support native titles before shipping.

## Existing services to extend

- Follow [Architecture](ARCHITECTURE.md#providers), [UI](UI.md) and the [planning guidance](../AGENTS.md#planning-docs). Keep title ownership, provider events and persistence on the execution host behind the typed API; clients only display state and request actions.
- Extend `apps/server/src/agent/backgroundAnalysis.ts` (`draftTitle` and isolated `analyze`) and `agent/prompts.ts`; reuse background model/account fallback routing rather than adding another inference service or model setting.
- Extend the provider adapters' `NativeFeatures` and runner/event boundary only as needed to describe verified title behavior. Normalize provider metadata before it reaches workspace code. Cover Claude's SDK path as well as `AgentRunner` integrations when supported.
- Reuse `tasks.generateTitle`, `tasks.rename`, workspace `titleSource` / `setGeneratedTitle`, and existing task-change notifications. Extend stored provenance and request state only where required for precedence, deduplication and recovery.
- Extend the existing `agent/threadTitles.ts` scheduler and stored revision/attempt receipts for provider-title waiting and metadata. Current server scheduling, fallback and deliberate rename behavior are documented in [Agents](AGENTS.md#thread-titles).

## Provider support must be verified

Distinguish an unsolicited title update or an already stored generated title from an explicit request that invokes a model. Only reuse of an existing title avoids Ramu's duplicate inference. A native generate-title endpoint can still consume quota; do not describe it as free.

Inspect the installed runtimes and supported protocols for Codex, Claude, OpenCode and ACP adapters. Record which versions actually emit or expose generated titles during Ramu's normal session flow, when they arrive, and whether they are merely prompt previews. Verify with a representative live session before enabling a capability. A protocol field, proposal or CLI feature alone is insufficient evidence that our SDK/app-server integration receives a generated title.

Local version probes on 2026-10-18 reported Codex CLI 0.163.0, Claude Code 2.1.302 and OpenCode 2.0.32. These probes did not create sessions or verify generated-title delivery. No native-title capability is enabled on that evidence.

Candidate references to investigate:

- [ACP session metadata updates](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/docs/rfds/session-info-update.mdx): a possible title notification; verify implementation and runtime support.
- [Codex title implementation](https://github.com/openai/codex/blob/main/codex-rs/tui/src/app/thread_title.rs): illustrates separate generation inside the CLI UI; do not assume it runs automatically for an app-server client.

## Shipped server policy (provider-agnostic)

`ThreadTitles.acceptProviderTitle` accepts a bounded, plain-text title from the newest top-level session of a task, rejecting placeholders, control characters, old sessions, deleted tasks, manual names and settled useful titles. It stores provenance `provider`, cancels pending fallback and supersedes its late result. A constructor predicate (`suppliesTitles`, false for every provider today) defers fallback until a short grace period after the turn result, or a turn limit if no result arrives. Covered by fake-provider tests in `apps/server/test/threadTitles.test.ts`.

## Remaining implementation

### Wire a verified provider

- Verify one provider live, then make `suppliesTitles` true for it and call `acceptProviderTitle` from its runner/event boundary (normalize metadata before it reaches workspace code). Until then nothing calls it.
- Persist and restore waiting across a server restart; today the wait is in memory and restart falls back to the existing recovery rules.
- Native explicit regeneration remains unimplemented.

### Prefer an existing provider title (remaining parts)

The policy, provenance, race handling and fake-provider tests above are done; the items below still need a verified provider or are not yet covered.

- For a provider verified to supply titles, wait through the first completed turn and a short bounded delivery grace period before scheduling fallback. Bound stalled, failed or interrupted turns; title work must never block the conversation. Providers without verified metadata continue through the existing server fallback.
- Normalize and accept a nonempty, bounded provider title for the correct host, task and active provider session. Reject known placeholders, control characters and invalid metadata; render as plain text. Avoid rejecting useful native titles solely because they differ from Ramu's preferred word count.
- Extend provenance to distinguish provider-supplied titles from Ramu generation and manual ownership. Apply the existing revision rules to metadata: manual names and settled useful automatic names remain stable across late updates and provider switches.
- If a provider title arrives while fallback is pending, cancel fallback safely and reject its superseded result. Ignore helper titles, old-session events and updates after deletion. A supporting fake provider must produce zero Ramu title-generation calls.
- Use a verified native generation operation for explicit regeneration only if it fits the existing isolation, cancellation and output contract. Do not return an unchanged cached provider title as a successful regeneration or describe an inference endpoint as free.

### Fallback quality and native acceptance

- Evaluate subject-and-outcome wording on representative English/Indonesian tasks, greetings, attachments and linked issues. The bounded prompt requests the durable user goal, omits incidental workflow instructions and avoids completed-work claims; unit tests establish the contract, not actual model quality.
- Verify the single optional refinement with real conversations, including short substantive replies and different greeting/clarification wording. Current deterministic screening avoids known generic greetings; it cannot establish that arbitrary prose has revealed a useful subject.
- Verify tool restrictions through every actual provider boundary used for naming. Continue using isolated analysis and resolved conversation data; do not introduce browsing, skill execution or a second text-generation service.
- Verify synchronized pending/failure/retry labels, focus and screen-reader behavior on packaged desktop, iOS and Android, including two hosts, client closure, offline/reconnect and server restart. Manual titles must survive all paths. No title action may rename branches, worktree directories or workspace labels.

## Acceptance and validation

- Representative task: start “Use two agents to fix duplicate payment retries and write a report.” The resulting title identifies payment retry duplication, omits the requested workflow/report, and does not claim completion. Repeat with an Indonesian opening, a greeting followed by the real request, a vague attachment and a linked issue whose subject appears in the first reply.
- With a supporting fake provider, an unsolicited useful title produces zero Ramu title-generation calls. With an unsupported provider, exactly one fallback runs. Missing, empty, placeholder or delayed metadata reaches the bounded fallback; useful titles need no refinement. A vague opening gets at most one refinement when context becomes available.
- Add provider-boundary tests for native title normalization, active provider-session association, late metadata, provider switches and provider/fallback races. Retain current scheduler tests for duplicate starts, restart limits, deletion, helpers, stale revisions, manual edits, explicit regeneration and quota/deadline failures; extend worktree preservation evidence with the native path.
- Verify hostile messages and links cannot cause title inference to run tools or modify the working tree. Use provider-boundary integration tests where sandbox/tool restrictions matter.
- Extend existing web/mobile action coverage to real synchronized updates from each entry path, offline/reconnect and native focus/accessibility. Current component tests cover pending/failure/retry, correct-host dispatch and repeated activation.
- For implementation, run tests and typechecks for affected shared/server/web/mobile packages. For desktop-facing changes run `pnpm build`, then `pnpm test:desktop-smoke`, without rebuilding during smoke. Verify one real supporting provider and one fallback provider on desktop and mobile, including client closure and server restart. Documentation-only edits need formatting and link checks.

## Later options

Consider project-specific title instructions or a separate text-generation model only after representative tasks demonstrate a need. Do not add settings, title learning from rename history, continuous retitling, extra browsing or a new title-generation service in the first delivery.

When this work is complete, move lasting behavior into the feature guides, remove its roadmap entry and delete this plan.
