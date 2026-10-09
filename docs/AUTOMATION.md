# Background chats, schedules, recaps, and reviews

Ramu opens on Home. Chats can start without a project; each gets its own local working directory. Project chats keep their existing checkout or isolated-worktree behavior.

The desktop window connects to a separate background process over a private local socket. Closing or quitting the UI leaves chats, terminals, and schedules running. Reopening reconnects to the same process and stored transcripts. Settings → Background & Recaps can stop the service or enable macOS login startup. The computer must be awake; work does not execute while it is asleep or powered off. Login startup is automatic for packaged macOS builds unless the user disables it. Development builds opt in manually. Logs are in the profile's `background.log`.

## Schedules

The Schedules sidebar supports Once, Daily, Weekly, Monthly, and intervals of at least five minutes. New schedules obtain their timezone from the OS, without a timezone input. Existing schedules retain their saved timezone so travel or OS changes do not silently shift them. Each schedule stores its timezone, prompt, project or existing isolated workspace, provider settings, and missed-run policy. Preview shows upcoming execution times. Run now leaves the regular recurrence unchanged. Pause cancels queued occurrences and leaves an already-running chat intact.

Calendar schedules preserve local wall-clock time. DST gaps move forward; repeated times run once at the earlier instant. Months missing a chosen day are skipped. During downtime, the latest missed occurrence runs once, or is skipped according to the chosen policy. Occurrences have unique durable keys. Busy checkouts wait, runs do not overlap, and failures before launch retry up to three times. After a daemon crash, an already-launched run is marked interrupted and is never automatically replayed.

Claude and Codex receive an authenticated, session-scoped Ramu MCP connection. The schedule tools expose current time, scope, and settings before creating a schedule. Saved schedules appear as cards in the originating chat. Each execution creates a chat linked from run history. Natural-language dates are interpreted by the agent, so ambiguous requests should be clarified before saving.

## Daily recap

Recaps are enabled by default and can be disabled. Daily timing uses the current OS timezone, ignoring legacy app timezone overrides. Home shows unfinished work, blockers and questions first, meaningful recent outcomes and decisions, then upcoming schedules. Each AI recap item cites a stored conversation event and opens its source chat. Users can mark items done, dismiss them, or snooze them. Refresh preserves these choices and stable item IDs. Daily generation uses changed conversations and outstanding items; manual Refresh rereads recent chats. Recaps stay cached while a new generation runs. Failed generations retry after an hour.

## Composer context

`/` opens commands and discovered skills; selecting a skill inserts its `$skill-name` reference. Skills are found in project/ancestor and user Claude, Codex, and Agents skill folders, including cached Codex plugins. `@` selects files in the current workspace. With automatic tab context enabled, the active file or diff sends its selected text (with line and column ranges) or its content when no text is selected. Other open file and diff tabs send path references only; the agent can read relevant files as needed. Explicit @mentions and dropped files include their full content within the context limits and take priority over automatic tab context. Unsaved editor buffers are used without saving them. Context paths are validated against workspace roots; large content is explicitly marked as truncated.

## Recorded changes and comments

Changed-file summaries below agent turns link to their recorded revision and file. The revision selector preserves historical diffs and undo; a follow-up does not silently rewrite a prior capture. Each run records starting files and a final snapshot. Added and deleted files appear in the diff, and pre-existing edits remain part of the baseline. Binary and large files show metadata rather than a text diff. Changes made by another process during the same interval can also appear; capture does not prove authorship.

Changes stacks file diffs beside a file list. File cards can collapse; large revisions can show one file at a time. Monaco folds unchanged regions and supports inline/split layouts, change navigation, and opening the current file in the editor. Use a line gutter, Comment on selection, the native context menu, or File comment to start a comment. Cmd/Ctrl+Enter saves it. Draft text and saved comments stay local. Edit and delete controls are on each saved comment.

Open chat to return to the conversation. Unsent comments appear as attached comment chips in its composer. Sending the next message sends those comments, their file/line references and before/after code together with your message. Sent comments appear in chat history. The agent is instructed to reread current files because recorded lines may have moved. Current-file checks and comparisons help identify changes made after the recorded run. There is no separate Home review inbox or manual AI-review toolbar in the current UI.

## Verification

Run `pnpm check`, then `pnpm test:e2e` on macOS for the isolated Electron integration journey. It checks native branding, project-free chat, slash/skill/file completion, unsaved buffer context, editor tooling, recap settings, execution with the UI closed, reconnection, comment feedback, undo and injected schedule tools. It uses simulated providers without paid model calls and changes disposable fixtures. Real model behavior and packaged macOS login startup require live validation. See [RELEASING.md](RELEASING.md) for packaged checks and CI targets.

## Undo

Undo is available under More in a recorded revision.

Preview undo compares the original before/after snapshots against current files. A clean three-way reverse merge preserves nonoverlapping later edits. Overlapping edits, modified added files, replacement files, symlinks, binary files, and large files are skipped. Select eligible files, inspect the proposed diff, then apply. Save or close unsaved editor buffers first. Previews expire after ten minutes and the entire selection is checked again before writing. Workspace agents and app writes are reserved during undo. External programs can still modify files, so close competing writers before applying.

Undo retains the original review and private recovery journals in the profile's reviews/undo directory. A failed apply attempts to restore previously applied files only when they have not changed again. A restart detects interrupted journals and reports their location for manual inspection; it never overwrites files automatically during recovery.
