# Agents and routing

## Changing models while working

Choosing a model during a running turn starts a five-second countdown: **Apply now** switches immediately and **Cancel** restores the applied model and effort. Adjusting effort while a change is pending keeps the original deadline. The countdown is cancelled if the turn stops; idle threads switch at once.

Before applying, the server checks the provider adapter and the live runner's negotiated capabilities. A supported change restarts the process and resumes the native conversation, keeping process-bound tools and access settings (the transcript says **Settings changed**). A provider that needs a fresh session gets a budgeted **Context handoff**. A rejected change leaves the current process intact, and usage-limit fallback skips rejected targets. ACP runners check the model list and advertised resume support before the old process stops.

Moving to a smaller context window uses the destination's capacity: if the native history fits, the session resumes; otherwise Ramu starts a fresh session with a compacted handoff from the saved thread record. Capacities (provider-reported or observed) are saved per provider, account and model. Unknown capacity or usage means a fresh handoff.

## MCP connections

**/mcp** in a thread shows connection status without sending a prompt. Claude and OpenCode report live server states with **Refresh** and per-server **Reconnect**; Codex reads its thread-scoped inventory and offers **Reload MCP servers** (effective next turn); Cursor and ACP runtimes show the configuration Ramu supplied, labelled as configuration. Runtimes without HTTP MCP mark remote servers unsupported but still receive stdio servers. Without a running provider process the dialog shows the last reported startup snapshot.

A workspace needs no MCP configuration of its own. Every provider merges `.mcp.json` from the covered repositories (including the original directories behind isolated workspaces) and shares Claude-local entries for those repositories: Claude reads the selected account's `.claude.json`, and other providers import repository entries from the host's default Claude configuration. Global Claude-only entries and unrelated projects are not imported. The current checkout wins repository-file conflicts, local definitions beat repository files, and Ramu's own server name is reserved.

Claude gets up to 60 seconds for MCP startup (explicit `MCP_TIMEOUT` and `CLAUDE_CODE_MCP_STARTUP_WAIT_MS` win), and imported Codex and OpenCode servers get the same budget unless their definition sets one. Pending connections are shown apart from failures. Changes apply on the next launch.

## Rules

**Settings → Agent setup → Rules** (and Settings → Rules on mobile) edit the same host-owned collection of your own instructions. Enabled **Always** rules reach each new thread in a labelled section that says they never grant permissions; **Manual** rules stay stored. Mobile requires an explicit host, project and provider scope before creating a rule.

- Budget: 24,000 characters (names plus text) per scope, host-wide rules plus the project's. A save over budget is refused, not trimmed, and a host-wide rule is checked against every project. Settings estimates tokens (about four characters each).
- Rules are additive. Identical text (ignoring whitespace) or the same name (ignoring case) among rules that can reach one thread shows a warning on both; Ramu never merges them.
- Edits use the revision opened for editing; a concurrent edit refuses the save and keeps the draft. History can be previewed and saved as a new revision. Offline and viewer devices cannot change rules.
- **Instruction files providers read** lists `AGENTS.md`, `CLAUDE.md` and rules-folder files (`.claude/rules`, `.cursor/rules`) for the project (two levels deep, skipping dependency and build folders) plus `~/.claude/CLAUDE.md` and `~/.codex/AGENTS.md`. It is read-only: Ramu never edits, imports or sends them. Each shows its folder, the providers documented to read it, size, a bounded preview and frontmatter. `@path` includes are followed only inside the project (or user folder), five levels and 20 files deep; cycles, missing, outside and oversized files are reported, never fetched.
- **Agent setup** in **/mcp** lists the rules, shared servers, skills and Shared MCP connections resolved for the thread (`agent.setup`, `agent/effectiveSetup.ts`), each **Configured**, **Delivered**, **Runtime confirmed**, **Needs refresh** or **Not sent** with a reason. Only names and states are returned, never rule text, addresses or credentials, and Ramu never claims a skill or rule was read or followed.

## Thread titles

A new thread shows its opening-message title at once. After the first user message the server schedules one isolated naming request (also for mobile and API starts; closing a client does not cancel it). Titles describe the task and intended outcome in the message's language from bounded user messages and relevant replies; helper output and tool results are excluded.

**Rename** is authoritative; **Rename with AI** regenerates from the conversation, even over a manual name. A later manual edit or newer regeneration wins. A useful automatic title stays stable, with at most one refinement after the first reply. Titles never rename branches, folders or workspace labels. The title action shows **Naming thread** while pending and **Retry title generation** after a failure; a failed or limited request keeps the current name. Each attempt has a 15-second deadline, title work shares a two-request limit and never waits for quota resets, and pending work retries once after a restart. The server accepts a title a provider supplies itself, but no provider is enabled for that until verified against a live session.

## Sub-agents

Sub-agent cards show progress and transcripts; open one to inspect it, message it or stop it. Stopping the main thread stops its sub-agents. Native sub-agents already running keep their provider; after a restart Ramu reads saved transcripts so the main agent can reconcile unfinished work, without reattaching processes.

- **Routing:** Ramu can send sub-agents to another provider or model. **Native** uses the provider's own. Type rules override general routing. Codex's optional hook routes before launch and adds a trust entry to `~/.codex/config.toml`.
- **Isolation:** an isolated sub-agent uses its own checkout and applies its changes back on finish; conflicting patches stay in the checkout for review. Its tracked-change snapshot excludes untracked files, and it takes no follow-up messages.
- **Automatic selection** (Settings → Workflows → Sub-agents, off by default): **Model and effort** lets the destination provider pick from its catalog per cross-provider task; **Effort only** keeps the configured model. It uses an isolated request with a 30-second timeout and no fallback, and falls back to the configured settings if the pick is invalid. **Maximum sub-agent effort** and **Per-model effort caps** apply to Ramu-managed sub-agents (the lower ceiling wins); the helper card records what was chosen.
- **Activity row:** states are ordered connection, pending input, provider holds, parent work, helpers, goals, advisor, queue; secondary actions stay reachable. Helper groups keep their launch position and show each helper's latest state (current-turn helpers plus older active ones; earlier work is under History). A parent going idle does not stop a separately owned child; stopped and failed differ, and late progress cannot revive a settled helper. The server rechecks Stop and Message. Forwarded requests keep their IDs and child-origin labels, so answers route correctly, and a request in the desktop popover opens its owning session.

## Teammates

**Add teammate** in the thread menu (desktop and phone) brings a second model into the thread. It starts from the conversation so far with secrets removed, keeps its own provider session, and appears in the thread as a helper card. Start a message with `@name` (or `@teammate`) to talk to it; anything else goes to the lead. One teammate per thread.

- **Review** (default) reads the latest changes and replies with findings. It is read-only whatever the thread allows: Codex, Cursor and ACP runtimes start in their read-only modes, and Claude has its editing and shell tools removed.
- **Take over** edits while the lead waits, then hands back with a summary. It never exceeds the thread's access.

Each report reaches the lead as a message. After 4 reports without the person writing, the exchange pauses and says so; a message to either one continues it. A teammate idle between requests costs nothing, wakes when messaged, survives restarts, and stops with the thread or from the bar above the composer.

## Custom agents

**Settings → Workflows → Custom agents** keeps reusable agents on the host: a name, when to use it, instructions, an optional model and a read-only switch. **New agent** turns one sentence into a draft with a single bounded, tool-free call; nothing saves until the person saves it. The thread's agent sees each name and description in `ramu_agent` and passes the name as its type when a task fits; the helper card shows **custom: ‹name›**. A custom agent wins over a sub-agent type rule or a provider's own agent of the same name. Read-only narrows the thread's access and never widens it, and instructions reach the helper in its prompt, never by writing provider files. **Add teammate** can also start from a custom agent.

## Threads started by agents

A main-thread agent can start threads the person owns, when asked for separate work: a follow-up in this project, the matching change in another project, or several parts in parallel. Unlike a helper, a started thread appears in the sidebar, keeps working on its own and does not stop with the thread that started it (`background/agentThreads.ts`).

- **Tools:** `thread_start` (up to 8 threads per call), `thread_status`, `thread_message` and `project_list`. A project is named by ID or in words: names and aliases decide first, then Home's Auto router; an ambiguous or unknown name is returned to the agent to ask the person, and nothing is created. **Default** checkout follows the project's setting; `worktree` takes an optional branch name.
- **Bring uncommitted changes:** `bringChanges` starts a new worktree of the same project with the starting checkout's uncommitted changes to tracked files (untracked files are not copied). The starting checkout is only read. A patch that does not apply is named in the new thread's first message.
- **Approval:** in Full access, one thread in the caller's own project starts at once. Another project, several threads or any narrower access shows one permission card listing each destination, checkout and brief; **Deny** starts nothing, and the agent is told not to retry.
- **Brief:** the first message is the agent's prompt, followed by the starting thread's title, the person's last request there (secrets redacted, at most 1,500 characters) and the titles of threads started together. Model, effort and access come from the starting thread; access can only be narrowed.
- **Limits:** a person's thread may start threads, and those may start threads one level further; deeper ones are refused. A thread may start 8 threads per hour.
- **Links and reports:** the starting thread shows a card listing the threads with **Open**; each started thread shows **From ‹thread›** in its header (desktop) or thread menu (phone) and a fork mark in the sidebar. When a started thread finishes, fails, is stopped or waits for the person, one report with its latest message is queued to the starting thread, unless that thread was stopped. Threads started together can read and message each other, their starter and threads they started; nothing else. A message never reaches a thread with more access than the sender.
- Deleting the starting thread keeps the started threads and their group; they only lose the link back.

**Let agents start threads** (Settings → Threads, on by default) turns all of this off for the host: threads launched afterwards get no tools, running threads are refused, and a paired host's agents cannot start or message threads here. Helpers are not affected, and threads already started keep running and reporting. Approvals for these starts are once-only: they cannot be saved as permission rules or allowed for a thread, and no access mode skips the card for another project, several threads or another host.

### Threads on another host

A person can let this host's agents start threads on another host from its row in **Settings → Remote access**: **Request** next to **Agents**, and once that host allows it this host pairs itself there. The other host grants Agents like any device permission and can end it at any time, which also stops the pairing. A host with no row can be added with `ramu pair` there and `ramu hosts add <address> <code> --name vps` here. Agents then pass `host` to `thread_start` and `project_list`.

- **Starting:** every start on another host asks the person first, even in Full access, and needs the exact name of a project there. Uncommitted changes never leave this host. The other host uses this thread's model when it has it, otherwise its own default, and never more access than its ceiling for this pairing (**Most access for its threads** on its device row, default Allow edits). Its thread shows **From ‹thread› on ‹host›** and names this host in its first message.
- **Following:** the started card says which host each thread runs on. `thread_status` and `thread_message` reach those threads with their `remote:` ids; this host asks about unsettled ones once a minute and queues one report per outcome, as for local threads. A host that cannot be reached keeps the start (**Waiting for ‹host›**) and starts it when it returns; after a day it is reported as not started.
- **Limits:** the other host enforces its own depth and hourly limits for this pairing and shows only the threads this pairing started. See [Security](../SECURITY.md#remote-access) for what a host pairing can and cannot do.

### Continue on another host

**Continue on ‹host›** in a thread's menu (desktop and phone, hidden from viewer devices) copies the thread to another host this device is connected to, and **Also on** adds up to four hosts, each with its own thread, branch and outcome. The menu lists a host whose platform the latest request names first, marked **Suggested**, then hosts with more memory free, and marks a host low on memory. A sheet shows the branch and commit the other host starts from, what stays behind (uncommitted files, unpushed commits, queued messages), the project there, the model that will run with **Allow edits**, and an optional note. The project is matched by Git remote; a project with only the same name must be chosen. When none matches, the sheet clones the remote on that host with its own credentials and adds the project. Only single-repository projects can be set up this way, and a running thread must be stopped first.

The conversation travels as a redacted handoff bounded to 100,000 characters; files never leave the host, and the other host works in a new worktree from the pushed branch. The device calls each host directly, so paired hosts never clone or read transcripts. The new thread shows **Continued from ‹thread› on ‹host›**; the original shows **Continued on ‹host›** with **Open**, **Bring back result** (queues the latest reply there, labelled with its host) and **Archive** with Undo. A retried start finds the same thread.

## One prompt, several threads

With **Auto** as the destination (Home on the desktop, a new thread on the phone), a request that needs work in several projects becomes a reviewed set of threads instead of one.

- **When it splits:** names and aliases decide first; a prompt that names several projects separately, or that no name settles, goes to one bounded, tool-free classification. It splits only when its reason quotes every project it lists, and into at most 8; otherwise Auto asks which project, as before. Projects on the other connected hosts are weighed too, sending only their names, aliases, descriptions and host names.
- **Briefs:** one more bounded call on the current host writes a brief per project and a **Shared contract** (names, fields, endpoints, order of changes) from the request, adding no requirements of its own. Without an answer, each row starts from the person's words.
- **Review:** nothing starts until the person chooses **Start all**. Each row shows its project and host, an editable title and brief, and a remove button; the contract is editable once for all. **Start as one thread** offers the projects as a choice instead, and **Cancel** leaves the message in the composer. The list survives closing Home or the app until it is started or cancelled.
- **The same project on several hosts:** copies with the same name are one project to route, not a reason to split. The hosts named in the prompt narrow them ("fix the login in ramu on vps" uses that copy without a model call); a prompt that names no host asks which copy, and only a prompt naming every copy's host can split between them. Choices show the host whenever names match.
- **Turning it off:** **Split requests across projects** (Settings → Threads, on by default) makes Auto always start one thread.
- **Starting:** each host starts its own rows (`threads.startGroup`) as one group with the project's default checkout and the reviewed model. Every thread's first message is its brief, the contract and the person's original request, and names the other threads of the group, which it can read and message (see [Threads started by agents](#threads-started-by-agents)). A host that fails reports its rows without stopping the others. An Auto request that resolves to one project on another host is reviewed the same way, as a single row.
- **Following up:** the **Started together** cards in Inbox's Brief (desktop) and the threads list (phone) show each group across connected hosts with every thread's state and one line for the group (waiting, still working, or how it settled) until a few days after all of it settles.

## Operator

**Operator** (Settings → Threads, off by default) adds a box to Inbox, and a button on the phone, that turns one sentence into proposed actions across connected hosts: "stop everything on vps", "retry what failed", "what is blocked?".

- **What it is:** not an agent. One bounded, tool-free call on the host's default model reads refs, titles, project and host names and states (at most 100 threads and 30 schedules, those needing you first). It reads no transcript or file, and costs nothing when unused.
- **What it can do:** stop, retry or message a thread; archive it or mark it done; pause, resume or run a schedule. Actions that do not fit a thread's state, or name anything unlisted, are dropped. It cannot delete anything, approve requests, or reach files, Git or terminals.
- **Confirming:** each proposed action has a checkbox and nothing runs until **Do these**. Each runs as the ordinary method on its own host with this device's permissions, and failures are listed per action. An unclear request gets a question instead of actions.

## Usage limits and fallback

**Settings → Models → Provider fallback** is one ordered list of provider and model pairs, best first (default: Claude Code, then Codex).

- When a model reaches its limit the thread moves to the highest entry with room; unavailable or limited entries are skipped. The switch point is **Only at the limit** by default; 80%, 90% and 95% switch earlier.
- Threads keep their current model while it has room; a higher model becoming available does not trigger a switch. The rule covers manual choices and models outside the list, including after a restart.
- The composer's usage chip shows where the next message goes and can keep the current model for one message or the thread.
- Titles, recaps and commit messages keep their model until it is limited. Sub-agents use the main list or their own list and threshold, and only move down it.
- Fallback needs installed, authenticated providers and carries visible conversation context, never private reasoning. Authentication and tool errors do not trigger it.

### When every provider is limited

The thread goes idle with **Limit reached · resumes around …** instead of failing; a clock replaces its sidebar status and Inbox lists it under Running. It keeps waiting in the background and survives restarts.

- Messages sent or queued meanwhile stay in the queue and go out together as one request on resume (or the unfinished request continues). Stopping the thread ends the wait.
- Ramu rechecks at the known reset, otherwise backs off from one to 15 minutes. Waits are keyed by provider login: threads on one login share a timer and check, and resume with a small random spread.
- A limit is a pause, not a failed turn. **Wait on this model** (or fallback off) waits on the same provider; a goal waits the same way. A 429 with exhausted retries counts as a limit; a bare "rate limit" gets one quiet retry first; "prompt is too long" stays an error.
- A sub-agent with nowhere to go waits with its login and says so. Background work nobody is blocked on (advisor, reviews, learning, recaps) waits up to 45 minutes. Titles, commit messages and Asides report the limit at once. Scheduled runs stay *running* through the wait.

**Auto-resume** is the thread's choice (`agent.setAutoResume`), otherwise the global `fallback.autoResume` (on), read live. Sub-agents and the advisor follow their parent. With it off the wait is shown, no timer runs and messages stay queued; once a known reset passes, one push says the thread can resume (a guessed reset never notifies). **Try again** (`agent.retryLimitNow`) works either way: it re-reads usage and continues only if a reading shows room or the provider has no reading of its own; otherwise the wait stays with an updated time. Resuming a waiting goal tries immediately.

Reset times come from the provider's reading, else from the notice ("in 2 hours", "resets at 5pm", "17:00 UTC", ISO times, in the reported zone or the host's). With none, the wait is marked *guessed*.

### Carrying the conversation to another provider

A switch, a lost native session or a rewind starts a provider session that has not seen the conversation. Ramu builds a handoff from the thread's event log (no model call) and sends it in a `<ramu-handoff>` block apart from the request (`Next request: …`): a frame naming the cause, a state block (latest request and outcome, last reply, open questions and approvals, queue, helpers, changed files, last failing tool result, and the goal for providers without session guidance), the checkpoint if valid and labelled historical, and the transcript.

- **Compaction is tiered:** user messages, questions, answers and approvals are never cut and the latest turn stays whole. Old tool results shorten first, then old calls and assistant text, then drop. Each dropped run becomes a line with its event range and a `session_recall` `startSeq` to read it.
- **Returning providers resume their own session** and get only unseen events (Codex, OpenCode, Cursor, Antigravity); if resume fails, a full handoff. Claude Code always gets a full handoff. Native session IDs are kept per login with the last event each saw; a rewind forgets them.
- **The checkpoint is sent once**, in the handoff. Near a limit it is refreshed ahead of time ([Learning](LEARNING.md#checkpoint-refresh-near-a-limit)); the handoff only reads what is saved.
- **Budget:** one token per UTF-8 byte, up to a quarter of the destination window and at most 400,000 bytes (32,000 for an unknown window, estimated at 128,000 tokens); the rest is reserved for instructions, the request, attachments and output. A conversation that still does not fit is never truncated silently: a model switch is refused before the live session stops, fallback skips that model (or holds the thread at its limit with the reason), and an impossible launch fails clearly.
- **The transcript records it** (`handoffInfo`: cause, full or delta, event range, size, dropped or shortened events, checkpoint boundary). **New events only** is a delta into a returning session; **compacted handoff** means a checkpoint was used or content was shortened or omitted; **full handoff** means none was. Provider-private reasoning and credentials are never transferred.

## Asides and advice

Select thread text to quote it or ask a read-only Aside; replies stay separate from the main conversation. The optional advisor sends thread context to a second model ([Providers](PROVIDERS.md#advisor)).

## Inbox

Home stays a start screen with one line under the box: what is running, new recaps and completed work (opens Inbox), and what is blocked on you. **Inbox** (⌘⇧I) opens on **All** and has **Waiting**, **Running**, **Recaps**, **Learned** and **Completed** tabs; its badge counts threads waiting on you and recaps needing a decision. Rows are threads drawn like the sidebar's; answer questions, connector requests and approvals in place. Sub-agents appear as a count on their thread, and only one waiting for your answer gets its own row.

Nothing needs clearing. **Waiting** empties as you answer or dismiss; **Completed** shows threads finished in the last 7 days (at most 50) grouped by day with an unread dot and **Archive** on hover; **Learned** shows the latest 20 summaries. Unfinished goals stay out of Completed: active goals and limit holds stay in Running, paused, blocked and turn-limited goals in Waiting; pending questions and approvals take priority. Sub-agent threads have a **Back to parent thread** link.

After a restart, completed turns keep their outcome. Older stopped records whose last activity was a successful result are restored as transcript-only sessions; later user, helper, tool, request or error activity prevents that.
