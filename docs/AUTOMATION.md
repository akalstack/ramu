# Background work

The desktop app connects to a local service that owns threads, terminals, and schedules. Closing the window leaves them running. Reopening reconnects to stored state.

The host must stay awake. **Settings → Background & updates** controls the service, macOS login startup and daily recaps. Packaged macOS builds enable login startup unless disabled; development builds opt in. Logs are in the profile's `background.log`.

## Messages and questions

While an agent works, Enter uses the configured Steer or Queue action. Cmd/Ctrl+Enter uses the other action where steering is supported. Steer waits for current tools; Queue waits for the turn.

Claude and Codex can ask questions while continuing independent work. Related questions send together; independent questions can send separately. Work that needs an answer waits. Approvals and native blocking questions still block.

Async questions and drafts survive reopening and service restarts. A dead process's blocking questions and approvals must be requested again. Dismissal and **No longer needed** close questions without supplying an answer.

## Restart recovery

**Continue threads after restart** is on by default. Unfinished threads resume their native provider session where available, otherwise use the stored transcript. Finished, failed, and manually stopped threads stay stopped.

**Trim long Claude threads before they go cold** is off by default. When a Claude thread with at least 200,000 tokens of context sits idle until a minute before its prompt cache lapses, Ramu runs one `/compact` turn so the next message re-reads a short summary instead of the whole thread. The cache lifetime follows Claude Code's [rules](https://code.claude.com/docs/en/prompt-caching#which-ttl-each-request-gets): one hour for a Claude subscription within its plan usage, five minutes on usage credits, an API key or a cloud provider, and `CLAUDE_CODE_PROMPT_CACHE_TTL`, `ENABLE_PROMPT_CACHING_1H` and `FORCE_PROMPT_CACHING_5M` override that. Ramu does not read Claude's `promptCacheTtl` setting. It skips threads with queued messages or running background tasks, and any thread you resume first.

Threads sharing a checkout wait for the active writer. Queued messages and pause state persist. Explicitly stopping the service cancels pending recovery. Saved sub-agent transcripts help the main agent reconcile work; sub-agent processes are not all reattached.

## Schedules and recaps

Schedules support Once, Daily, Weekly, Monthly, and intervals of at least five minutes. They capture the system timezone when created. Existing schedules keep that timezone; calendar schedules preserve local time across daylight-saving changes. Missing monthly dates are skipped.

Each run records how it ended, from the thread's final state and its last error rather than from idleness alone:

| Outcome | Meaning |
| --- | --- |
| completed | Succeeded: the thread went idle with no unanswered error and its goal, if any, is finished. |
| failed | The thread failed or its last result was an error. The run keeps that error. A start that fails three times also fails the run. |
| needs-input | The agent asked a question or needs approval, or its goal is blocked or out of turns. |
| cancelled | You stopped the thread. |
| interrupted | A restart cut it off, or a usage limit was reached with auto-resume off. |
| missed | Skipped or cancelled before it started. |

A thread that is idle between goal continuations, has messages queued, or waits for a usage limit to reset is still running, and a limit's own error never counts as a failure. Automation shows each run's outcome and error under **Recent runs**.

**Three failed runs in a row pause the schedule**, with the reason and the last error on its card, so a broken task stops spending tokens until someone looks. A success breaks the count; cancelled, interrupted, missed and needs-input runs neither add to it nor reset it. Resume, or edit the schedule, to start counting again.

**Run now** does not change the recurrence. Pause cancels queued runs, not work already running. Missed runs either execute the latest occurrence once or skip it. Busy checkouts wait and scheduled runs do not overlap.

Recaps summarize recent threads and unfinished work. Home shows the ones that need your attention; **Inbox → Recaps** lists everything since your last visit and earlier, with **Refresh**. Items link to their source conversation and can be marked done, dismissed, or snoozed (in 3 hours, tomorrow morning, or next week). A toast with **Undo** follows each action, which puts the item back. Recaps use model tokens, but only when a thread's recent activity or the recap model changed since the last successful recap; otherwise the daily run just shows up to date. **Refresh** always asks the model unless there is no activity to summarize. Their daily time follows the current system timezone. A phone that switched on **Settings → Notifications → Daily recap** gets one generic push ("Your daily recap is ready.", no content) per local day when the scheduled run produces items, never for a manual **Refresh**; it is off by default. A scheduled run that fails to start three times in a row (no thread ever exists) pushes the **scheduled** category once, and the phone opens the Schedules tab. Mobile recap cards swipe for Done, Snooze and Dismiss with the same durations and Undo.

## File context

`/` opens commands and discovered skills. `@` selects workspace files. Automatic tab context includes the active file or selection, using unsaved text; other tabs supply path references. Explicit mentions and dropped files take priority. Large content is marked when truncated.

## Reviews and undo

Changed-file summaries open recorded diffs. Each run captures a starting and final state; edits by another process during that interval can also appear. Binary and large files show metadata instead of text diffs.

Add file or line comments in Changes. Drafts and comments stay local until sent with a thread message. Feedback includes recorded code and current-file context so the agent can check lines that have moved.

Use **Undo** on a changed-file summary, or **Edit → Preview restore** on a sent message. Select files and review the proposed diff before applying. Thread history is retained. Clean reverse merges preserve nonoverlapping later edits; conflicts, replacement files, symlinks, binary files, and large files can be skipped.

Save or close unsaved buffers first. Restore previews expire after ten minutes and files are checked again before writing. Private recovery journals remain in the profile's `reviews/undo` directory. Interrupted restores require manual review.

## Agent questions

Ramu’s `ask_user` supports both suggested choices and free-text-only questions. For an open-ended question, omit `options` or send `options: []`; the user sees a text field and must explicitly submit a non-empty answer. Draft text and a blank response do not count as an answer.

With async questions enabled, agents may continue independent work while a question is pending, but must wait before work that depends on the answer. `blocking: true` makes the tool wait immediately; disabling async questions makes every `ask_user` request wait. Dismissal or cancellation supplies no answer.

## Connector requests and live output

Connector forms and browser-link requests appear in the thread with Submit, Decline, and Cancel controls. Links open only when clicked. Forms validate before sending; unsupported fields produce an explanation. Native requests wait for a protocol reply, even with async questions enabled.

Provider text and command output update existing rows while running. Completed results replace live output. The change summary records saved revisions separately from live patch previews.

## Tests

Cover automation behavior with focused unit or integration tests; live provider behavior and installed login startup need manual validation.
