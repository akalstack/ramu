# Providers

## Setup

| Provider | Runtime | Setup |
| --- | --- | --- |
| Claude Code | Ramu ACP host over Claude Agent SDK | Install Claude Code and sign in |
| Codex | Ramu ACP host over Codex app-server | Install Codex and sign in |
| OpenCode | `opencode acp` | Install OpenCode and configure a model provider |
| Cursor | `agent acp` | Install Cursor CLI and run `agent login` |
| Antigravity | Official ACP runtime | **Settings → Providers → Antigravity → Install runtime** (Ramu downloads it), then **Login** (opens Google sign-in in your browser) |

Use **Settings → Providers** to log in, select accounts, update CLIs, and set executable paths under Advanced. Ramu reads model IDs from the installed runtime.

Antigravity's ACP runtime is separate from its IDE and CLI, so there is no CLI to install. **Install runtime** downloads Google's official archive from the [ACP registry entry](https://github.com/agentclientprotocol/registry/blob/main/antigravity-acp/agent.json) (only `dl.google.com` is accepted), unpacks it into Ramu's own provider directory, checks that it answers the ACP handshake, and only then makes it the active version. The previous version is kept for one update, and running chats are not interrupted. The same button updates it. A path you set under Advanced, or `RAMU_ANTIGRAVITY_BIN`, takes precedence and is yours to update; set the harness path there or `ANTIGRAVITY_HARNESS_PATH` if the helper is not beside it. Unpacking needs `unzip` on macOS and Linux.

Executable overrides are `RAMU_CLAUDE_BIN`, `RAMU_CODEX_BIN`, `RAMU_OPENCODE_BIN`, `RAMU_CURSOR_BIN`, and `RAMU_ANTIGRAVITY_BIN`. Saved paths take precedence. Paths must name executables, without shell arguments.

## Accounts and updates

Codex and OpenCode support separate credential profiles. **Default CLI account** uses the system profile. Saving another account applies to new chats; existing chats keep their account. Usage readings are account-specific. Authentication is handled by provider runtimes, not passwords stored in Ramu preferences.

Version checks run in the background service. CLI auto-update is opt-in and affects new processes; running chats stay connected. Custom Codex and Antigravity paths use their installation's own updater.

## Capabilities

All active providers use ACP. Claude and Codex retain native session, history, usage, and helper controls through Ramu's local hosts. OpenCode, Cursor, and Antigravity connect to native ACP executables.

Claude and Codex support steering and async Ramu questions. OpenCode, Cursor and Antigravity all connect over ACP, which works with OpenCode 1.x and 2.x alike.

- **Steering:** these runtimes cannot take input mid-turn, so **Steer** cancels the running turn and continues the same session with your message; the cancelled turn is not reported as finished. Only messages you send (including Send now, and stopping or messaging a helper) do this. Ramu's own messages, such as late advice, async answers and helper reports, are queued so they never discard the agent's work. **Queue** waits for the turn to end.
- **Resuming:** a chat continues its saved session with `session/resume` when the runtime offers it, otherwise `session/load`. If neither works, or the runtime no longer has the session, Ramu starts a new session and hands it the conversation transcript, the same as when switching providers. The transcript shows a settings row saying so.
- **Optional protocol features:** images are sent as image blocks only when the runtime advertises them; otherwise the saved file path goes in the text. Ramu's tools (questions, `ramu_agent`, advice) reach the runtime over HTTP MCP, and a runtime that lists its MCP support without HTTP gets a visible warning in the chat instead of silently losing them.
- **Plans and tool output:** Cursor's todo list (`cursor/update_todos`) shows as a plan. Antigravity's shell calls show their command and output, and inline image bytes are dropped from tool payloads so they don't fill the transcript.
- **Limits and fallback:** there is no usage API. A rejected request or a reply that is only a limit notice (quota exhausted, usage limit reached, rate limited, HTTP 429) triggers fallback and is recorded as a *limited* reading, so routing avoids that provider until the notice's stated wait passes, or for 15 minutes.
- **Reasoning effort:** offered when the runtime advertises a `thought_level` option (OpenCode). Cursor and Antigravity encode effort in their model names, so each level is a separate model.
- **Sub-agents:** native helpers from all three appear as task cards that can be stopped (stopping cancels the turn and continues without the helper). OpenCode also streams each helper's tool calls and replies into its card; Cursor and Antigravity report only start and finish. Native helpers cannot receive messages; helpers started through `ramu_agent` can.
- **Routing sub-agents through Ramu:** OpenCode's own sub-agent tool is switched off (its `task` permission is denied for that chat process) and Antigravity's `invoke_subagent` requests are refused, so helpers go through `ramu_agent`. Cursor cannot switch its tool off, so the chat guidance tells it not to use it. A routing change restarts an idle chat's runtime before the next message, resuming the same session.
- **Side questions:** run on a throwaway fork of the OpenCode session, with every tool refused. Cursor and Antigravity cannot fork, so they answer from the visible conversation.

Read-only analysis requires the provider's read-only mode or native sandbox policy. See [agents and routing](AGENTS.md) and [background workflows](AUTOMATION.md).

## Advisor

Enable **Settings → Advisor** to consult a second model. Each consultation sends the chat transcript and tool summaries to that model and uses its tokens. Main chats can use the advisor; helpers do not.

By default, agents can continue independent work while advice arrives. **Always wait for advice** pauses every consultation. Advice cards show the question, response, duration, and Stop control.

Ramu's advisor replaces Claude Code's configured advisor for chats it starts, without editing Claude's settings. Turning Ramu's advisor off restores normal Claude advisor behavior for new sessions. Settings apply when a chat process starts or restarts. Pending advice is lost on a service restart and must be requested again.

## Checks

Simulated fixtures check adapters and transcripts; they do not verify every live runtime. For advisor UI checks, build and run `node scripts/advisor-smoke.mjs`. Provider authentication and real model calls need separate validation.
