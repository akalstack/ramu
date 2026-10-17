# Outcome verification plan

Review of goals, schedules, memory and skill extraction (`apps/server/src/agent/goalManager.ts`, `agent/goals.ts`, `background/schedules.ts`, `memory/learning.ts`), 2026-10-17, made from the code and tests. Nothing here is implemented yet.

The infrastructure is sound: state is persisted and re-armed at startup, runs are deduplicated, revisions are kept, and the tests cover restarts. The gap is that nothing checks whether the agent's work was **good**. Each place below accepts a claim or an idle state as success.

## Findings

Ordered by impact.

1. **A goal completes when the model says so.** `update_goal(completed, reason)` is accepted with any non-empty `reason` (`goalManager.ts:97-109`). The only gates are no open questions, no running helpers and no queued messages. The "audit evidence" requirement is prompt text only (`goals.ts:30`). `goals.test.ts:87` asserts that no judge model is involved. An agent that quits early or overclaims passes.
2. **No progress check.** A goal that loops without changing anything is stopped only by the continuation cap (default 10).
3. **A schedule run is "completed" when the session goes idle** (`schedules.ts:319-330`). A task that failed, or stopped to ask a question, can read as success.
4. **Skills are applied automatically by default.** A startup migration forces `auto` over `review` (`src/index.ts:158-162`), so generated skills land with no human look. Secret detection is one regex (`learning.ts:69-70`), and `skillActivation.test.ts` has 2 cases.
5. **`Automation.tsx` (about 779 lines) has no web tests**, and `list()` in `schedules.ts` loads every schedule and filters in JS. Minor, but both will bite as schedules grow.

## Plan

1. **Evidence on completion.** Require `update_goal(completed)` to carry structured evidence: the checks it ran, with their results, and the files it changed. Reject completion when the workspace has uncommitted changes the agent did not mention, or when the evidence is empty. Keep it deterministic; no judge model yet.
2. **Optional verification command per goal.** Let a goal specify a command (for example `pnpm --filter @ramu/server test`). On a completion claim, run it in the workspace. Pass completes the goal; failure returns the output to the agent as the next continuation and counts as a turn. Show the result in the goal history.
3. **Stall detection.** Track a fingerprint per continuation (diff hash plus tool-call summary). After two continuations with an unchanged fingerprint, set the goal to blocked with a reason, instead of spending the remaining turns.
4. **Real schedule outcomes.** Record success, failed, needs-input and cancelled on `schedule_runs`, from the session's final state and last error, not idle alone. Surface them in Automation and the mobile schedules list, and make a repeated failure pause the schedule.
5. **Review by default for skills.** Restore `review` as the default for new data directories and keep `auto` as an opt-in. Strengthen secret detection (known key formats, high-entropy strings) and add tests for activation and rejection.
6. **Cleanups.** Add focused tests for `Automation.tsx` form logic, and query schedules by id in `schedules.ts`.

## Verification

Unit tests beside the existing ones: `goals.test.ts` (evidence gate, verification command, stall), `schedules.test.ts` (outcomes, pause on repeated failure), `learning.test.ts` and `skillActivation.test.ts` (default mode, secret formats). Run `pnpm --filter @ramu/server test` and `pnpm --filter @ramu/web typecheck`.

## Open question

Whether a judge model should ever decide completion. Steps 1–3 are cheap and deterministic, so ship them first and measure how often completion is still wrong before adding model cost.
