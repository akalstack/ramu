# Goals

Goals keep a thread working toward an objective across turns. They persist with the thread and follow provider changes.

## Settings

In **Settings → Goals & delegation**:

- **Automatic goals** is on by default. Agents can create goals for work that needs further turns. Turn it off to start goals manually with `/goal`.
- **Maximum continuation turns** defaults to 10. Choose a preset, a custom limit from 1–1000, or Unlimited. Initial turns, user messages, and quota retries do not count.

Changes apply to existing goals. Raising the limit reactivates goals stopped at their cap. Resume allows another batch after reaching the limit.

## Controls

Use Pause, Resume, or Clear in the goal bar. Pause prevents further turns; Stop interrupts current work and pauses the goal.

```text
/goal Implement login and test authentication
/goal pause
/goal resume
/goal clear
```

`/goal` without arguments shows the current goal. An updated objective is queued for an agent already working.

### Verification command

You can give a goal a command that Ramu runs itself when the agent says the goal is done. Only you can set it, so an agent cannot use a goal to run commands outside its approvals.

```text
/goal Login works and tests pass
verify: pnpm --filter @ramu/server test
/goal verify: pnpm typecheck
/goal verify: off
```

A last line `verify: <command>` in a new goal sets the command; `/goal verify: <command>` changes it on the current goal and `/goal verify: off` removes it. The command runs in the thread's folder, with a ten-minute limit.

The shield button in the desktop goal bar and in the phone's goal tray edits the same command: set or change it, or leave the field blank (or `off`) to remove it (2000 characters; hidden for a completed goal). The call is `agent.goal.verify`, which the agent's goal tools do not have, so an agent cannot set it.

## Continuation

The working agent reports progress and completion. Active goals continue after a turn ends. User messages, required answers, approvals, and workspace writers take priority. Completed goals stop; blocked goals need user input or an explicit resume.

### Completion needs evidence

`update_goal(completed)` is checked before it is accepted. No model judges it; the checks are deterministic:

- It must carry `evidence`: the checks the agent ran with whether each passed (`evidence.checks`), and the files it changed (`evidence.changedFiles`). No checks, or any failed check, rejects the claim, and the agent reads why and goes on.
- Ramu compares the uncommitted files in the thread's repository with what they were when the goal began. Every file that changed since then must be named in `changedFiles`, or in `otherChanges` when the agent did not change it (your own edits, another thread). Files that were already dirty and untouched are ignored, so a busy shared checkout does not block completion. Outside a git repository, or for a goal that began before this check existed, only the first rule applies.
- Evidence is accepted only for the goal and instructions that were current when validation began. Editing the objective or verification command, replacing the claim, pausing/stopping, or receiving new instructions or required input while validation runs requires a fresh report.
- The accepted evidence is kept on the completed goal.

With a verification command, a claim does not complete the goal by itself. Ramu records it, waits for the turn to end, then runs the command. A pass completes the goal and the passing result is recorded on it. A failure keeps the goal active, and its output (the end of it, with credentials removed) is sent to the agent as the next continuation, once. That continuation counts as a turn, so the limit still applies. The goal bar's progress text shows the failure, and the transcript gets a **Verification failed** row with the command, how it ended (exit code, timeout, could not run) and the end of its output. Pausing, clearing or stopping the goal ends a running command. Editing the objective or command, or accepting a replacement completion claim, also cancels the old command. A late result cannot complete the replacement claim. Instructions received after a pending claim require fresh evidence, including after restart.

### Stalls

Before each continuation Ramu compares what the previous turn left behind with what the continuation before it left: the files changed since the goal began, and the tool calls with their results. When two continuations in a row leave the same, the goal becomes **blocked** with the reason "No progress", instead of spending the remaining turns. A message from you, or **Resume**, starts the count again. A retry after a usage limit is not a continuation and never counts, and the turn limit is checked first.

The tool comparison associates each parent call with bounded result summaries, text, terminal output, resource text and diff content, plus error/running state. Changing remote results can therefore count as progress even when local files do not change. Tool/terminal IDs, unrelated results and helper output do not reset the parent’s stall count. This detects repetition, not whether changing output is useful.

The block leaves a **No progress** row in the transcript with the reason. It is separate from **Goal needs input** (the agent asked for something), **Goal paused** (you paused it) and **Limit reached** (a provider's usage limit, which is never a failure of the goal).

A completed goal's row lists the evidence: the checks the agent ran with their results, the files it changed, and the verification command that passed.

The baseline and stall count survive a restart. Outside a git repository only the tool trail decides.

Usage failures try the thread's fallback list first. If no provider is available, the goal waits for a reset and retries. Unknown reset times retry with increasing delays, up to 15 minutes. Authentication errors require intervention.

Whether a waiting goal continues by itself is the thread's **auto-resume**: the thread's own choice, otherwise the global setting (on by default). With it off, the goal stays waiting for the provider, nothing retries, and it continues when you press **Resume** or **Try again**. A goal paused by you keeps its own paused state.

### Paused: by you or by a limit

A held goal has one status, `paused`, and a `pausedBy`: `user` (you paused it or pressed Stop; it never resumes by itself, and a missing value means this) or `provider-limit` (the provider's usage limit; it continues at the reset). The wording differs: **Limit reached · resumes …** versus **Goal paused**. A limit hold is never a stall, never counts toward the turn limit and never fails a verification; pressing **Pause** on it turns it into your pause, which the retry timer leaves alone.

`goalHold` (`packages/shared/src/chat/goalHold.ts`) tells a limit hold from a user pause.

Goal detection depends on the model following its instructions. Creating a goal does not grant permission for additional work.

## Tests

Goal behavior is covered by `apps/server/test/goals.test.ts` (lifecycle, limits, waiting, evidence, verification, stalls) and the related `goal*.test.ts` files in `packages/shared`, `apps/web` and `apps/mobile`. `goalProbes.test.ts` runs the git snapshot and command runner for real. Live model checks are opt-in: `RAMU_REAL_GOALS=1 pnpm exec vitest run test/goals.live.test.ts`.
