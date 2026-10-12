# Goals

Ramu keeps a chat working toward the user's requested outcome across agent turns. Goals belong to Ramu, work across providers and fallback, and are saved in the chat's event history.

## Settings

Open **Settings → Goals**:

- **Goal detection:** Auto (default) lets the working agent identify a goal at the start or later in the conversation. Manual requires `/goal <objective>`. Off disables automatic continuation and new goals.
- **Maximum continuation turns:** 10 by default. Choose a preset, enter a custom limit from 1 to 1000, or select Unlimited. Only automatic follow-up turns count; initial work and user messages do not. A quota retry resumes the interrupted turn without consuming another turn.
- Changes apply to existing goals. Raising the cap or choosing Unlimited reactivates a goal that reached its limit. Resuming a goal at its turn limit allows another batch.

Unlimited removes the continuation cap. It still respects completion, blockers, required input and user pause/Stop. Exhausted provider usage waits for availability and retries automatically, including after background-service restart.

## Chat controls

The goal bar shows the objective, latest progress or blocker, continuation count, and next availability check when waiting. Use Pause goal, Resume goal or Clear goal. Stop also pauses the goal. Pausing the goal prevents future automatic turns; use Stop to interrupt work already running.

Commands are handled by Ramu rather than forwarded to a provider:

```text
/goal Implement login and verify the authentication tests
/goal
/goal pause
/goal resume
/goal clear
```

An existing chat can set a goal while working. Ramu queues the updated objective so the working agent receives it. `/goal` without arguments leaves the current goal visible in the bar.

## Completion and continuation

The working agent receives instructions to identify actionable goals and audit all user requirements before ending a turn. Questions, brainstorming and plan-only discussion should not become goals. The agent reports through the provider-neutral `set_goal`, `get_goal` and `update_goal` tools. It reports concrete evidence when complete, remaining work while active, or the missing input/obstacle when blocked.

There is no separate periodic AI judge. After a turn ends, an active goal starts another turn containing its objective and progress plus an explicit completion audit. This also covers an agent that forgot to report completion. Automatic detection and evidence assessment depend on the working model following those instructions.

Queued user input takes priority. Ramu waits for required approvals/answers, running helpers, change snapshots, and other writers in the same workspace. User controls and Stop win over pending automatic dispatch. Completed goals stop; blocked goals can be resumed explicitly or by a user reply.

Usage failures first use the chat's existing fallback policy. If fallback is disabled or exhausted, the goal enters Waiting for provider. Stored usage readings and reset times determine availability without inference. Unknown reset times retry with exponential backoff from one minute up to fifteen minutes. Waiting timers inspect availability at most once a minute; fresh availability or a fallback provider's reset can release the wait early. Authentication errors and other failures require intervention rather than quota retries.

## Verification

`test/goals.test.ts` covers limits, unlimited continuation, lifecycle controls, user-message priority, quota waiting, reset detection and durable state. After building, run `node scripts/goals-smoke.mjs` to check the real Electron settings and MCP tools with a temporary profile and fake providers, without model calls. UI evidence is written to `output/playwright/goals/`.
