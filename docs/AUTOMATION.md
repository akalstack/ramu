# Background work

The desktop app connects to a local service that owns threads, terminals, and schedules. Closing the window leaves them running. Reopening reconnects to stored state.

The computer must stay awake. **Settings → Background & Recaps** controls the service and macOS login startup. Packaged macOS builds enable login startup unless disabled; development builds opt in. Logs are in the profile's `background.log`.

## Messages and questions

While an agent works, Enter uses the configured Steer or Queue action. Cmd/Ctrl+Enter uses the other action where steering is supported. Steer waits for current tools; Queue waits for the turn.

Claude and Codex can ask questions while continuing independent work. Related questions send together; independent questions can send separately. Work that needs an answer waits. Approvals and native blocking questions still block.

Async questions and drafts survive reopening and service restarts. A dead process's blocking questions and approvals must be requested again. Dismissal and **No longer needed** close questions without supplying an answer.

## Restart recovery

**Continue threads after restart** is on by default. Unfinished threads resume their native provider session where available, otherwise use the stored transcript. Finished, failed, and manually stopped threads stay stopped.

Threads sharing a checkout wait for the active writer. Queued messages and pause state persist. Explicitly stopping the service cancels pending recovery. Saved helper transcripts help the main agent reconcile work; helper processes are not all reattached.

## Schedules and recaps

Schedules support Once, Daily, Weekly, Monthly, and intervals of at least five minutes. They capture the system timezone when created. Existing schedules keep that timezone; calendar schedules preserve local time across daylight-saving changes. Missing monthly dates are skipped.

**Run now** does not change the recurrence. Pause cancels queued runs, not work already running. Missed runs either execute the latest occurrence once or skip it. Busy checkouts wait and scheduled runs do not overlap.

Recaps summarize recent threads and unfinished work. Home shows the ones that need your attention; **Inbox → Recaps** lists everything since your last visit and earlier. Items link to their source conversation and can be marked done, dismissed, or snoozed. Recaps use model tokens, but only when a thread's recent activity or the recap model changed since the last successful recap; otherwise the daily run just shows up to date. **Refresh** always asks the model unless there is no activity to summarize. Their daily time follows the current system timezone.

## File context

`/` opens commands and discovered skills. `@` selects workspace files. Automatic tab context includes the active file or selection, using unsaved text; other tabs supply path references. Explicit mentions and dropped files take priority. Large content is marked when truncated.

## Reviews and undo

Changed-file summaries open recorded diffs. Each run captures a starting and final state; edits by another process during that interval can also appear. Binary and large files show metadata instead of text diffs.

Add file or line comments in Changes. Drafts and comments stay local until sent with a thread message. Feedback includes recorded code and current-file context so the agent can check lines that have moved.

Use **Undo** on a changed-file summary, or **Edit → Preview restore** on a sent message. Select files and review the proposed diff before applying. Thread history is retained. Clean reverse merges preserve nonoverlapping later edits; conflicts, replacement files, symlinks, binary files, and large files can be skipped.

Save or close unsaved buffers first. Restore previews expire after ten minutes and files are checked again before writing. Private recovery journals remain in the profile's `reviews/undo` directory. Interrupted restores require manual review.

## Connector requests and live output

Connector forms and browser-link requests appear in the thread with Submit, Decline, and Cancel controls. Links open only when clicked. Forms validate before sending; unsupported fields produce an explanation. Native requests wait for a protocol reply, even with async questions enabled.

Provider text and command output update existing rows while running. Completed results replace live output. The change summary records saved revisions separately from live patch previews.

## Checks

Run `pnpm check`, then `pnpm test:e2e` on macOS. The Electron journey uses an isolated profile and simulated providers. Live provider behavior and installed login startup need separate validation.
