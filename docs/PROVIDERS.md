# Providers

## Setup

| Provider | Runtime | Setup |
| --- | --- | --- |
| Claude Code | Claude Agent SDK | Install Claude Code and sign in |
| Codex | Codex app-server | Install Codex and sign in |
| OpenCode | OpenCode 2 HTTP API (`@opencode/client`), one `opencode serve` per thread; 1.x uses `opencode acp` | Install OpenCode and configure a model provider |
| Cursor | Cursor SDK (`@cursor/sdk`) | **Login** (Cursor's browser sign-in) or set `CURSOR_API_KEY`. The CLI's `agent login` does not carry over |
| Antigravity | Official ACP runtime | **Settings → Providers → Antigravity → Install runtime**, then **Login** (Google sign-in in your browser) |

**Settings → Providers** logs in, selects accounts, updates CLIs and sets executable paths (Advanced). Ramu reads model IDs from the installed runtime. A new profile with no projects opens a short setup flow that detects installed CLIs, offers their sign-in flows, picks a default provider and opens a repository picker; **Check again** refreshes sign-in status and **Set up later** skips it. Authentication stays with the provider runtime.

**Antigravity** has no CLI: **Install runtime** downloads Google's archive from the [ACP registry entry](https://github.com/agentclientprotocol/registry/blob/main/antigravity-acp/agent.json) (only `dl.google.com` is accepted), unpacks it into Ramu's provider directory, checks the ACP handshake, then activates it. The previous version is kept for one update and running threads are not interrupted; the same button updates it. Unpacking needs `unzip` on macOS and Linux. A path under Advanced or `RAMU_ANTIGRAVITY_BIN` takes precedence and is yours to update (set `ANTIGRAVITY_HARNESS_PATH` if the helper is not beside it).

Executable overrides are `RAMU_CLAUDE_BIN`, `RAMU_CODEX_BIN`, `RAMU_OPENCODE_BIN`, `RAMU_CURSOR_BIN` and `RAMU_ANTIGRAVITY_BIN`; saved paths win, and paths must name an executable without shell arguments.

## Accounts and updates

Codex and OpenCode support separate credential profiles; **Default CLI account** uses the system profile. A saved account applies to new threads; existing threads keep theirs. Usage readings are per account. Ramu stores no provider passwords. When a thread reaches a limit, every enabled account of its provider is tried in order (selected, default, then the others) before falling back to another model; turn an account off in Settings to remove it from rotation.

Version checks run in the background service. CLI auto-update is opt-in and affects new processes only. Custom Codex and Antigravity paths use their own updaters.

## Runtime compatibility

The host bundles a versioned policy (`apps/server/src/providers/compatibilityPolicy.ts`) and rates the runtime it launches **Supported**, **Limited**, **Incompatible** or **Unverified** (no rule, unknown version or failed probe). Rules require evidence, so providers without one report Unverified and nothing is blocked. The provider card shows the status with details and, when a runtime is flagged, **Update** (only to a release the policy accepts), **Update Ramu** (bundled SDKs), **Change executable path** and **Check again**. A custom executable is never replaced.

A proven incompatible runtime blocks only the launch that needs it, at one shared boundary (threads, helpers, advisors, background analysis, fallback targets). The thread names the feature and fix without retrying, and the conversation and queue stay. Fallback and account routing skip it without treating it as usage-limited. Running sessions keep their launch snapshot. Decisions are cached by executable identity and policy revision and probed on the host only; auto-update skips an incompatible target.

## Environment variables

**Settings → Environment variables** adds variables to every provider process on the host (sessions, sign-in checks, version probes, usage readers). **All providers** applies globally; a provider's own list applies to it and all its accounts and wins over a global one; both win over the shell environment. An account's own config-folder variables (such as `CLAUDE_CONFIG_DIR`) always win so accounts stay isolated. `RAMU_*` names are reserved.

Paste `.env` text into a name field to fill several rows, edit the whole list as **.env text**, or **Copy as .env**. Values are masked until **Show values**. Changes apply to new threads. Values live as one entry in the host credential store (`providers/environmentStore.ts`); app state keeps only names and an opaque reference. If the store is locked, providers start without them and Settings offers **Try again**. Only the host reads values; paired clients see names.

## Capabilities

Each provider runs on its own SDK or protocol where one exists (see `apps/server/src/providers/runners.ts`); Antigravity and OpenCode 1.x use ACP. Ramu uses a provider's native features first (Claude's advisor, blocking question tools) and adds its own only where the native one cannot follow Ramu's flow: another provider or model, async answers, goals that survive fallback (`NativeFeatures` in `providers/adapter.ts`).

### Access modes

**Auto:** Ramu's own MCP tools run without an extra prompt; other tools follow the provider's policy. Providers with automatic review use it; Antigravity uses native `auto_edit` plus Ramu's command rules (never YOLO); ACP runtimes select native Auto only if they advertise it; OpenCode Auto approves each emitted permission request once while explicit deny rules stay in force (no classifier). Cursor uses its SDK Auto-review with workspace sandboxing. Questions, plan approvals and read-only analysis keep their restrictions.

**Allow edits:** OpenCode 2 sets session rules that allow edits and workspace reads and ask for commands and other actions (1.x gets equivalent inline config); Antigravity selects `auto_edit`; Cursor keeps the sandbox with Auto-review off (its SDK has no interactive command approval). Read-only and restricted threads get no edit policy.

**Full access:** OpenCode receives `"*": "allow"` as a session rule, which also overrides the user's own ask and deny rules; Cursor runs unsandboxed.

**Approvals:** prompts default to **Allow once**. For commands, pick a reusable prefix rule such as `git diff *` (the initial choice) or `git *`, or keep the exact request. **Allow for this project** saves it for one project and **Allow for this user** for all projects on the host, per provider. Rules match whole command prefixes at argument boundaries and never approve compound shell expressions or substitutions; Claude's SDK suggestions are preferred when present, and plan approvals stay once-only. **Permissions → Saved approvals** lists saved rules and removes one, a project's, user rules or all; **Forget approval** on a request removes its rule. Rules live in Ramu's per-computer data; Ramu does not edit provider settings files or implement Claude's allow/ask/deny engine. The prompts follow [Claude Code's](https://code.claude.com/docs/en/permissions#permission-system).

**Antigravity Auto rules** (`apps/server/src/agent/autoCommandRules.ts`) stand in for the automatic reviewer Antigravity lacks. Command lines are split on `&&`, `||`, `;` and `|`; every part must be routine to run, and one risky part makes the whole line ask. They are review rules, not execution denials.

- **Runs:** read-only commands inside the working tree (`ls`, `cat`, `grep`, `rg`, `jq`…), Git reads and local Git changes (`add`, `commit`, `switch`, `stash`…), `mkdir`/`touch`/`cp`/`mv` inside the workspace, tests, linters, type checks, builds and lockfile installs, and version checks.
- **Always asks, even over a saved rule:** deleting or overwriting files; Git that discards work or rewrites history; credentials and key stores; privilege and system changes; killing processes; tunnels and raw sockets; options that disarm a check (`--no-verify`, `--insecure`) or make a read command write; pushing, publishing, deploying or infrastructure changes.
- **Unreadable code asks:** shell expansion, redirects other than to `/dev/null`, subshells, background jobs, wrappers (`bash -c`, `env`, `xargs`, `sudo`), inline interpreter code and absolute-path executables.
- **Everything else asks:** `curl`, new dependencies, `git merge`/`pull`, reading outside the workspace.

Defaults are internal, replaced when Ramu changes them (your saved rules are kept), never listed under Saved approvals, and shown as **Allowed by Auto** without a Forget action.

### Provider specifics

- **OpenCode 2:** Ramu's tools travel in the process's inline config (`mcp.servers.ramu`); nothing is written to your OpenCode config or database. Manual prompts and questions appear in Ramu. Steering adds your message to the running turn; effort is passed as the model variant.
- **Cursor:** steering uses the SDK's `steer`, and a declined steer runs as the next turn. Models come from Cursor's API once signed in, from the CLI before.

### ACP runtimes (Antigravity, OpenCode 1.x)

- **Steering:** these cannot take input mid-turn, so **Steer** cancels the turn and continues the session with your message; only your messages do this (including Send now and messaging a helper), while Ramu's own late advice, async answers and helper reports queue. **Queue** waits for the turn to end.
- **Resuming:** `session/resume` if offered, otherwise `session/load`; if neither works, a new session receives the transcript as a handoff and the transcript says so.
- **Optional features:** images go as image blocks only if advertised, otherwise as a saved path. Ramu's tools reach the runtime over HTTP MCP; a runtime without HTTP MCP gets a visible warning. Inline image bytes are dropped from tool payloads.
- **Effort:** offered when the runtime advertises `thought_level` (OpenCode 1.x); Antigravity encodes it in model names.
- **Sub-agents:** native ones show as stoppable task cards (stopping cancels the turn). OpenCode streams helper tool calls and replies; Cursor and Antigravity report start and finish. Native helpers cannot be messaged; `ramu_agent` helpers can. To route through Ramu, OpenCode's `task` permission is denied, Cursor's `task` tool is disallowed and Antigravity's `invoke_subagent` is refused; a routing change restarts an idle runtime on the same session.
- **Side questions:** OpenCode answers on a throwaway session fork with every tool refused; Cursor and Antigravity answer from the visible conversation.
- **Limits:** one classifier (`providers/limitClassifier.ts`) decides what is a limit: structured fields, then known provider wording, then a low-confidence generic match. A confident match triggers fallback and records a *limited* reading until the stated wait passes (or 15 minutes). A low-confidence match, such as a bare "rate limit" or 429, gets one quiet retry; a reply counts only if short with no tool calls. Prompt-too-long, context-length and authentication errors are never limits. The reading is marked as inferred, so **Try again** can still probe. Fixtures are synthetic (`apps/server/test/fixtures/limits/`); real captures still need live runs.

Read-only analysis requires the provider's read-only mode or sandbox. See [Agents](AGENT-ROUTING.md) and [Background work](AUTOMATION.md).

### Usage limits

**Settings → Models → When a usage limit is reached** chooses **Switch to another model** (default), **Wait on this model** or **Stop and let me decide**. Switching applies to new threads; waiting and stopping apply to every thread, including ones already waiting. Threads can override auto-resume from the tray, the provider chip or the phone's Agent settings. The state is worded **Limit reached · resumes …**, never **Paused**, which means a goal you paused ([Goals](GOALS.md#paused-by-you-or-by-a-limit)). With **When to switch** set to a percentage, Ramu refreshes the checkpoint of each idle thread that would be switched once usage crosses it (one review of the daily budget per thread), so the handoff carries a recent summary ([Learning](LEARNING.md#checkpoint-refresh-near-a-limit)); the handoff never waits for it. Controls are in [UI](UI.md#usage-limits), server behavior in [Agents](AGENT-ROUTING.md#usage-limits-and-fallback).

**Plan usage for Cursor and Antigravity.** Neither runtime reports limits, so Ramu reads them from the services the provider's own apps use, at most every five minutes and only for enabled providers. Gauges appear in the sidebar footer and **Settings → Models** and feed fallback like Claude's and Codex's.

- **Cursor** (`providers/providerUsage.ts`): the CLI login (`~/.cursor/auth.json` or `CURSOR_AUTH_TOKEN`) calls Cursor's dashboard `GetCurrentPeriodUsage`, giving **Overall**, **Cursor models** and **Other models**, all resetting at the billing-cycle end. On macOS the login is in the Keychain, so it is read only when **Settings → Providers → Cursor → Show plan usage** is on. The token goes only to Cursor's endpoint.
- **Antigravity:** the runtime's saved Google login is refreshed and Google Cloud Code's `retrieveUserQuotaSummary` returns 5-hour and weekly windows for **Gemini** and the shared **Claude and GPT** allowance; accounts without a summary fall back to per-model quotas from `fetchAvailableModels`, shown as a plain **Quota**. Separate accounts use private file storage. Nothing shows while signed out.

## Advisor

**Settings → Goals & delegation → Advisor** consults a second model. Each consultation sends the thread transcript and tool summaries to that model and uses its tokens. Main threads can use it; helpers cannot. By default agents keep working on independent tasks while advice arrives; **Always wait for advice** pauses every consultation. Advice cards show the question, response, duration and a Stop control.

For threads Ramu starts, its advisor replaces Claude Code's configured one without editing Claude's settings; turning it off restores Claude's behavior for new sessions. Settings apply when a thread process starts. Pending advice is lost on a service restart and must be requested again.

## Testing

Simulated fixtures check adapters and transcripts but not every live runtime. Provider authentication and real model calls need manual validation. Add focused tests for advisor changes.
