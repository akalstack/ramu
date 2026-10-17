# Provider limit handling plan

Review of usage-limit fallback and resume (`apps/server/src/providers/usageLimit.ts`, `apps/server/src/agent/usageLimit.ts`, `fallbackRouter.ts`, `providerWait.ts`, `goalManager.ts`), 2026-10-17, made from the code and tests. Nothing here is implemented yet.

The core is sound. Waits are persisted as `provider-wait` events and re-armed at startup, attempted providers and accounts are tracked to prevent loops, backoff is capped at 15 minutes, Stop clears a wait, and the context handoff is capped and drops private reasoning. Claude and Codex detection uses structured signals. The weak spots are detection for the other three providers and a few edge cases.

## Findings

Ordered by impact.

1. **OpenCode, Cursor and Antigravity use generic regexes** (`providers/usageLimit.ts:6,15`). There are no fixtures from real provider messages, so a wording change breaks detection without any test failing.
2. **Absolute reset times are not parsed.** `limitResetsAt` (`providers/usageLimit.ts:37`) handles only relative phrases like "in 2 hours". `acp.test.ts:313` already uses "Resets at 5pm", which falls through to plain backoff. There is no timezone handling.
3. **Two regex sets can disagree.** `isUsageLimit` (`agent/usageLimit.ts:2`) matches a bare "rate limit" or "usage limit" anywhere in stringified errors, so it can misfire; `isLimitMessage` is a separate, stricter set.
4. **No coordination across threads.** Many threads hitting the same limit each run their own timer and retry, so they wake together and can trip the limit again.
5. **Sub-agents never wait.** `waitForGoalProvider` returns false for any session with a `parentId`, so a delegated helper fails or falls back instead of waiting.
6. **Unpinned boot path.** The restart claim depends on `goalsSettingsChanged()` being called at startup. The call exists (`apps/server/src/index.ts:896`), but no test fails if it is removed.
7. **Thin tests.** `providerWait.test.ts` is trivial, and there is no test for absolute times, real message fixtures, or many threads limited at once.

## Plan

1. **Pin the boot path** (finding 6) with a test that fails if `goalsSettingsChanged()` is not run on startup. Quick, and it protects the main claim.
2. **One limit classifier.** Merge the two regex sets into a single module with one entry point and per-provider rules: structured fields first, then provider-specific patterns, then a generic fallback marked low-confidence. Require the "short reply, no tool calls" guard for low-confidence matches only.
3. **Fixtures from real messages.** Capture real limit messages from each provider (redacted) into `apps/server/test/fixtures/limits/` and test the classifier and reset parsing against them. Ask users to contribute new ones when a provider changes.
4. **Absolute and ISO reset times.** Parse "resets at 5pm", "at 17:00 UTC" and ISO timestamps, using the provider's reported timezone when present and the host's otherwise. When parsing fails, record that the time was guessed and show it in the wait banner.
5. **Shared wait per provider account.** Key waits by provider and account, so threads waiting on the same limit share one timer, resume with a small random spread, and do not each probe the limit.
6. **Let helpers wait.** Allow a sub-agent to wait when its parent is waiting on the same provider, instead of failing it; keep the current behaviour when the parent is not waiting.
7. **Replace the trivial test.** Cover wait persistence, expiry and cancellation in `providerWait.test.ts`.

## Limited means paused, not failed

Goal: a provider that hits a limit puts the work in a visible **Limited** (paused) state that can resume, and never in `failed`. Compared against T3 Code (`pingdotgg/t3code`), read 2026-10-17 from its docs and source.

### How T3 Code does it

- **A named state.** Its thread sidebar docs define **Limited** as "the provider stopped on a usage or rate limit". It is separate from a provider error: the failure is recorded with `class: "usage_limit"` plus an ISO `resetAt` (`packages/provider-core/src/server/failure.ts`), and the turn item is titled "Usage limit reached" instead of "Provider error".
- **The conversation survives.** The provider's own explanation stays in the thread, and queued messages stay saved while the limit blocks it; they run after the continuation finishes.
- **Recovery actions in a composer banner** (`UsageLimitRecoveryBanner.tsx`, with a mobile equivalent in `UsageLimitRecoveryCard.tsx`):
  - **Resume** in an empty composer, for a manual continue.
  - **Resume at reset**, offered only when a reset time exists and is after the stop time, with a cancel. Sending a message, archiving or settling the thread stops it.
  - **Snooze until reset**, which hides the thread until the allowance returns. It is independent of auto-resume: snooze alone just wakes the thread; both together wake and continue it. **Wake now** cancels it.
  - A setting, **Auto-resume limited threads**, makes scheduled resume the default. Without a reset time it falls back to manual retry.
- **Goals report it too.** Its goal status has a `usage_limited` value ("Goal hit a usage limit").

### What Ramu does now

- A limited thread is not failed in the main path. `waitForGoalProvider` records a `provider-wait` event, sets the state to `idle` and re-arms a timer, for goals and plain threads alike (`providerWait.ts:139-170`). That is a good base.
- It is **not first-class**, though. The state is plain `idle` with a hidden event, so nothing in the sidebar, Inbox or mobile says "limited", and a plain thread has no Resume, snooze or auto-resume control. Only goals get a `waiting-provider` status and banner copy.
- **Several paths still fail instead of pausing:**
  - Sub-agents: `waitForGoalProvider` returns false when `parentId` is set (`providerWait.ts:142`), and the fallback then calls `fail` with "Every fallback option reached a usage limit" (`fallbackRouter.ts:384-390`).
  - Background analysis rethrows a limit error (`backgroundAnalysis.ts:243`).
  - A limit the classifier misses, such as the generic-regex providers in finding 1, becomes an ordinary error.
  - Scheduled runs and advisor or review calls inherit the same split; check each.

### Lessons from T3 Code's open issues

Its tracker shows where this design breaks. Avoid the same mistakes:

- Misclassification: "Prompt is too long" shown as "Usage limit reached" (#19832), and every 429 reading as a usage limit (#13399). A wrong "Limited" state is as bad as a wrong error. Keep the confidence levels from step 2 and never pause on a low-confidence match without the short-reply guard.
- Hidden state after retries: Codex HTTP 429 retry exhaustion hid the Limited state and the manual Resume (#16288). Retry exhaustion must end in Limited, not in an error.
- Subagents: a limit shown in activity but with no auto-resume controls during a subagent workflow (#15665), and nested subagents left "Running" after the parent hit the limit (#19993). A limit must propagate to children and settle their state.
- Reset data quality: a partial `rate_limit_event` published as a full window list (#12170), and an account-pool cooldown that never reached auto-resume (#20375).

### Steps

8. **Add a `limited` thread state** next to `idle`, `running` and `failed`, set whenever a provider-wait begins. Store `resetAt` (or null) and the provider's explanation with it. Show it in the sidebar, Inbox, thread header and the mobile thread list, and exclude it from failure counts and error notifications.
9. **Recovery controls for every thread**, not just goals: **Resume now**, **Resume at reset** (only with a known future reset time), and **Snooze until reset**. Add an **Auto-resume limited threads** setting, default on, which is what the existing timer already does. Keep queued messages through the wait (already true) and have a new message cancel a scheduled resume, as T3 does.
10. **Pause, never fail, on the remaining paths.** Let sub-agents enter `limited` with their parent (this extends step 6), make background analysis, advisor and review calls defer and retry, and send scheduled runs that hit a limit to `limited` with the existing schedule retry instead of `failed`. Settle child state when a parent becomes limited so nothing stays "Running".
11. **Reserve `failed` for real errors.** After the classifier work in steps 2–3, a low-confidence limit match asks the user or retries once before pausing, and a confident one pauses. Treat retry exhaustion on a 429 as `limited`.
12. **Tests.** A limited thread is not `failed`; sub-agent, background-analysis and schedule paths pause; Resume now, Resume at reset and Snooze work, including cancel on a new message; and a prompt-too-long error stays a normal error.

## Context handoff prompt

Goal: when a limit moves a thread to another provider, the new provider gets enough context to continue correctly, with the handoff framed clearly and kept out of the user's own words. Compared against T3 Code, read 2026-10-17 from `docs/internals/context-handoffs.md`, `docs/orchestration-v2/provider-switching-and-context.md` and `apps/server/src/orchestration-v2/ContextHandoffDelivery.ts`. T3's docs do not give the final prompt wording (`renderHistory` was not visible to me), so what follows covers structure and rules, not copied text.

### How T3 Code does it

- **A stored record, not a rebuilt string.** A `ContextHandoff` records the run range it covers, the strategy, the summary text, which provider produced it, and a status (`pending`, `injected`, `inline`). A regenerated summary supersedes the old one instead of editing it.
- **Incremental.** The default is a delta: only what happened since the target provider last took part. When a thread returns to a provider it used earlier, T3 resumes that provider's native session and injects just the runs it missed.
- **Strategy ladder:** no handoff if the target is current, then a delta into the existing thread, then a full-thread handoff into the existing thread, then a full handoff into a new thread when resume fails, settings are incompatible or the context is stale, and finally "unsupported".
- **Content comes from the app thread, not the provider transcript:** goals, decisions, changed files, commands and tests, plan state, open approvals, the latest checkpoint, known failures and sub-agent results. It leaves out protocol noise, hidden reasoning, superseded tool output and large diffs where a file list is enough. Long text items are compacted to about 240 characters.
- **Separate from the user's message.** The handoff goes in as a preamble or context block (system, developer or synthetic message, by provider capability). The user's message stays the actual input. Each block is headed `Context handoff (<strategy>)` plus a coverage line.
- **A way back to the detail.** The coverage line tells the agent how to recover history with `t3_thread_read` (activity view, paginated, with text offsets for long items). If the coverage text is oversized it is shortened to a pointer.
- **Budgeted.** Items already delivered are skipped, and selection stops at a budget. Over budget, it either defers the handoff to the next ordinary turn or fails with `ContextHandoffBudgetError`.
- **Visible.** The UI inspector shows each handoff's strategy and status.

### What Ramu does now (`apps/server/src/agent/handoff.ts`, `fallbackRouter.ts`)

- **Strong:** the transcript includes visible user text, attachments, assistant text, tool calls and results, questions and answers, approvals, sub-agent results and settings, and excludes private reasoning and credentials. The wrapper tells the model it is context and not new instructions, to inspect current files before repeating tools, and that prior approvals are not permission for new actions.
- **Rebuilt in full every time.** There is no stored record, no delta, no status, and no superseding. A second fallback re-sends everything, and returning to an earlier provider starts a new native session (`providerSessionId` is kept only when the provider is unchanged, `fallbackRouter.ts`).
- **Silent, lossy truncation.** Over 120,000 characters it keeps the first 20,000 and last 100,000 and inserts "[Middle of older transcript omitted]" with no count and no pointer to the missing events. The recall pointer to `session_recall` appears only in the checkpoint variant.
- **Nothing says what the work is.** The transcript is raw events. It does not state the goal, the plan state, open approvals or questions, files changed so far, or the last test result. The model has to infer them from the log.
- **No visibility.** A handoff leaves a `settings` event with a reason line, but there is no record of what was sent, how much was dropped, or whether delivery worked.
- **The instruction is generic.** Every fallback sends the same "Continue the unfinished request from the conversation handoff…" line, whether the stop came from a limit, a model switch or a restart.

### Steps

13. **Store each handoff as a record** (new event kind or table): covered event range, strategy, character budget used, omitted count, source provider, target provider, and status. Supersede instead of overwriting. Show it in the thread (a "Context carried over from <provider>" line with an inspector) so the user can see what moved.
14. **Deltas.** When the target provider already holds part of the thread, send only the events after its last participation, and resume its native session when it is the provider the thread used before. Fall back to a full handoff when resume fails or the delta chain gets long, as T3's ladder does.
15. **A state summary at the top of the handoff.** Before the transcript, add a short block built deterministically from thread state, not by a model: the goal and its status, the user's latest request, files changed so far, last test or command result, open questions and approvals, queued messages, and running or finished sub-agents. This is what T3's content list asks for, and it removes the "infer it from the log" problem.
16. **Say what was dropped, and how to get it back.** Replace the silent middle cut with a marker that gives the omitted event range and count and names `session_recall` with the range to page through. Compact long tool results to a short summary plus a file or event reference, and prefer dropping old tool output before old user messages.
17. **Frame by cause.** Keep the current safety wording, and add the reason ("the previous provider hit a usage limit", "you were switched models", "the host restarted") and the exact next step (continue the last unanswered request, or resume the goal). Keep the handoff block visibly separate from the user's own message.
18. **Budget with a defined failure.** Use the target model's context size, not a fixed 120,000 characters. If the handoff still does not fit, shrink in a fixed order (old tool output, then old assistant text, then middle history) and, if needed, move the thread to `limited` with a clear reason instead of sending a truncated prompt or failing.
19. **Tests.** The state summary matches the thread; a delta covers only the missed events; the omitted-range marker is accurate; a returning provider resumes its session; the budget order is respected; private reasoning and secrets never appear; and a limit-triggered fallback on a goal thread carries the goal into the new provider's first prompt.

## Verification

Run `pnpm --filter @ramu/server test` and `pnpm --filter @ramu/shared test`. Fixture tests should fail when a pattern is removed, which is the check the current regexes lack.
