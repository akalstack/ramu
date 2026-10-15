# Goals

Goals keep a chat working toward an objective across turns. They persist with the chat and follow provider changes.

## Settings

In **Settings → Goals**:

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

## Continuation

The working agent reports progress and completion. Active goals continue after a turn ends. User messages, required answers, approvals, and workspace writers take priority. Completed goals stop; blocked goals need user input or an explicit resume.

Usage failures try the chat's fallback list first. If no provider is available, the goal waits for a reset and retries. Unknown reset times retry with increasing delays, up to 15 minutes. Authentication errors require intervention.

Goal detection depends on the model following its instructions. Creating a goal does not grant permission for additional work.

## Checks

`apps/server/test/goals.test.ts` covers lifecycle, limits, waiting, and persistence. After building, run `node scripts/smoke/goals-smoke.mjs` for isolated Electron checks. Live model checks are opt-in: `RAMU_REAL_GOALS=1 pnpm exec vitest run test/goals.live.test.ts`.
