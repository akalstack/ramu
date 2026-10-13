# Providers

## Setup

| Provider | Runtime | Setup |
| --- | --- | --- |
| Claude Code | Ramu ACP host over Claude Agent SDK | Install Claude Code and sign in |
| Codex | Ramu ACP host over Codex app-server | Install Codex and sign in |
| OpenCode | `opencode acp` | Install OpenCode and configure a model provider |
| Cursor | `agent acp` | Install Cursor CLI and run `agent login` |
| Antigravity | Official ACP runtime | Install the runtime and its matching `localharness_external` helper; sign in through a supported ACP client |

Use **Settings → Providers** to log in, select accounts, update CLIs, and set executable paths under Advanced. Ramu reads model IDs from the installed runtime.

Antigravity's ACP runtime is separate from its IDE and CLI. See the [ACP registry entry](https://github.com/agentclientprotocol/registry/blob/main/antigravity-acp/agent.json). Set the harness path in Advanced or `ANTIGRAVITY_HARNESS_PATH` if the helper is not beside the runtime.

Executable overrides are `RAMU_CLAUDE_BIN`, `RAMU_CODEX_BIN`, `RAMU_OPENCODE_BIN`, `RAMU_CURSOR_BIN`, and `RAMU_ANTIGRAVITY_BIN`. Saved paths take precedence. Paths must name executables, without shell arguments.

## Accounts and updates

Codex and OpenCode support separate credential profiles. **Default CLI account** uses the system profile. Saving another account applies to new chats; existing chats keep their account. Usage readings are account-specific. Authentication is handled by provider runtimes, not passwords stored in Ramu preferences.

Version checks run in the background service. CLI auto-update is opt-in and affects new processes; running chats stay connected. Custom Codex paths and Antigravity use their installation's own updater.

## Capabilities

All active providers use ACP. Claude and Codex retain native session, history, usage, and helper controls through Ramu's local hosts. OpenCode, Cursor, and Antigravity connect to native ACP executables.

Claude and Codex support steering and async Ramu questions. Other providers queue follow-ups until the turn finishes. Read-only analysis requires the provider's read-only mode or native sandbox policy. See [agents and routing](AGENTS.md), [background workflows](AUTOMATION.md), and [ACP integration](ACP-CHAT-UI.md).

## Advisor

Enable **Settings → Advisor** to consult a second model. Each consultation sends the chat transcript and tool summaries to that model and uses its tokens. Main chats can use the advisor; helpers do not.

By default, agents can continue independent work while advice arrives. **Always wait for advice** pauses every consultation. Advice cards show the question, response, duration, and Stop control.

Ramu's advisor replaces Claude Code's configured advisor for chats it starts, without editing Claude's settings. Turning Ramu's advisor off restores normal Claude advisor behavior for new sessions. Settings apply when a chat process starts or restarts. Pending advice is lost on a service restart and must be requested again.

## Checks

Simulated fixtures check adapters and transcripts; they do not verify every live runtime. For advisor UI checks, build and run `node scripts/advisor-smoke.mjs`. Provider authentication and real model calls need separate validation.
