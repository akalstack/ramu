# Background chats, schedules, recaps, and reviews

Ramu opens on Home. Chats can start without a project; each gets its own local working directory. Project chats keep their existing checkout or isolated-worktree behavior.

The desktop window connects to a separate background process over a private local socket. Closing or quitting the UI leaves chats, terminals, and schedules running. Reopening reconnects to the same process and stored transcripts. Settings → Background & Recaps can stop the service or enable macOS login startup. The computer must be awake; work does not execute while it is asleep or powered off. Login startup is automatic for packaged macOS builds unless the user disables it. Development builds opt in manually. Logs are in the profile's `background.log`.

While an agent works, Enter and the single Send button use the configured busy-message action (steer or queue). Cmd/Ctrl+Enter uses the other action on providers that support steering; the Send tooltip shows the shortcut. Queued messages retain their own steering action. With an empty message box, Send becomes Stop during a run or Resume after a stopped turn. Attached review comments or pinned file context can be sent without additional text. Review feedback includes the recorded code, current-file status, and the composer's selected file and editor context, even without a typed message.

## Continue after restart

Settings → Background & Recaps → **Continue chats after restart** is on by default, including for existing profiles. When the background service restarts, unfinished chats continue in the same Ramu chat and resume the provider's native conversation where available. Without a native session id, the saved transcript supplies context. Recovery adds a “Continued after restart” separator without duplicating the user's message.

Finished, failed, and manually stopped chats are not automatically started. Explicitly stopping the background service also cancels pending recovery. A normal service shutdown preserves unfinished work for the next launch. Chats sharing a checkout wait for its active writer. Queued messages and their pause state are preserved. Pending approvals and blocking questions from dead processes are cancelled; the provider must ask again. Async questions and their drafts are preserved. Recovery instructs the agent to inspect existing files and results and avoid repeating completed actions.

A chat whose main turn finished while helpers were still working is eligible too. The main agent receives their saved task/progress information and reconciles unfinished work; individual helper processes and isolated worktrees are not automatically reattached. Saved native helper transcripts are recovered before continuation; see the helper recovery section below.

With the setting off, interrupted chats remain available for manual continuation. Reopening only the desktop window reconnects to the live daemon as before; it does not restart or duplicate running chats.

## Schedules

The Schedules sidebar supports Once, Daily, Weekly, Monthly, and intervals of at least five minutes. New schedules obtain their timezone from the OS, without a timezone input. Existing schedules retain their saved timezone so travel or OS changes do not silently shift them. Each schedule stores its timezone, prompt, project or existing isolated workspace, provider settings, and missed-run policy. Preview shows upcoming execution times. Run now leaves the regular recurrence unchanged. Pause cancels queued occurrences and leaves an already-running chat intact.

Calendar schedules preserve local wall-clock time. DST gaps move forward; repeated times run once at the earlier instant. Months missing a chosen day are skipped. During downtime, the latest missed occurrence runs once, or is skipped according to the chosen policy. Occurrences have unique durable keys. Busy checkouts wait, runs do not overlap, and failures before launch retry up to three times. After a daemon restart, an already-launched run continues its existing chat when restart continuation is enabled. It keeps the same occurrence, chat and session; the scheduler does not create a replacement run. With continuation disabled, it is marked interrupted for manual recovery.

Claude and Codex receive an authenticated, session-scoped Ramu MCP connection. The schedule tools expose current time, scope, and settings before creating a schedule. Saved schedules appear as cards in the originating chat. Each execution creates a chat linked from run history. Natural-language dates are interpreted by the agent, so ambiguous requests should be clarified before saving.

## Daily recap

Recaps are enabled by default and can be disabled. Daily timing uses the current OS timezone, ignoring legacy app timezone overrides. Home shows unfinished work, blockers and questions first, meaningful recent outcomes and decisions, then upcoming schedules. Each AI recap item cites a stored conversation event and opens its source chat. Users can mark items done, dismiss them, or snooze them. Refresh preserves these choices and stable item IDs. Daily generation uses changed conversations and outstanding items; manual Refresh rereads recent chats. Recaps stay cached while a new generation runs. Failed generations retry after an hour.

## Composer context

`/` opens commands and discovered skills; selecting a skill inserts its `$skill-name` reference. Skills are found in project/ancestor and user Claude, Codex, and Agents skill folders, including cached Codex plugins. `@` selects files in the current workspace. With automatic tab context enabled, the active file or diff sends its selected text (with line and column ranges) or its content when no text is selected. Other open file and diff tabs send path references only; the agent can read relevant files as needed. Explicit @mentions and dropped files include their full content within the context limits and take priority over automatic tab context. Unsaved editor buffers are used without saving them. Context paths are validated against workspace roots; large content is explicitly marked as truncated.

## Recorded changes and comments

Changed-file summaries below agent turns link to their recorded revision and file. The revision selector preserves historical diffs; a follow-up does not silently rewrite a prior capture. Each run records starting files and a final snapshot. Added and deleted files appear in the diff, and pre-existing edits remain part of the baseline. Binary and large files show metadata rather than a text diff. Changes made by another process during the same interval can also appear; capture does not prove authorship.

Changes stacks file diffs beside a file list. File cards can collapse; large revisions can show one file at a time. Monaco folds unchanged regions and supports inline/split layouts, change navigation, and opening the current file in the editor. Use a line gutter, Comment on selection, the native context menu, or File comment to start a comment. Cmd/Ctrl+Enter saves it. Draft text and saved comments stay local. Edit and delete controls are on each saved comment.

Open chat to return to the conversation. Unsent comments appear as attached comment chips in its composer. Sending the next message sends those comments, their file/line references and before/after code together with your message. Sent comments appear in chat history. The agent is instructed to reread current files because recorded lines may have moved. Current-file checks and comparisons help identify changes made after the recorded run. There is no separate Home review inbox or manual AI-review toolbar in the current UI.

## Verification

Run `pnpm check`, then `pnpm test:e2e` on macOS for the isolated Electron integration journey. It checks native branding, project-free chat, slash/skill/file completion, unsaved buffer context, editor tooling, recap settings, execution with the UI closed, reconnection, comment feedback, undo, injected schedule tools, question workflows, and restart continuation. It uses simulated providers without paid model calls and changes disposable fixtures. Set `RAMU_E2E_APP_DIR` to a copied build directory when another session is rebuilding the workspace during verification. Real model behavior and packaged macOS login startup require live validation. See [RELEASING.md](RELEASING.md) for packaged checks and CI targets.

## Connector input

Codex MCP servers can request a form or a browser-link interaction inside chat. The connector card identifies the server and explains the request. Submit/Continue accepts it, Decline refuses it, and Cancel abandons it. Browser links open only when clicked; accepting a link request does not submit form content.

Forms use the MCP flat-schema subset: strings, bounded numbers/integers, booleans, single choices and arrays of choices. Display titles stay separate from option IDs; the response preserves JSON types. Optional blank fields are omitted, visible defaults remain editable, and required fields must be explicitly present. Schema validation runs before sending; a rejected submission keeps the request pending and shows an error. Unsupported nesting or constraints are cancelled with an explanation rather than ignored. Empty forms can be explicitly accepted.

Native connector requests wait for a protocol reply even when async questions are enabled. Multiple requests can coexist; resolving one does not mark the remaining requests complete. They appear in the pending-question list. Drafts survive app close/reopen. A daemon restart closes the old request and retains its draft as history; a new provider request must be answered separately. Interrupt/stop and server-side resolution close the original request. Native dynamic tool calls are a separate protocol capability and remain unsupported without a registered tool handler.

## Live provider output

Claude main-chat and helper text streams into its existing message row. Completed blocks replace partial text without duplicate bubbles, including when the SDK sends a separate complete frame for each block. Updates are batched at 50 ms; private thinking and partial tool arguments are not imported as streamed chat text.

Codex command output and patch snapshots appear inside existing tool disclosures while they run. Patch notifications replace the previous snapshot, while command deltas append. Completion replaces the live result in the same durable position and clears its running state; streaming output does not release queued steering. Known native helpers use separate tool IDs and tagged output. Completed items override streamed content, retaining buffered output only when the final payload omits it; late output deltas cannot turn completed tools back into running tools.

The collapsed “Changes in this turn” disclosure holds the latest provider diff snapshot. Recorded Changes reviews still provide saved revisions, discussions and file restore history. Command previews retain the last 64,000 characters; patch and turn diff previews retain up to 256,000 characters. Live-provider compatibility still needs validation beyond deterministic protocol fixtures.

## Undo

Undo is available only in chat: choose **Edit** on a sent message, then **Preview restore**. It uses Ramu's recorded-file engine for Claude, Codex, and other providers, including a chat that changes models or providers. Claude's native checkpoint API is deliberately not used: it does not cover every tool/helper edit, and Codex's conversation rollback does not restore files. One engine keeps restoration consistent across fallback routes. See the [Claude checkpoint documentation](https://code.claude.com/docs/en/agent-sdk/file-checkpointing) and [Codex app-server protocol](https://developers.openai.com/codex/app-server).

The preview combines file changes from the selected message's captured run and later runs in the same chat. Restore selected files, then send the revised message. History and recorded revisions remain available; this is a file restore, not deletion of conversation history. The revised request tells the agent that earlier tool results are historical and whether files were restored. A message steered into an existing capture has no independent file snapshot: choose that run's first user message instead. Unfinished or interrupted captures cannot provide a complete restore preview.

Preview restore compares the original before/after snapshots against current files. A clean three-way reverse merge preserves nonoverlapping later edits. Overlapping edits, modified added files, replacement files, symlinks, binary files, and large files are skipped. Files with unrecorded edits between runs, or partially undone ranges, require manual review. Select eligible files, inspect the proposed diff, then apply. Save or close unsaved editor buffers first. Previews expire after ten minutes; the chat and the entire file selection are checked again before writing. Workspace agents and app writes are reserved during undo. External programs can still modify files, so close competing writers before applying.

Undo retains the original review and private recovery journals in the profile's reviews/undo directory. A failed apply attempts to restore previously applied files only when they have not changed again. A restart detects interrupted journals and reports their location for manual inspection; it never overwrites files automatically during recovery.

## Helper transcript recovery

After a daemon restart, Ramu reads Claude's saved sub-agent messages and Codex's stored helper threads before automatically continuing the main chat. Existing output is merged by message/tool identity, preserving its original position. Repeated boots do not append the same transcript again. Interrupted streamed helper text is replaced by its saved completed block when the native message identity and text prefix match. Recovered helper evidence is included in the main chat's recovery instruction so it can reconcile work before replacing a helper.

Recovery also runs when automatic chat continuation is off. It reads history without starting helper turns or replaying tools. Provider-confirmed terminal states are retained; a helper whose old process was interrupted is stopped, and its old Stop/message controls are disabled. Claude's saved messages alone do not establish completion, so existing lifecycle state is preserved and formerly running helpers are marked stopped. If provider history is missing, the panel retains locally received output and explains the recovery failure. Managed cross-provider helpers already have stored Ramu transcripts; they are excluded from native-provider reads.

Recovery enumerates the main chat's current and historical provider sessions from its saved init/settings events, including sessions before fallback. Each helper is assigned to the session where it first appeared, so a recovered card updated after a switch does not move to the new provider. Helpers discovered only in saved provider history retain their original provider/session on the recovered card, so later boots keep reading the correct history. Repeated init events do not cause duplicate reads. A failure in one provider session leaves other histories recoverable. New init events store their provider explicitly; older events use the first recorded switch’s previous settings when available. Logs without enough provider ownership evidence cannot establish an earlier provider reliably. Provider-specific helper continuation remains follow-up work. Deterministic SDK and wire fixtures validate recovery; installed live-provider transcript compatibility still needs a live check.

## Questions while work continues

Settings → Background & Recaps → **Keep working while asking questions** is on by default, including for existing profiles. Claude and Codex receive Ramu's `ask_user`, `question_status`, `wait_for_answer`, and `close_question` tools through their scoped MCP connection. Codex's native async question messages are also displayed. Native blocking questions and permission approvals still wait for their reply.

The agent chooses **together** for related questions whose answers must be used as one decision; that group sends only when every question is answered. **Independent** questions allow each answer to be submitted separately. Stable question IDs distinguish even identical question wording. Choices and typed answers are supported. Each group may explain what work needs its answers. The chat header lists pending groups and links to their cards.

The question tool returns immediately so independent work can continue. When dependent work is reached, the agent checks the submitted answers and waits if necessary. That dependency is declared by the agent; Ramu does not infer a dependency graph from arbitrary code. Turning the setting off makes new Ramu question-tool calls wait for answers. Existing requests retain their delivery mode; the launch instructions also tell Codex to use blocking questions when the setting is off.

Answers reach the active chat through its durable steering queue, or continue the same conversation in another turn if the earlier work has finished. When an agent is explicitly waiting, the answers return through the waiting tool instead of creating a duplicate user message. Late answers instruct the agent to assess relevance and explain any needed changes. Busy shared checkouts retain the queued reply until they are available.

Pending async questions, submitted partial answers, and unsent drafts survive closing the window and daemon restart. Drafts are private UI state and are excluded from agent tool results and restart instructions. Recovery reuses pending request IDs instead of cancelling or asking the questions again. Blocking questions from dead processes are cancelled and must be asked again. A stopped dependency wait is cancelled, but its async question remains available for a later answer.

Unanswered async questions do not expire or acquire assumed answers when a turn finishes. The user may dismiss a group without sending an answer. The agent may mark an obsolete group **No longer needed**, with a reason; closing a question never supplies an answer or authorizes a permission. This is distinct from quote/asides, which are questions the user asks a separate read-only agent.

Validation: question lifecycle tests in `test/agent.test.ts`, native Codex wire replay in `test/codex.test.ts`, and the desktop smoke journey exercise both providers' MCP tools, grouped submission, independent replies, draft restoration, dismissal, and the disabled setting. These are deterministic adapters/transport tests; real-model compliance with dependency instructions still requires live provider validation.
