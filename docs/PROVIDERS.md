# Providers

## Setup

| Provider | Runtime | Setup |
| --- | --- | --- |
| Claude Code | Claude Agent SDK | Install Claude Code and sign in |
| Codex | Codex app-server | Install Codex and sign in |
| OpenCode | OpenCode 2 HTTP API (`@opencode/client`), one `opencode serve` per thread; 1.x uses `opencode acp` | Install OpenCode and configure a model provider |
| Cursor | Cursor SDK (`@cursor/sdk`) | **Login** (opens Cursor's browser sign-in) or set `CURSOR_API_KEY`. The CLI's `agent login` does not carry over |
| Antigravity | Official ACP runtime | **Settings → Providers → Antigravity → Install runtime** (Ramu downloads it), then **Login** (opens Google sign-in in your browser) |

Use **Settings → Providers** to log in, select accounts, update CLIs, and set executable paths under Advanced. Ramu reads model IDs from the installed runtime.

Antigravity's ACP runtime is separate from its IDE and CLI, so there is no CLI to install. **Install runtime** downloads Google's official archive from the [ACP registry entry](https://github.com/agentclientprotocol/registry/blob/main/antigravity-acp/agent.json) (only `dl.google.com` is accepted), unpacks it into Ramu's own provider directory, checks that it answers the ACP handshake, and only then makes it the active version. The previous version is kept for one update, and running threads are not interrupted. The same button updates it. A path you set under Advanced, or `RAMU_ANTIGRAVITY_BIN`, takes precedence and is yours to update; set the harness path there or `ANTIGRAVITY_HARNESS_PATH` if the helper is not beside it. Unpacking needs `unzip` on macOS and Linux.

Executable overrides are `RAMU_CLAUDE_BIN`, `RAMU_CODEX_BIN`, `RAMU_OPENCODE_BIN`, `RAMU_CURSOR_BIN`, and `RAMU_ANTIGRAVITY_BIN`. Saved paths take precedence. Paths must name executables, without shell arguments.

## Accounts and updates

Codex and OpenCode support separate credential profiles. **Default CLI account** uses the system profile. Saving another account applies to new threads; existing threads keep their account. Usage readings are account-specific. Authentication is handled by provider runtimes, not passwords stored in Ramu preferences.

Version checks run in the background service. CLI auto-update is opt-in and affects new processes; running threads stay connected. Custom Codex and Antigravity paths use their installation's own updater.

## Capabilities

Each provider runs through its own SDK or app protocol where one exists: Claude on the Claude Agent SDK, Codex on its app-server, OpenCode 2 on its HTTP API, and Cursor on its SDK. Antigravity and OpenCode 1.x use ACP. Each provider's thread runner is listed in `apps/server/src/providers/runners.ts`.

**Auto access:** Ramu's own MCP tools run without an extra permission prompt. Other tools follow the provider's native policy. OpenCode Auto approves emitted permission requests, like its CLI `--auto`; providers with automatic review use it, and Antigravity uses native auto-edit plus Ramu's command rules. ACP runtimes select native Auto only when they advertise it, and keep their default policy otherwise. Questions, explicit plan approvals, and read-only analysis keep their existing restrictions.

Manual tool approvals default to **Allow once**. For simple command requests, choose a reusable rule such as `git diff *` (the initial selection) or `git *`, or keep the exact request. **Allow for this project** saves the rule for one project; **Allow for this user** covers all projects on this host, for the same provider. Claude SDK command-rule suggestions are preferred when available, and its once-only restriction is respected. Command rules match whole command prefixes with argument boundaries, and never approve compound shell expressions or substitutions. Other requests with complete inputs can remember the exact request; explicit plan approvals stay once-only. **Permissions → Saved approvals** lists the saved rules and supports removing one rule, one project's rules, all project rules, user rules, or all rules. **Forget approval** on a completed request removes that request's saved rule.

Ramu uses a provider's own features first, such as Claude Code's advisor and Claude's and Codex's blocking question tools, and adds its own only where the native one cannot follow Ramu's flow: another provider or model, async answers, or goals that survive fallback. See `NativeFeatures` in `providers/adapter.ts`.

- **OpenCode 2:** Ramu's tools travel in the thread process's inline config (`mcp.servers.ramu`), so nothing is written to your OpenCode config or database. Manual permission prompts and forms (questions) appear in Ramu. Auto and legacy Full access answer tool permission prompts automatically, preserving native denials. Steering adds your message to the running turn. Reasoning effort is passed as the model variant.
- **Cursor:** the SDK has no interactive approval step; Auto enables its native Auto-review classifier. Full access runs unsandboxed; other access levels run in Cursor's sandbox, which keeps writes in the workspace and blocks network access. Steering uses the SDK's `steer`; when Cursor declines it, the message runs as the next turn. Models come from Cursor's API once you are signed in, and from the CLI before that.

**Plan usage for Cursor and Antigravity.** Neither runtime reports its limits, so Ramu reads them from the same services the provider's own apps use, at most every five minutes, for providers that are turned on. Gauges appear in the sidebar footer and **Settings → Access & Fallback**, and feed fallback like Claude's and Codex's.

- **Cursor** (`providers/providerUsage.ts`): the CLI's login (`~/.cursor/auth.json`, or `CURSOR_AUTH_TOKEN`) calls Cursor's dashboard `GetCurrentPeriodUsage`. You get **Overall** (the two allowances combined, not a third quota), **Cursor models** (Composer and Grok use it first) and **Other models** (Claude, GPT and Gemini). All reset at the billing-cycle end. On macOS the login lives in the Keychain, so it is only read when **Settings → Providers & models → Cursor → Show plan usage** is on. The token is only ever sent to Cursor's own endpoint.
- **Antigravity:** the runtime's saved Google login (`antigravity-acp/acp_token.json` under its profile) is refreshed, then Google Cloud Code's `retrieveUserQuotaSummary` returns 5-hour and weekly windows for **Gemini** and for the shared **Claude and GPT** allowance (shown for both). Accounts without a summary fall back to `fetchAvailableModels`, whose per-model quotas show as a plain **Quota** (no invented reset cadence) or weekly. Nothing shows while signed out.

The rest of this section describes the ACP runtimes (Antigravity, OpenCode 1.x).

- **Steering:** these runtimes cannot take input mid-turn, so **Steer** cancels the running turn and continues the same session with your message; the cancelled turn is not reported as finished. Only messages you send (including Send now, and stopping or messaging a helper) do this. Ramu's own messages, such as late advice, async answers and helper reports, are queued so they never discard the agent's work. **Queue** waits for the turn to end.
- **Resuming:** a thread continues its saved session with `session/resume` when the runtime offers it, otherwise `session/load`. If neither works, or the runtime no longer has the session, Ramu starts a new session and hands it the conversation transcript, the same as when switching providers. The transcript shows a settings row saying so.
- **Optional protocol features:** images are sent as image blocks only when the runtime advertises them; otherwise the saved file path goes in the text. Ramu's tools (questions, `ramu_agent`, advice) reach the runtime over HTTP MCP, and a runtime that lists its MCP support without HTTP gets a visible warning in the thread instead of silently losing them.
- **Plans and tool output:** Antigravity's shell calls show their command and output, and inline image bytes are dropped from tool payloads so they don't fill the transcript.
- **Limits and fallback:** the runtime itself reports no usage (Antigravity's plan usage is read separately, see **Plan usage for Cursor and Antigravity** above). A rejected request or a reply that is only a limit notice (quota exhausted, usage limit reached, rate limited, HTTP 429) triggers fallback and is recorded as a *limited* reading, so routing avoids that provider until the notice's stated wait passes, or for 15 minutes.
- **Reasoning effort:** offered when the runtime advertises a `thought_level` option (OpenCode 1.x). Antigravity encodes effort in its model names, so each level is a separate model.
- **Sub-agents:** native sub-agents from all three appear as task cards that can be stopped (stopping cancels the turn and continues without the helper). OpenCode also streams each helper's tool calls and replies into its card; Cursor and Antigravity report only start and finish. Native helpers cannot receive messages; helpers started through `ramu_agent` can.
- **Routing sub-agents through Ramu:** OpenCode's own sub-agent tool is switched off (its `task` permission is denied for that session), Cursor's `task` tool is disallowed, and Antigravity's `invoke_subagent` requests are refused, so helpers go through `ramu_agent`. A routing change restarts an idle thread's runtime before the next message, resuming the same session.
- **Side questions:** run on a throwaway fork of the OpenCode session, with every tool refused. Cursor and Antigravity cannot fork, so they answer from the visible conversation.

Read-only analysis requires the provider's read-only mode or native sandbox policy. See [agents and routing](AGENTS.md) and [background workflows](AUTOMATION.md).

## Advisor

Enable **Settings → Advisor** to consult a second model. Each consultation sends the thread transcript and tool summaries to that model and uses its tokens. Main threads can use the advisor; helpers do not.

By default, agents can continue independent work while advice arrives. **Always wait for advice** pauses every consultation. Advice cards show the question, response, duration, and Stop control.

Ramu's advisor replaces Claude Code's configured advisor for threads it starts, without editing Claude's settings. Turning Ramu's advisor off restores normal Claude advisor behavior for new sessions. Settings apply when a thread process starts or restarts. Pending advice is lost on a service restart and must be requested again.

## Checks

Simulated fixtures check adapters and transcripts; they do not verify every live runtime. Add focused unit or integration tests for advisor behavior changes, manually verify affected advisor UI, and run `pnpm test:desktop-smoke` after building for startup validation. Provider authentication and real model calls need separate validation.

## First run

A new profile with no projects opens a short setup flow. It detects installed provider CLIs, offers their existing sign-in flows, lets you choose a default provider, and opens a repository picker. **Check again** refreshes sign-in status after using the setup terminal. **Set up later** keeps the normal workspace available; established profiles keep their projects and do not repeat onboarding. Authentication stays with the provider runtime.

The command-prefix UI follows [Claude Code permission prompts](https://code.claude.com/docs/en/permissions#permission-system) and its [SDK rule suggestions](https://code.claude.com/docs/en/agent-sdk/user-input). Ramu stores these app-managed rules in its own per-computer data so the same management UI works across providers; this does not edit the provider CLI’s settings files or implement Claude’s full allow/ask/deny policy engine.

Provider Auto behavior was compared against [T3 Code's modes](https://github.com/pingdotgg/t3code/blob/cfafb4bb54d244e4612f5681aad3832ea64cb0fb/docs/user/permission-modes.md). Cursor uses its SDK `local.autoReview` classifier with workspace sandboxing. Antigravity ACP 1.4.0 was probed with initialize/session-new only: it advertises `default`, `auto_edit`, and `yolo`, with no `auto`. Ramu selects `auto_edit` and layers its own command allow/review rules on top; Auto never selects YOLO. Saved rules suppress repeated matching requests.

OpenCode follows its [native CLI Auto semantics](https://docs.opencode.ai/docs/permissions/#auto-mode): **Auto** approves every permission request the provider emits, once, while explicit deny rules (which never produce a request) stay in force. There is no safety classifier. **Full access** sends OpenCode's own `"*": "allow"` as a session rule. OpenCode evaluates rules last match first and session rules follow the user's config, so Full also overrides the user's own ask and deny rules; this has not been exercised against a live OpenCode model. Questions remain interactive, and read-only/restricted runs still reject tool approvals. T3 Code falls back to asking on OpenCode Auto; Ramu uses OpenCode's native Auto instead.

**Allow edits** follows T3 Code's provider mappings: OpenCode 2 sets native session rules that allow edits and workspace reads, ask for commands and other actions, and preserve environment-file prompts. The rules are applied on creation and resume; OpenCode 1.x receives the equivalent inline config. Antigravity selects advertised native `auto_edit` (modern config options or legacy session modes). Cursor keeps the workspace sandbox enabled with Auto-review disabled; the SDK has no interactive command approval flow, so its mode is sandboxed execution rather than an edit-only command gate. Read-only and restricted threads do not receive the edit policy.

**Antigravity Auto rules** (`apps/server/src/agent/autoCommandRules.ts`) are Ramu's own stand-in for the automatic reviewer Antigravity lacks. They copy what Claude Code's, Codex's and Cursor's Auto trust and stop on: routine work inside the workspace runs, and the risk families those reviewers block ask.

- **Runs without asking:** read-only commands that stay in the working tree (`ls`, `cat`, `grep`, `rg`, `find` without `-delete`/`-exec`, `jq`, `cd`, `pwd`…); Git reads (`status`, `diff`, `log`, `show`, `branch` listing, `blame`, `grep`, `fetch`…); local Git changes (`add`, `commit`, `switch`, `checkout -b`, `stash`, `restore --staged`); `mkdir`, `touch`, `cp`, `mv` inside the workspace; tests, linters, type checks, builds and lockfile installs (`pnpm test`, `pnpm --filter x typecheck`, `npm ci`, `vitest`, `tsc`, `eslint`, `pytest`, `cargo test`, `go test`, `make test`…); and version checks (`npm --version`).
- **Always asks, even above a broader saved rule:** deleting or overwriting files (`rm`, `find -delete`, `dd`); Git that discards work or rewrites history (`reset`, `clean`, `restore`, `checkout --`, `stash drop`, `branch -D`, `commit --amend`, `rebase`, remote and config changes, global overrides such as `-c`); credentials and key stores (`.env`, `.ssh`, `.aws`, `printenv`, keychains, `gh auth`); privilege and system changes (`sudo`, `chmod`, `chown`, `launchctl`); killing processes; tunnels and raw sockets (`ngrok`, `nc`, `ssh -R`); options that disarm a check (`--insecure`, `--no-verify`, `--dangerously-skip-permissions`) or make a read command write (`--output`, `--ext-diff`); and pushing, publishing, deploying or changing infrastructure (`git push`, `npm publish`, `docker push`, `gh pr merge`, `kubectl`, `terraform`, cloud CLIs).
- **Unreadable code asks:** shell expansion and substitution, redirects other than to `/dev/null`, subshells, background jobs, wrappers (`bash -c`, `env`, `xargs`, `sudo`), inline interpreter code (`node -e`, `python -c`) and absolute-path executables.
- **Everything else is unknown and asks:** `curl`, package installs of new dependencies, `git merge`/`pull`, reading outside the workspace, and so on. Approve once, or save your own rule.

Command lines are split on `&&`, `||`, `;` and `|`; every part must be routine for the line to run, and one risky part makes the line ask. These are review rules, not execution denials.

Defaults are internal, scoped to Antigravity and to Auto today (the rule engine is provider-neutral), and replaced once whenever Ramu changes them; rules you saved are kept. **Permissions → Saved approvals** shows only approvals the user saved; predefined rules are excluded from the Settings API and cannot be removed by its individual or scoped removal actions. Automatic decisions display **Allowed by Auto**, without presenting a saved user approval or Forget action. Defaults are initialized once. This intentionally extends T3 Code's Antigravity Auto behavior.
