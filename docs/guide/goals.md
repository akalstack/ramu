# Goals

A goal keeps a thread working toward an objective across turns, even when the provider changes.

```text
/goal Implement login and test authentication
/goal pause
/goal resume
/goal clear
```

The goal bar has Pause, Resume and Clear. **Stop** interrupts the current turn and pauses the goal. A met goal stays in the transcript as **Goal completed**. In a project with a repository, **Deploy…** under it opens the project's [Deploy sheet](deploy.md#set-up-a-platform).

## Settings

**Settings → Goals & delegation**:

- **Automatic goals** (on): agents create goals for work that needs more turns. Turn it off to use `/goal` yourself.
- **Maximum continuation turns** (10): 1 to 1000, or unlimited. Your own messages don't count.

## Verification command

Give a goal a command Ramu runs when the agent says it's done. Only you can set it.

```text
/goal Login works and tests pass
verify: pnpm --filter @ramu/server test
```

`/goal verify: <command>` changes it and `/goal verify: off` removes it. A pass completes the goal. A failure sends the output back to the agent once.

## How completion is checked

The agent must report the checks it ran and the files it changed, and Ramu compares those files with the repository. Missing checks, a failed check or an unreported change rejects the claim, and the agent keeps working.

When two continuations in a row change nothing, the goal stops as **No progress** instead of spending the remaining turns. A message from you or **Resume** starts it again.

## Paused or waiting

**Goal paused** means you paused it. It never resumes by itself. **Limit reached · resumes …** means a provider limit. The goal continues at the reset, unless auto-resume is off.
