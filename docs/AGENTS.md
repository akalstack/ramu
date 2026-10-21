# Agents and routing

## Changing models while working

Selecting a model from the dropdown during a running turn starts a five-second countdown. **Apply now** switches immediately; **Cancel** restores the currently applied model and reasoning effort. Adjusting reasoning while a model change is pending keeps the original deadline and applies the latest effort with that model. Selecting a model through the slider still commits on release. Idle threads keep their existing selection behavior, and a pending countdown is cancelled if the turn stops running.

Before applying a change, the server checks the provider adapter and the live runner's negotiated capabilities. Supported changes restart the process and resume its native conversation, preserving process-bound tools and access settings; the transcript says **Settings changed**. A provider that needs a fresh session receives a budgeted **Context handoff**, even when the provider and account stay the same. A rejected change leaves the current settings and process intact. Usage-limit fallback uses the same check and skips rejected targets. ACP runners check the session's model list and advertised resume/load support before the old process stops; recovery still handles sessions that disappear after preflight.

Moving from a larger context window to a smaller one uses the destination model's capacity. If the native history leaves enough room, the session resumes; otherwise Ramu starts a fresh native session and compacts a handoff from the saved thread record. The same rule checks a returning provider's saved session plus its delta. Provider-reported model capacities and observed context windows are saved on the execution server per provider, account and model. A model change with unknown capacity or unknown current usage uses a fresh handoff rather than assuming the outgoing model's window applies. Capacity estimates cannot guarantee acceptance by a provider that does not expose its actual limits.

## MCP connections

In a thread, **/mcp** opens connection status without sending a prompt or stopping the agent. Claude and OpenCode expose live server states, with **Refresh** and per-server **Reconnect** for failed or unauthenticated connections. Codex reads its thread-scoped MCP inventory and offers **Reload MCP servers**, which takes effect on the next turn. Tool counts appear when the provider supplies them; a cached catalog alone is not treated as a verified connection. Authenticate in the selected provider when required. Cursor and ACP runtimes show the workspace configuration Ramu supplied, explicitly labelled as configuration when no live status API exists. A runtime without HTTP MCP support marks remote servers as unsupported while still receiving supported stdio servers. If the thread has no active provider process, the dialog labels its startup snapshot as last reported.

A workspace does not need its own MCP configuration. Every provider merges `.mcp.json` from covered repositories, including original project and repository directories behind isolated workspaces. Claude-local MCP entries for those repository directories are shared across providers: Claude reads the selected Claude account's `.claude.json`, while other providers import repository entries from the host's default Claude configuration. Global Claude-only MCP entries and unrelated projects are not imported; each provider retains its own model login. The current checkout wins repository-file conflicts; local definitions take precedence over repository files. Unrelated projects and unselected Claude accounts are excluded, and Ramu's own server name is reserved.

Claude gets up to 60 seconds for MCP startup and waits up to 60 seconds before its first turn for pending servers. Explicit host `MCP_TIMEOUT` and `CLAUDE_CODE_MCP_STARTUP_WAIT_MS` values are preserved. Imported Codex and OpenCode servers also get a 60-second startup budget unless their definition sets a different budget. Cursor and ACP retain their runtime connection policies. Pending connections remain distinct from failures in **/mcp**. Configuration changes apply to the next provider launch.

## Rules

**Settings → Agent setup → Rules** holds the person's own instructions for agents. Enabled **Always** rules reach each new thread in a separately labelled section that says they never grant permissions. The budget is 24,000 characters (names plus text) per scope: what one thread can receive, host-wide rules plus its project's. A save that would exceed it is refused, never trimmed; a host-wide rule is checked against every project. Settings shows each rule's estimated token cost and, per scope, the estimated cost against the budget (about four characters per token, ignoring provider choices, so an upper bound).

Rules are additive. When two enabled rules could reach the same thread (overlapping project and provider) and have identical text, ignoring whitespace, or the same name, ignoring case, both rows and the editor show a warning naming the other rule. Ramu does not pick one or merge them.

## Thread titles

A new thread immediately shows its opening-message title. The execution server schedules one isolated naming request after the first main-thread user message is recorded, including mobile and API starts; closing a client does not cancel it. Titles describe the durable task and intended outcome in the first message's language. User messages and relevant replies are bounded; helper/advisor output and tool results are excluded. The naming prompt forbids following links or invoking skills just to discover a subject; provider-boundary acceptance remains in the title plan.

**Rename** is authoritative. **Rename with AI** explicitly generates from the conversation and previous title, including a manual name. A later manual edit or newer regeneration wins over older work. Once a useful automatic title is accepted it stays stable; a vague opening may receive one refinement after a completed reply supplies context. Thread titles never rename Git branches, working directories or workspace labels.

The existing title action shows **Naming thread** while pending and **Retry title generation** after failure, synchronized across clients. A failed or limited request keeps the current usable name. Each running attempt has a 15-second deadline; title work shares a two-request concurrency limit and never waits for quota resets. Pending work receives at most one retry after a server restart; settled failures require an explicit retry. The server can accept a title a provider session supplies on its own, ahead of the fallback, without a second inference call; no provider is enabled for this until a live session verifies it. For a verified provider, the bounded title wait keeps its original deadline, root session and title revision across restart. Repeated events do not extend it; rename, a newer root session or an accepted title invalidates the wait. Transition to fallback stores the generation receipt atomically. See [remaining title work](THREAD-TITLES-PLAN.md).

## Sub-agents

Sub-agent cards show task progress and transcripts. Open a card to inspect its work, send a message, or stop it. Stopping the main thread stops its sub-agents.

Ramu can route sub-agents to another provider or model. **Native** uses the provider's own sub-agents. Type rules override general routing. Codex's optional hook routes sub-agents before they start; enabling it adds a trust entry to `~/.codex/config.toml`.

An isolated sub-agent uses a separate checkout and applies its changes back when finished. Conflicting patches remain in the checkout for review. The tracked-change snapshot excludes untracked files; isolated sub-agents do not support follow-up messages.

Already-running native sub-agents keep their provider. After a service restart, Ramu reads saved sub-agent transcripts so the main agent can reconcile unfinished work; it does not reattach every sub-agent process.

## Usage limits and fallback

**Settings → Models → Provider fallback** holds one list of provider and model pairs, best first. The default is Claude Code, then Codex. Fallback chooses the highest model on the list that has room:

- When its model reaches the limit, the thread moves to the highest model in the fallback order that has room. Unavailable or limited entries are skipped. The default switch point is **Only at the limit**; 80%, 90%, and 95% thresholds switch earlier.
- New threads and automatically switched threads keep their current model while it has room. A higher model becoming available does not trigger another switch.
- The same rule applies to manual choices and models outside the list, including after a service restart.
- The composer's usage chip shows where the next message goes. Use it to keep the current model for one message or for the thread.

Background work such as titles, recaps, and commit messages keeps its model until that model reaches its limit.

Fallback requires installed, authenticated providers. It carries visible conversation context into the same thread; private provider reasoning is not transferred. Usage readings can be delayed or unavailable. Authentication errors and tool failures do not trigger usage fallback.

Sub-agents can use the main list or their own list and threshold. Sub-agents only move down the list when they reach a limit, so task-type routing is kept.

### When every provider is limited

If the thread's provider and every fallback are at their limit, the thread goes idle with a **Limit reached · resumes around …** notice instead of failing. A clock replaces the thread's status in the sidebar, and Inbox lists it under **Running** with the expected resume time. It keeps working in the background, so closing the window does not cancel it:

- **Messages still go through.** Anything you send or queue while limited is kept in the thread's queue, and nothing reaches a provider yet.
- **It resumes by itself.** Ramu rechecks when a reset is known, or backs off from one minute up to 15 minutes when it is not. Queued messages are then sent together as one request; with nothing queued, the unfinished request continues.
- **It survives a service restart**, and a goal waiting on the same limit continues with it.
- **You can cancel it.** Stopping or interrupting the thread ends the wait.
- **It is never a failed turn.** A limit is a pause, not an error. With **Wait on this model** (or fallback off) the thread waits on the same provider; a goal waits the same way. A 429 whose retries ran out counts as a limit. A message that only looks like a limit (a bare "rate limit" or 429) gets one quiet retry before the thread is held, and an error that is not about usage, such as "prompt is too long", stays an ordinary error.
- **Threads on one limit wait together.** Waits are keyed by provider login. Threads on the same login share one timer and one availability check, and resume with a small random spread so they do not all trip the limit again at once.
- **Helpers wait too.** A sub-agent that reaches a limit with nowhere to go waits with its login instead of failing; its card stays running and says it is waiting. Background work nobody is blocked on (the advisor, change reviews, learning, scheduled recaps) waits out the limit for up to 45 minutes and retries. Titles, commit messages and Aside replies report the limit at once, with the reset time when it is known.
- **Scheduled runs** that hit a limit stay *running* in the schedule's history and continue after the reset; they are never marked failed or completed while they wait.

### Auto-resume

Whether a limited thread continues by itself is **auto-resume**: the thread's own choice (`agent.setAutoResume`), otherwise the global default `fallback.autoResume`, which is on. The global value is read live, so changing it reaches threads that are already waiting. Sub-agents and the advisor follow their parent's effective value; a schedule's settings may carry their own.

With auto-resume off the wait is still recorded and shown, no retry timer runs, and messages typed meanwhile stay queued. When a known reset passes, the thread records that it announced it (`resetNotifiedAt`) and a push notification says the thread can be resumed; this happens once, also across restarts. A reset time that is only a guess never notifies. **Try again** (`agent.retryLimitNow`) works with auto-resume on or off: it re-reads usage and sends the continuation only if a reading shows room, or the provider has no reading of its own (a reading Ramu inferred from a limit notice never blocks it). Otherwise the thread stays in the wait with the updated reset time and no failed turn. Resuming a waiting goal clears the wait and tries at once.

Reset times come from the provider's reading, else from the notice itself ("in 2 hours", "resets at 5pm", "17:00 UTC", an ISO time, with the zone the provider reports and the host's otherwise). When no reset is known the wait is marked *guessed* and the thread backs off one to 15 minutes.

### Carrying the conversation to another provider

A switch, a lost native session and a rewind all start a provider session that has not seen the conversation. Ramu builds the handoff from the thread's own event log, with no model call, and sends it inside a `<ramu-handoff>` block, apart from the user's request (`Next request: …`). The block holds a frame that names the cause (limit, switch, account change, a session the host could not resume, a rewind), a state block (latest request and whether the turn finished, last reply, open questions and approvals, queued messages, helpers, files changed, the last failing tool result, and the goal for providers that do not receive session guidance), the checkpoint if one is valid and labelled historical, and the transcript.

- **Compaction is tiered and says what it dropped.** User messages, questions, answers and approvals are never cut, and the most recent turn is kept whole. Old tool results shorten first, then old tool calls and assistant text, then are dropped. Each dropped run becomes a line with its event range, count and a `session_recall` `startSeq` to read it.
- **A provider the thread used before resumes its own session** and gets only the events it has not seen. If it cannot resume, the thread falls back to a full handoff. This covers Codex, OpenCode, Cursor and Antigravity, whose runners recover from a lost session; Claude Code always gets a full handoff until its own recovery path is verified against the SDK. Native session ids are kept per provider login with the last event each saw; a rewind forgets them all.
- **The checkpoint is sent once**, in the handoff, not also in the session guidance. Near a limit it is refreshed ahead of time (see [Learning](LEARNING.md#checkpoint-refresh-near-a-limit)); the handoff only reads what is saved and never waits for a model.
- **The budget follows the target.** Handoff text is conservatively charged at one token per UTF-8 byte, with an allowance of a quarter of the destination window, capped at 400,000 bytes and with no minimum that could exceed a small model's capacity. Unknown windows use a 128,000-token estimate (32,000 bytes for history). The rest is reserved for instructions, the next request, attachments and subsequent output; launch reduces the allowance further for large input. Preflight's destination window is retained on the handoff event so launch cannot enlarge it using stale source-model telemetry. A conversation that still does not fit is never silently truncated: a model switch is refused before stopping the live session, a limit fallback skips that model (and holds the thread at its limit, with the reason, if nothing else is left), and a launch that cannot be carried fails with a clear error. The latest request and original user requirements stay intact; compacted evidence can be recovered with `session_recall`.
- **The transcript records it.** The `settings` event keeps what was carried (`handoffInfo`: cause, full or delta, first and last event, size, events dropped or shortened, and the checkpoint boundary when used). **New events only** means a delta into a returning native session. A full-history transfer says **compacted handoff** when it uses a checkpoint or shortens or omits recorded content; **full handoff** means no such reduction was needed. Neither transfers provider-private reasoning or credentials.
- A launch without a native session carries the conversation even if the path that lost the session forgot to say so.

## Asides and advice

Select thread text to quote it or ask a read-only Aside. Aside replies stay separate from the main agent's conversation.

The optional advisor sends thread context to a second model for advice. See [providers and advisor](PROVIDERS.md#advisor).

Provider features depend on the installed runtime. See [provider setup](PROVIDERS.md) and [background recovery](AUTOMATION.md).

## Agents overview

Home stays a centred start screen. Under the box it shows one line with what is running, new recaps and completed work, which opens Inbox, and only what is blocked on you: agents waiting for your input and recaps that need a decision. **Inbox** in the sidebar (⌘⇧I) opens on **All**, an overview of every section with **See all** links, and has a tab for each: **Waiting**, **Running**, **Recaps**, **Learned** (every "What Ramu learned" summary) and **Completed**. Its badge counts threads waiting on you and recaps that need a decision. Rows are threads, drawn like the sidebar's: click one to open it, or stop it from its row. A thread shows how many sub-agents it started; the sub-agents themselves live in the thread, and only one waiting for your answer gets its own row. Answer questions, connector requests and tool approvals in place.

Nothing in Inbox needs clearing. **Waiting** empties as you answer or dismiss; running threads leave when they finish. **Completed** is recent history: threads finished in the last 7 days (at most 50), grouped by day, with an unread dot until you open one and **Archive** on hover. Older threads stay in the sidebar and Search. **Learned** shows the latest 20 summaries; the full history is in Settings → Memory & skills. Ramu-managed sub-agent threads have a **Back to parent thread** breadcrumb.

An unfinished goal stays out of Completed even between continuation turns. Active goals and provider-limit holds stay in Running; paused, blocked and turn-limited goals remain in Waiting so you can open their existing Resume or goal controls. Pending questions and approvals take priority. A mobile thread's refreshed goal takes precedence over an older task summary.

## Thread activity and helper controls

The compact activity row uses connection, pending input, provider holds, parent work, helpers, goals, advisor work and queue state in that priority order. Secondary actions remain reachable when a higher-priority state is shown. Mobile opens the existing controls in its sheet; desktop focuses the existing card, tray or helper panel. A goal has no invented percentage, and phone outbox uncertainty remains separate from the server queue.

Helper groups retain their launch position and read each helper's latest recorded state. The current set contains helpers from the current user turn plus older helpers still active. Earlier settled work stays in History; advisors do not increase helper counts. A parent becoming idle does not stop a separately owned child. Stopped and failed are distinct outcomes, and late running progress cannot resurrect a settled helper without explicit resume metadata.

Actions require the host's reported capabilities and a connection. The server rechecks Stop and Message. A Ramu-owned child can expose its real session ID; native helpers may have no separate conversation. Read-only details explain missing direct messaging instead of showing an unusable composer. Mobile currently labels its bounded output as an excerpt. Exact request IDs and child-origin labels survive forwarding, so approval/question answers continue through the existing routing boundary. A request in the desktop thread popover opens its owning session and focuses that request, including the question dock, without submitting an answer. Source links use recorded event sequence IDs, including restored history with gaps.

## Automatic sub-agent selection

Settings → Workflows → Sub-agents offers **Automatic selection**, off by default. **Model and effort** asks the destination provider to choose from its current model catalog for each cross-provider task. **Effort only** keeps the configured model. Selection uses an isolated request on the destination provider, with a 30-second timeout and provider fallback disabled. Invalid or unavailable selection uses the configured model and effort within the caps.

**Maximum sub-agent effort** and **Per-model effort caps** apply to Ramu-managed sub-agents, including usage-limit fallbacks. The lower ceiling wins. Efforts are restricted to supported levels at or below that ceiling; a model with no compatible effort cannot start. Native provider sub-agents retain their own settings. Selection adds one model request before the delegated task starts; the helper card records the selected model and effort and reports when configured settings were used instead.

## Shared rules

Settings → Agent setup → Rules on desktop and Settings → Rules on mobile edit the same host-owned collection. Rules are user instructions, never permission grants; enabled Always rules apply when a new session starts, while Manual rules remain stored. Mobile requires an explicit project/host and provider scope before creating a rule, preserves multi-provider selections, and refuses saving when the last selected provider is unchecked until a scope is chosen again.

Changes use the revision that was opened for editing. A concurrent edit refuses the save and keeps the draft for correction. History can be previewed and copied into the editor, then saved as a new revision after review. Delete names the rule in a confirmation. Offline and view-only devices cannot mutate rules; older hosts explain that an update is needed. Search and incremental lists keep the mobile page bounded.
