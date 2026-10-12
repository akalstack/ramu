# Sub-agents, asides, usage limits, fallback, and what Claude and Codex still offer

Status as of 2026-10-11. Scope so far: Claude (Agent SDK 0.3.295) and Codex (app-server, CLI 0.162.1).

For the source-checked, prioritized remaining work across agents and the app, see [NEXT.md](NEXT.md). The “Planned” sections below preserve the original design; most of those features are now implemented.

## Done

**Cross-provider advisor (2026-10-12)**
- Settings → Advisor (off by default) gives main chats an `advisor` tool that runs on any provider and model. It is non-blocking by default, delivers advice as a steering message, and has `wait_for_advice` and `wait=true` for decision points and the final check. While it is on, Claude Code's own advisor is turned off in Ramu's Claude sessions through the `advisorModel: ''` flag setting, which was verified against the bundled CLI's debug log. See [PROVIDERS.md](PROVIDERS.md#advisor).
- Open: live-model compliance (does the agent really hold dependent edits until advice arrives?), and persisting pending advice across a service restart.

**Chat file restore and helper recovery (2026-10-11)**
- Undo lives under chat Edit, using Ramu's engine for every provider and fallback route. A preview combines the chosen run and later captures; conflict checks preserve later edits. Claude native checkpoints are intentionally not used.
- Saved native helper history reloads before main-chat recovery, even with automatic continuation off. Repeated boots merge messages/tool results, and the panel explains missing history. Historical provider sessions after fallback are enumerated from durable init/settings events; one failed provider read does not discard another provider’s recovered evidence. Live-provider compatibility validation remains.

**Codex MCP input requests (2026-10-11)**
- `mcpServer/elicitation/request` now shows a connector card for MCP flat forms and browser links. Forms support strings, integers/numbers, booleans, titled/legacy enums and multiple choices, optional fields and visible defaults. Original option values and JSON types are sent to the server; invalid submissions retain the pending request.
- A dedicated Submit/Continue, Decline and Cancel flow responds with `accept`/`decline`/`cancel`, without fabricating answers. Link requests show an explicit browser link and are never opened automatically. Native elicitations stay blocking regardless of the async-question preference.
- Drafts persist across app close/reopen. Daemon restart cancels old native requests; their drafts remain as history, and a fresh provider connection gets distinct request IDs. Interrupt/stop and server-side resolution cancel pending input. Multiple pending forms retain the needs-input state until resolved.
- Unsupported schemas/modes/links are cancelled with a visible explanation rather than silently dropping constraints. `openai/form` and `openaiForm` aliases use the same supported flat schema subset. `item/tool/call` remains a separate unsupported dynamic-tool request unless a registered handler is added.
- Installed generated protocol types and MCP SDK schemas/validation informed the implementation. Deterministic schema, wire, service and desktop tests cover it; live connector validation remains.

**Codex live tool output and diffs (2026-10-11)**
- `item/commandExecution/outputDelta` appends command output; `item/fileChange/patchUpdated` replaces the current patch snapshot. Both update existing tool result rows in place, marked running until the completed item arrives. Streaming never releases the active tool’s steering lock.
- `turn/diff/updated` updates one collapsed “Changes in this turn” row per native turn. This is a provider snapshot; recorded Changes reviews and Ramu file restore remain the durable review/restore workflow.
- Native helper output is tagged and tool IDs are scoped to its thread. Unknown threads stay out. Final output is authoritative; if omitted, buffered command output/patches are retained. Late deltas after tool completion are ignored.
- Persisted command output keeps the last 64,000 characters; patch/turn previews keep up to 256,000 characters. Protocol fields were checked against the installed CLI’s generated TypeScript. Deterministic wire/service and desktop checks cover the behavior; real-provider validation remains.

**Claude streaming (2026-10-11)**
- Main and native helper text now streams with `includePartialMessages`, with separate parent-tool lanes and updates batched at 50 ms. Completed blocks replace their partial row with the saved-message ID, preserving event positions and avoiding duplicate bubbles.
- Streaming exposes text only. Private thinking and incomplete tool input are ignored; tools use completed blocks. Helpers may keep streaming after the main turn finishes.
- Deterministic tests cover interleaved main/helper streams, one completed block per frame, repeated frames, identical text in multiple blocks, and helper streams surviving main-turn completion. Live-provider verification remains.

**Questions while work continues (2026-10-11)**
- Default-on setting in Background & Recaps. Portable `ask_user`, `question_status`, `wait_for_answer`, and `close_question` MCP tools for Claude and Codex; native Codex async messages are supported too.
- Related groups send answers together; independent questions can send separately. Cards accept choices or text, explain dependencies, and appear in a pending-question list.
- Late answers steer the active chat or start another turn in the same conversation. Pending async questions, partial answers, and private drafts survive restart. Obsolete questions carry a reason; dismissal sends no assumed answer. Blocking questions and approvals still wait.
- The agent declares dependencies; real-model compliance still needs live verification. See [AUTOMATION.md](AUTOMATION.md#questions-while-work-continues).

**Sub-agents and background tasks**
- Claude's `task_started`, `task_progress`, `task_updated` and `task_notification` messages become one `agent` event per task, updated in place (`AgentTask` in `src/shared/types.ts`).
- Sub-agent text and tool calls are kept, tagged with `agentId`: `forwardSubagentText` and `agentProgressSummaries` are on. They used to be dropped.
- Codex `collabAgentToolCall` items register sub-agent threads. Those threads' messages and tool calls are tagged the same way. Approval requests from a sub-agent thread are answered; before, that agent waited forever.
- **Chat UI:**
  - A card shows where the main agent started an agent: name, type, Background, live progress line, tool uses, time, tokens, and Stop.
  - A header chip reads "N agents running"; when none are running it reads "Agents · N".
  - A side panel shows the agent's task, its own transcript, its final report, and a message box.
- **Stop:** Claude uses `query.stopTask()`. For Codex the main agent is asked to `close_agent`. Stopping the chat marks its agents stopped.
- **Messages to an agent:** neither SDK can write to a sub-agent directly. The message goes to the main agent, which relays it with `SendMessage` (Claude) or `send_input` (Codex). The chat shows it as "To <agent>" (`src/shared/agentTasks.ts`).
- Sub-agent output is kept out of the provider handoff, titles and recaps.
- **Tests:** `test/agent.test.ts` and `test/codex.test.ts`. The fake agent replays a background-agent run when a prompt contains `[agents]`; use `RAMU_FAKE_AGENT_DELAY` to set how long it runs.

## UI built for the planned features (2026-10-11): backend handoff

The UI for the planned sections below is in place. Some parts already work end to end; others store settings or call contracts that the backend still has to honour. Contracts live in `src/shared/types.ts` (`UsageReading`, `FallbackStep`, `FallbackPreferences`, `SubagentPreferences`, `Aside`, and the new `AgentTask.provider` / `model` / `steps` fields) and `src/shared/api.ts`.

**Works end to end**
- **Quote and Aside** (`SelectionActions`, `AsidePanel` in `AgentView.tsx`).
  - **Quote** inserts a `>` blockquote into the composer. **Ask aside** opens the panel.
  - IPC: `aside.ask`, `aside.list`, `aside.delete`, pushed as `aside:changed`.
  - Answers come from `AgentService.analyze()` on the chat's settings, with `asideContext()` as context. Asides are stored as app state `asides:<sessionId>`.
  - Shortcuts: ⌘⇧Q and ⌘⇧A while text is selected.
  - `/aside <question>` (or `/btw`) in a chat's message box asks about the whole chat. It works while the agent is running, never reaches the agent, and leaves the caret in the message box (2026-10-12).
- **Questions float on the message box** (`QuestionDock` in `src/renderer/src/QuestionCard.tsx`), as in Codex and T3 Code. The dock shows one question at a time, with numbered options (keys 1–9), an own-answer box, Back/Next, and Send or Send answers together. Dismiss is offered for async questions only. With several requests it adds a pager, and "Answer later" folds it to a one-line bar. A new question opens it again. The transcript keeps a slim `QuestionRow` where the agent asked: a click opens the dock while it waits, and once resolved the row lists each question with its answer and the outcome.
- **Who wrote it decides the side.** Only text the user wrote sits on the right. Messages Ramu sends for the user show only the user's part: late answers appear as "Answers to the agent's questions". Machine notes sit on the left: delivered advice, and Codex sub-agent stop requests ("Asked the agent to stop X"). Their formats are shared in `src/shared/questions.ts` and `src/shared/agentTasks.ts`. Screenshots: `node scripts/chat-shots.mjs` → `output/playwright/chat/`.
- **Claude usage gauges.**
  - `pump()` hands each `rate_limit_event` to `usageHook`. `claudeReading()` in `src/main/usage.ts` maps it, and `UsageService` keeps it (app state `usage-limits`, pushed as `usage:changed`).
  - Shown in: the sidebar footer (`UsageFooter`), the status-bar rings when the sidebar is hidden (`UsageRings`), the detail popover, remaining % in the model picker, and the "Show usage limits" toggle in Settings › Providers.
- **Handoff separator:** "Switch back to <provider>" calls `agent.configure` with the new `previous` field on `settings` events. `fallback()` now records `previous`.

**Also built (UI and adapters)**
- **Thinking:** Claude thinking blocks and Codex reasoning summaries become `thinking` events, shown as a collapsed "Thought" row inside the turn's folded work (`ThinkingRow`). Sub-agent thinking is not kept.
- **Sidebar:** a chat shows the working spinner while any live session still has running sub-agents or background tasks (`syncTaskStatus` in `agent.ts`), and settles when they finish.

**Backend, done (2026-10-11)**
1. **Usage readings.**
   - **Claude:** a real `rate_limit_event` carries every window in `unifiedWindows` (`five_hour`, `seven_day`, model-specific ones), not in a top-level `utilization`. `claudeReadings()` in `src/main/usage.ts` reads that, with the documented single-window form as a fallback.
   - **Codex:** `account/rateLimits/read` on start plus `account/rateLimits/updated` become `usage` events, which `AgentService` hands to `UsageService` and never records in the chat (`codexReadings()` in `codex.ts`). The mapping was checked against the real CLI's response.
2. **One routing module for both sides** (`src/shared/routing.ts`, tested in `test/routing.test.ts`). `planRoute`, `nextStep`, `resolveStep` (default model, effort mapped to the nearest supported level), `subagentTarget` and `subagentChain` are used by the main process and by `ProviderRouteChip`, so the chip shows exactly where the next message goes.
   - A reading counts until its window resets. Without a reset time it counts for 15 minutes.
   - A model-specific window (Opus weekly) applies only to that model.
   - The chat's own `autoFallback` flag decides, not the global default.
3. **Switching before a limit.** `switchBeforeSend` runs in `send()` (follow-ups and queued messages), `startReviewed` (new chats and schedules) and quietly in `analyze()`.
   - `applySettings` is the single switch path: same provider keeps the native session and does not hand off; another provider hands the conversation over.
   - `agent.holdProvider` is honoured: a `message` hold lasts one send, a `chat` hold lasts until the limit recovers.
   - `fallback.returnAfterReset` returns the chat to its original provider, model and effort after the reset.
4. **Fallback chains.** `fallback()` walks `preferences.fallback.chains` (default: Claude ↔ Codex), tracking attempted `provider:model` steps. Same-provider steps keep the native session. A sub-agent uses its own chain and threshold when configured.
5. **Checkout ownership.** A chat with running sub-agents or background tasks stays the checkout's writer. `activeWriter(covers, self)` exempts the chat's own group, so its follow-ups are not held back. The change capture waits for the last agent, and other chats waiting for the checkout are woken when it finishes.
6. **Sub-agents Ramu runs** (`spawnSubagent` in `agent.ts`):
   - **Sessions:** a child is a session of its own (`agent_sessions.parent_session_id`), hidden from `list()` and the chat list. It shares one writer group with its chat, and its changes are captured with the chat's review.
   - **Tool and routing:** the MCP tool `ramu_agent` (`daemon.ts`) starts a child on the provider and model routing picks, foreground or background. A foreground call is capped at 45 minutes and then turns into a background one.
   - **Claude:** a `PreToolUse` hook on `Agent|Task` refuses the native tool and points the model at `ramu_agent`. This was checked against the real SDK: the hook fires and carries `subagent_type`.
   - **Codex:** `features.multi_agent=false` and `tool_timeout_sec` are passed when routing replaces native sub-agents (verified with the real CLI).
   - **In the chat:**
     - The child's text and tool calls are mirrored into the chat tagged with its id, so the existing panel works.
     - Its approvals and questions show in the chat and the answer reaches the child.
     - Messages and Stop go straight to the child.
     - A background child's report comes back as a message, shown as a report card.
     - Stopping the chat stops its children. A provider switch of the chat does not.
   - **Limits:** a child that hits a usage limit falls back along the sub-agent chain, and its card shows each step. A native sub-agent that dies on a limit is continued on the fallback list with its transcript (`continueNative`). Concurrency is capped, and `shareContext` is honoured.

**Also done**
- **Isolation (`subagents.isolate`)** (`src/main/isolation.ts`, tested with real git in `test/isolation.test.ts`):
  - **Worktree:** a Ramu-run sub-agent gets a detached git worktree of every repository its chat covers, laid out like the original and based on the tracked files as they are right now (`git stash create`, so uncommitted tracked changes are included; untracked files are not copied).
  - **Applying back:** when it finishes, its patch is applied back with `git apply`, so the chat's own review sees it. A repository whose patch conflicts is left untouched and its worktree is kept, with the location in the report. Nothing is committed or staged.
  - **While it runs:** the task stays "running" in its chat until the changes are back, so the checkout stays reserved and the capture waits.
  - **Failure and follow-ups:** a sub-agent that failed or was stopped does not apply; its copy is kept if it changed anything. An isolated sub-agent takes no follow-up messages. Worktrees live under `<userData>/subagent-worktrees`.
- **Asides on a real fork.**
  - **Claude:** `resume` + `forkSession` with no tools.
  - **Codex:** an ephemeral `thread/fork` (needs `excludeTurns: true`), read-only, with every request declined.
  - **Fallback:** the transcript path, when there is no provider session yet.
  - **Verified:** both forks were checked against the real SDK and CLI: they answered from the conversation and left the original untouched.
- **Context meter.** Claude: `getContextUsage()` after each turn and on start. Codex: `thread/tokenUsage/updated` (last request vs. the model window). Pushed as `context:changed`, never recorded, shown as a ring and percentage in the composer.
- **Claude usage before the first turn.** `usage_EXPERIMENTAL_…` is read on open (throttled to 5 minutes) through a throwaway process, and again after each launch. Verified against the real SDK: it works without a turn, with `utilization` 0 to 100 and ISO reset times.

**Codex routing completed (2026-10-11)**
- **Opt-in hook:** Settings › Sub-agents has “Decide before Codex starts its own sub-agents”. Enabling it grants trust for Ramu's exact hook definition through `config/batchWrite`, then saves the preference. It writes one trust entry to the active Codex user config; disabling leaves that entry but stops installing the hook. It is off by default.
- **Per-call routing:** the `spawn_agent` PreToolUse hook calls `codex_pre_tool_use` over the chat's MCP connection. Ramu checks the current usage and type rules (`agent_type`, with role aliases) and denies with instructions to call `ramu_agent` when routing requires it. JSON-string tool inputs are supported. Native tools remain available so types mapped to Native still work.
- **Without the hook:** at the next message boundary, Ramu resumes the same Codex thread in a new process if routing changes, including crossing the separate sub-agent usage threshold or recovering. Enabling/disabling the hook also refreshes the process at this boundary. Any running task defers the restart.
- **Verification:** regression tests cover settings changes, hook enable/disable, pressure and recovery, and string tool inputs. The real CLI trust write is checked by `RAMU_REAL_CODEX=1 pnpm vitest run test/codexHook.live.test.ts`, which creates and removes its own temporary CODEX_HOME.

**Remaining limits**
- Without the opt-in hook, Codex type rules cannot inspect native calls and pressure changes take effect at the next message boundary. Already-running native agents cannot be moved.
- **Isolation:** untracked files are not copied into the copy. A conflict is reported but not merged.

**Test hooks**
- `RAMU_FAKE_USAGE='[{"provider":"codex","window":"five_hour","usedPercent":40}]'` seeds readings.
- **Long commands.** A turn cannot hand a blocking command to the background by itself, so the agent decides up front and the user can decide later. Settings → Keep working while commands run (`autoBackgroundSeconds`, 1 minute by default; Off disables both parts) adds `BACKGROUND_PREAMBLE` to the instructions Claude and Codex get through the scoped MCP connection (`connection.instructions`), next to the question guidance. Claude chats also show **Run in background** on a running shell command; it calls the SDK's `query.backgroundTasks(toolUseId)` (`agent.backgroundTool`), the same as Ctrl+B. The turn continues, and the command appears as a task when Claude reports it.
  - **Auto-background (Claude).** The same setting (30 s to 5 min) makes Ramu call `backgroundTasks` for a main-agent `Bash` command still running after that long. The timer restarts while the chat waits for approval, and is cleared when the command returns or the chat settles. Sub-agent commands are left alone.
  - Not built: Codex has no button or auto-background; whether its app-server yields long commands is unverified. A provider with no native background option would need a Ramu-run MCP tool (start, read output, stop) that goes through the same approval rules as the provider's own shell.
- The fake Claude agent reports usage for prompts containing `[usage 92]` (in the real `unifiedWindows` shape); the fake Codex agent for `[codex-usage 64]`. Asides are answered with "Side answer: …", and `[ramu-agent]` / `[ramu-agent background]` make the fake Claude call the `ramu_agent` tool.

## Known gaps in what was built

1. ~~Background agents do not hold the checkout.~~ Done, see above.
2. **Codex sub-agent state is parsed defensively.** The app-server protocol isn't in the repo. Generate it with `codex app-server generate-ts`, then type `agentsStates`, the nicknames and `subAgentActivity` items. Check whether `turn/start` on a sub-agent thread can message it directly instead of relaying through the main agent.
3. ~~The sidebar chat row shows nothing while only background agents run.~~ Done: `syncTaskStatus` keeps the chat working until its background tasks finish.
4. **Restart recovery:** unfinished main chats now automatically continue, controlled by the default-on “Continue chats after restart” setting. They reconcile saved helper task/progress information. Native helper cards still show old processes as Stopped; `listSubagents` / `getSubagentMessages` could reload provider transcripts instead.

## Claude features not handled yet

| Feature | Where | Suggestion |
|---|---|---|
| Streaming text | Text arrives whole per block | `includePartialMessages` for token streaming like Codex |
| Context and usage | Done | Context meter from `getContextUsage()`, gauges from `rate_limit_event` and the initial usage read |
| Slash commands | Passed through as text | Composer menu from `supportedCommands()` / `commands_changed` |
| `api_retry`, `notification`, `permission_denied`, hooks | Ignored | Retry notice, toast for notifications, note when a sub-agent was denied |
| File checkpoints | Intentionally not enabled | Ramu's shared chat Edit restore covers captured runs across providers/fallbacks. Native tracking is incomplete and Codex rollback is conversation-only. |
| `prompt_suggestion` | Ignored | Suggested next prompts as chips |

## Codex features not handled yet

| Feature | Where | Suggestion |
|---|---|---|
| Live diffs (`turn/diff/updated`, fileChange `patchUpdated`) | Edits show paths only | Inline diff in the tool row |
| Command output streaming (`item/commandExecution/outputDelta`) | Output appears when the command finishes | Stream into the open tool card |
| Token usage and rate limits | Done | Context meter and account rate-limit gauges |
| `mcpServer/elicitation/request`, `item/tool/call` | Rejected | Route elicitations to the question card |
| Review mode (`review/start`), native continuation, manual compaction | Aside uses `thread/fork`; automatic compaction is displayed | Expose manual compaction and a native fork for "Continue in new chat"; evaluate native review mode |

## Planned: Quote and Aside on selected chat text

Claude Code has `/btw`: ask a side question about the conversation without interrupting or adding to the main thread. T3 and Codex call their version "side chat". Ramu calls it **Aside**, the ordinary word for a remark that doesn't derail the main conversation.

**Interaction**
- Select text in any chat message, from the agent or from you.
- A small split button appears above the selection: one pill with a thin vertical divider.
  - **Left: Quote** (quote icon). Inserts the selection into the composer as a `>` blockquote with a "from <agent/you>" note, then focuses the composer. No message is sent.
  - **Right: Ask aside** (message-circle icon). Opens the Aside panel with the selection quoted at the top and the cursor in its box.
- Keyboard: ⌘⇧Q quotes and ⌘⇧A asks aside while text is selected. Esc dismisses the button.
- The button follows the selection, flips below it near the top edge, and hides on scroll or when the selection collapses.

**Aside panel**
- Reuse the sub-agent panel shell: an overlay on the right of the transcript, so the main composer stays usable and the main agent keeps working.
- **Title:** "Aside" plus a one-line summary of the quote. Every question and answer stays in the panel. None of it is added to the main transcript or sent to the main agent.
- **Bring back:**
  - Answer actions: "Quote into chat", which uses the same blockquote as Quote, and Copy.
  - "Send to chat" posts the question and answer to the main agent as context, with your confirmation.
- **Persistence:** stored per chat as `aside` events, with an Asides list in the header next to Agents. Closing the panel keeps them.
- **Read-only:** asides never edit files or run commands.

**How to run it (verify before building)**
- **Claude:**
  - Start a separate one-off `query()` with `resume: <provider session id>`, `forkSession: true`, no tools (`allowedTools: []`, `permissionMode: 'plan'`) and a "side question, answer briefly" system prompt.
  - The fork sees the whole conversation, but the main session's history is unaffected.
  - Check whether the SDK exposes `/btw` itself; if so, use it instead.
- **Codex:**
  - `thread/fork` from the main thread, then `turn/start` on the fork with a read-only sandbox and `approvalPolicy: 'never'`.
  - Throw the fork away when the aside is closed, or keep its id to continue the aside.
- **Fallback for any provider:** `AgentService.analyze()` (the read-only path used for titles and commit messages), using the transcript from `transcriptOf()` as context.
- **Concurrency:**
  - An aside must not count as a writer, so it doesn't block the checkout.
  - It must not take the main session's queue or steering.
  - It runs while the main agent is still working.

**Naming alternatives considered**
- **"Side chat"**: what T3 and Codex use.
- **"Ask about this"**: clear, but long for a split button.
- **"Margin note"**: suggests annotation rather than asking.
- **"Tangent"**: sounds like a detour you shouldn't take.

"Aside" is short, distinct, and says that the main thread is left alone. For the left button, "Quote" beats "Cite" because it describes exactly what lands in the composer.

## Planned: plan usage gauges (5-hour and weekly)

Show how much of the Claude and Codex subscription limits is used, so you can switch provider or model before a turn fails.

**Data (verify field names before building)**
- **Claude:**
  - `rate_limit_event` messages carry `rate_limit_info`:
    - `status` (`allowed` / `allowed_warning` / `rejected`), `utilization` (0–1), `resetsAt`
    - `rateLimitType` (`five_hour`, `seven_day`, `seven_day_opus`, `seven_day_sonnet`, `overage`), plus the overage fields
  - Today `pump()` drops these.
  - The experimental `query.usage_EXPERIMENTAL_…()` returns plan utilisation on demand, which would give an initial reading before any turn. The SDK marks it unstable, so put it behind a fallback.
- **Codex:**
  - The `account/rateLimits/updated` notification arrives during turns. A rate-limits read request on app-server start gives the initial value.
  - Expect `primary` / `secondary` windows with `usedPercent`, `windowDurationMins` and `resetsAt`, plus `planType`. Generate the protocol types to confirm.
- **Storing it:**
  - Keep the latest reading per provider and window in the main process: a small `usage_limits` table, or settings JSON with a timestamp.
  - Broadcast it as `usage:changed`. It is account-wide, not per chat.
- **Staleness:** readings only update while a session runs. Show "as of 12 min ago" when older than ~10 minutes, and refresh on app focus where an on-demand read exists.

**Where it shows (recommendation)**
- **Sidebar footer:** a compact, always-visible row pinned to the bottom of the sidebar, visible with every panel (Chats, Explorer, Search, Source Control).
  - One row per signed-in provider: its icon, then two thin bars stacked in about 16px of height. The top bar is the 5-hour window, the bottom bar is weekly.
  - Each bar ends in a short `42%` label.
  - Bars stay neutral gray until 70%, turn the warning colour at 70–90%, and the error colour above 90% or when rejected.
- **Click or hover:** opens a popover per provider with exact percentages, "resets in 2h 14m / Tue 09:00", plan name, overage status, the age of the reading, and a link to the provider's usage page.
- **Sidebar hidden:** the same information collapses to one tiny ring per provider at the right end of the status bar, so it never disappears.
- **In context:**
  - When the current chat's provider is over 80% of either window, a small warning chip appears in the composer: "Claude 5h · 86%". It offers the fallback provider configured in Access & Fallback.
  - The model picker shows each provider's remaining 5h percentage next to its name.
- **Settings › Providers:** a "Show usage limits" toggle (default on), and the same detail for every provider.
- **What it doesn't do:** no polling of the providers' web APIs, and no use of credentials outside the official CLI or SDK.

**Why the sidebar footer and not the top or the header:** it's peripheral, so it doesn't compete with the conversation. It's visible from every panel. Codex and the Claude apps also keep account status at the bottom-left, so it's where people look.

## Planned: switch provider before the limit is hit

Today the switch happens only after a turn fails. `fallback()` in `src/main/agent.ts` runs on a usage-limit error, records an error and then hands off. With the usage gauges in place, Ramu can switch **before** sending, so you never see the error.

**Rule**
- **Settings › Access & Fallback:**
  - "Switch provider when usage reaches **[90%]**" (choices: 80 / 90 / 95%, or Only when the limit is hit). It applies to both the 5-hour and weekly windows.
  - The existing fallback order decides where to go next. The existing *Auto fallback* toggle stays the master switch.
- **On send (`submit` / `send`, before `launch`):**
  - If the chat's provider is at or over the threshold in any window, or its last reading was `rejected`, and its reading is fresh (under ~15 minutes old, or confirmed by an on-demand read), Ramu switches to the first fallback provider that is under the threshold.
  - The switch uses the same handoff as today (`settings` event with `handoff: true`, `conversationHandoff` context), so the next agent picks up the conversation.
- **Edge cases:**
  - **Every provider over the threshold:** don't switch. Send with the current provider and show the warning chip. A real limit error still falls back as today.
  - **Mid-turn:** a `rate_limit_event` with `status: 'rejected'`, or a Codex rate-limit update at 100%, starts the existing fallback right away instead of waiting for the error. Steering and queued messages carry over.
  - **Background analysis** (titles, recaps, commit messages) follows the same rule silently.

**What you see (no dialog, no error)**
- **Before sending:** the composer's provider chip changes to "→ Codex" with a short reason, such as "Claude 5h at 92%, sending with Codex". You see where the message will go before you press Enter.
  - Clicking the chip offers **Keep Claude for this message** and **Keep Claude for this chat** (until the limit resets).
  - These are one-click choices in the chip menu, not a modal.
- **After sending:**
  - The separator Ramu already draws for handoffs reads "Switched to Codex · Claude's 5-hour limit was at 92% (resets 14:20)".
  - The separator has two actions: **Switch back now**, and **Return to Claude when it resets**.
- **Return when it resets:** off by default. When on, the first message after the reset goes back to the original provider, with the same visible handoff.
- **Toast:** only when the chat isn't on screen (a background or scheduled run): "Chat X continued with Codex: Claude limit at 92%".
- **No blocking:** sending never waits on a confirmation, so an unattended queue or schedule keeps running.

**Why no dialog:** the decision is reversible and the default is almost always right. A modal at send time would interrupt flow and stall queued or scheduled messages. Showing the destination before you send, plus a one-click undo after, gives the same control without the friction.

## Planned: fallback order per provider, with model and effort

**Today:**
- `fallback()` in `src/main/agent.ts` hard-codes Claude ↔ Codex.
- It takes the target's *default* model and default effort, and resets the service tier to standard.
- After one hop it gives up ("Both providers reached a usage limit").
- Configuring Claude → Codex 5 high, then OpenCode, isn't possible. Neither is staying on Claude with a cheaper model when only the Opus weekly limit is hit.

**What to build**
- **Settings › Access & Fallback, one ordered fallback list per provider:**
  - Example: "When **Claude** is limited, continue with:" then `1. Codex · GPT-6.1 Sol · High`, `2. Claude · Sonnet · Medium`, `3. OpenCode · <model> · Default`.
  - Each entry is a full step: **provider, model, effort, service tier** (Codex Fast / Standard).
  - Use the same model/effort controls as the model bar, so entries can't name a model that doesn't exist.
  - Rows are drag-to-reorder. Add from the installed providers' catalogues. Each provider's list is independent, so Codex can fall back to Claude while Claude falls back to OpenCode.
- **Same-provider entries are allowed.** Claude reports per-model weekly windows (`seven_day_opus`, `seven_day_sonnet`).
  - When only the window for the model in use is exhausted, an entry like "Claude · Sonnet" keeps the same provider and session. That means no handoff: just `setModel` on the live query, or a resume with the new model.
  - Skip entries whose own window is also over the threshold.
- **Reuse model sets:** a fallback entry can point at a model-set step, or a whole set can be marked "use as fallback order". One concept instead of two.
- **Defaults** keep today's behaviour: Claude → Codex (default model, default effort) and Codex → Claude. The list starts filled in with those, so nothing changes until you edit it.

**How the chain runs**
- Walk the list in order and skip an entry when:
  - its provider isn't installed or signed in, or
  - its model is missing from the current catalogue (show "unavailable" in Settings), or
  - its usage reading is over the switch threshold.
- The first remaining entry wins.
- `attempted` tracks steps (provider + model), not just providers. The chain can then go Claude Opus → Claude Sonnet → Codex in one chat before reporting that every option is limited.
- **Effort:** use the entry's effort. If the target model doesn't support it, pick the nearest supported level (high → xhigh → medium, …). Record the mapping in the handoff separator, e.g. "effort high → medium".
- **Access mode carries over.** If the target can't express it (some ACP providers have no `edits` mode), use the nearest stricter mode, never a looser one.
- **Per-chat override:** the composer chip menu from the pre-emptive switch adds "Fall back to…" with the chain listed, so you can pick a different entry for this chat only.
- **Reset return:** with "Return when it resets" on, the chat goes back to the step it started on (provider, model and effort), not just the provider.

**What you see**
- The handoff separator names the whole step: "Switched to Codex · GPT-6.1 Sol · High — Claude's 5-hour limit was at 92%".
- Settings shows each chain with live usage next to each entry, so you can see which one would be used right now.

## Planned: sub-agents from a different provider

Let the main agent hand sub-tasks to another provider. Examples: Claude plans and Codex does the edits, or Codex leads and Claude reviews.

**Three modes (Settings › Agents › Sub-agents)**
1. **Native (default).** Each provider uses its own sub-agents: Claude's Agent tool, Codex's spawn_agent. This is what's built today.
2. **One provider for all.** Every provider's sub-agents run on one chosen step: provider, model, effort and service tier, picked with the same controls as the fallback list.
3. **Per provider.** A row per provider: "When **Claude** starts a sub-agent, use: Native / Codex · GPT-6.1 Sol · High / …", and the same for Codex, OpenCode and the others. For example, Claude → Codex while Codex → Native.

**Per-type mapping (optional)**
- Modes 2 and 3 can split by sub-agent type: "Explore → Codex Low, Plan → Claude Opus, everything else → Native".
- Types come from Claude's `subagent_type` and Codex's agent roles. Ramu's own list covers providers that have none.

**Per-chat override:** a "Sub-agents: Native / <step>" entry in the composer's model menu.

**How it works**
- **The tool:**
  - In modes 2 and 3, Ramu gives the main agent a `ramu_agent` tool on the per-chat MCP connection it already has. The tool takes `description`, `prompt`, `type`, `background` and `name`, the same shape as Claude's Agent tool.
  - Ramu hides the native tool so the model uses the new one:
    - Claude: `disallowedTools: ['Agent', 'Task']` plus a short appended system note.
    - Codex: turn off its multi-agent tools through app-server config (check the exact flag).
  - Types mapped to Native keep the native tool.
- **The child session:**
  - Calling the tool makes Ramu start a **child session** on the chosen provider, model and effort, with `parent_session_id` set in `agent_sessions`. It runs in the same scope (cwd, extra directories, covers) and uses the parent's access mode or a stricter one.
  - Child sessions are hidden from chat lists and tabs and shown only as sub-agents of their parent.
- **Results:**
  - **Foreground:** the tool call waits and returns the child's final answer as the tool result.
  - **Background:** it returns at once with the agent id. When the child finishes, Ramu sends the parent a steering message ("Sub-agent <name> finished: <report>"), the same way Claude delivers a task notification.
- **Same UI as native sub-agents:** the child's events become one `agent` card in the parent chat, with progress, its own transcript in the side panel, the report, and a provider badge (e.g. "Codex · GPT-6.1 Sol").
  - **Better than native:** Ramu owns the child, so **messages and Stop go straight to the child session**, with no relay through the main agent.
- **Approvals:** the child's permission requests and questions show in the parent chat, on its card and in its panel. They pause only the child.

**Rules**
- **Checkout:**
  - A parent and its children count as one writer group on the checkout. A different chat still can't write there at the same time.
  - An optional "Isolate sub-agents" setting gives each writing child its own worktree. Its changes come back as a review the parent can apply.
- **Usage and fallback:** see the next section.
- **Limits:**
  - Nesting depth of 1 by default: children can't start their own cross-provider sub-agents, but may use native ones.
  - A cap on concurrent children per chat (default 3).
  - Cost and tokens add up on the parent card.
- **Restart:** child transcripts are stored like any session, so after a restart the panel shows the real transcript, not just "Stopped".
- **Context:** a child gets only its prompt, the same as a native sub-agent. With "Share chat context" on, the parent's recent transcript is attached from `transcriptOf()`, up to a size limit.

### Sub-agent fallback

Sub-agents use up usage limits too. They are checked twice: before one starts, and while it runs.

**Which list applies (Settings › Agents › Sub-agents › Fallback)**
- **Same as main (default):** a sub-agent on provider X walks X's fallback list from *Fallback order per provider*.
- **Separate list for sub-agents:** each provider gets a second ordered list used only for sub-agents.
  - This suits cheaper or faster models, e.g. "Claude sub-agents limited → Codex · Low, then Claude · Haiku".
  - The editor is the same as the main list, with a "Copy from main" button.
- **Threshold:** sub-agents use the same switch threshold as the main agent unless "Separate threshold" is set, e.g. move sub-agents off at 80% so the main agent keeps its headroom until 95%.

**Before a sub-agent starts**
- The target is chosen when the sub-agent is spawned:
  - In *Native* mode, the target is the main agent's provider.
  - In the other two modes, it is the mapped step.
- If the target is over the threshold, Ramu walks the applicable list and starts the sub-agent on the first entry under it, so it never begins on an exhausted provider.
- The card says so: "Explore · Codex Low (Claude 5h at 91%)".
- **Native-mode sub-agents can be redirected too:**
  - **Claude:** a `PreToolUse` hook (hooks run in every permission mode, including full access) sees the `Agent` / `Task` call. When Claude is over the threshold, the hook denies it with a reason telling the model to call `ramu_agent` with the same arguments. Ramu then starts the sub-agent on the fallback entry. Under the threshold, native sub-agents run untouched.
  - **Codex:** `spawn_agent` can't be intercepted. When Codex is over the threshold at the start of a turn, Ramu switches that turn to the `ramu_agent` tool instead (native tools off, `ramu_agent` on), so new sub-agents go through Ramu. Sub-agents already running stay native. Verify that the app-server allows changing tools per turn; if it doesn't, apply this from the next session.
- **Every entry over the threshold:** start on the preferred target anyway and mark the card "near limit". A real limit error falls through to the mid-run handling below.

**While a sub-agent runs**
- **Ramu-run sub-agents** (cross-provider, or redirected): the child is a normal session, so its own usage-limit errors and `rejected` rate-limit events trigger the fallback for that child only.
  - The child is handed off to the next entry with its transcript (`conversationHandoff` of the child, plus "continue the sub-task, don't repeat completed steps").
  - The card shows a step line: "Codex Low → Claude Haiku · Codex limit reached".
  - The main agent is never told unless the whole list is exhausted. When it is, the tool call returns an error result ("All fallback options for this sub-agent are limited") so the main agent can decide what to do.
  - `attempted` is tracked per child session, separate from the parent's.
- **Native sub-agents** (Claude Agent tool, Codex spawn_agent): Ramu can't move them, because the provider owns them. When one fails with a usage-limit error (`task_notification` with status `failed` and a usage-limit error, or a Codex sub-agent turn failing with `usageLimitExceeded`), Ramu:
  1. Marks the card "Stopped: limit reached", with its transcript so far.
  2. Restarts the same sub-task as a Ramu-run sub-agent on the next fallback entry. Its prompt carries the original task prompt plus the native sub-agent's transcript, as a handoff.
  3. Reports the new result to the main agent the same way: as the tool result if the main agent is still waiting, otherwise as a steering message ("Sub-agent <name> continued on Codex after Claude's limit; result: …").
  - Setting: "Continue limited native sub-agents on the fallback list" (default on).
- **Main agent exhausted while its sub-agents run:** the main agent switches along its own list as usual. Sub-agents already running on other providers keep going, and their results are delivered to the main agent's new provider through the handoff. Native sub-agents of the old provider stop with it and are restarted by the rule above.

**What you see**
- Each sub-agent card shows the provider it actually ran on, plus every switch as a step line.
- The panel's transcript keeps all of it, with a divider at each switch.
- Usage gauges include sub-agent usage, since it is the same account.

Suggested order: Everything planned here is built. What is left is the “Remaining limits” and “Known gaps” lists above, including the remaining isolation and native-agent limits described above. Plan mode is intentionally not built: it is expected to be obsolete.
