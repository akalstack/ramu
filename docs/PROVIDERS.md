# Agent providers

## Setup

| Provider | Integration | Setup |
| --- | --- | --- |
| Claude | Claude Agent SDK | Install Claude Code and sign in |
| Codex | Local Codex app-server | Install Codex and sign in |
| OpenCode | [OpenCode SDK](https://opencode.ai/docs/sdk/) | Install OpenCode and configure a connected model provider |
| Cursor | [Native ACP](https://cursor.com/docs/cli/acp) | Install Cursor CLI and run `agent login` |
| Antigravity | Official ACP runtime | Download Google's runtime from the [ACP registry](https://github.com/agentclientprotocol/registry/blob/main/antigravity-acp/agent.json), keep its matching `localharness_external` helper alongside it, and sign in through a supported ACP client |

Ramu discovers model IDs from the installed runtime. Cursor uses `agent acp`; Antigravity uses `agy_acp_server.par` on macOS/Linux (`--uid=` on Linux) or `agy_acp_server.exe` on Windows. The Antigravity ACP runtime is separate from its IDE and CLI. Set `ANTIGRAVITY_HARNESS_PATH` to the matching helper when required by that runtime.

Open **Settings → Providers** to choose executable paths, browse for the Antigravity helper, detect installed versions, and run installation and sign-in commands in the integrated terminal, copy commands, or open official setup/download guides. Empty paths use automatic detection of user-installed CLI binaries, including Claude. Saved paths apply to new sessions and model discovery; existing sessions continue running.

Provider update notifications are enabled by default. Ramu checks official release sources daily for installed providers and shows dismissible notices with a link to Providers settings. Turn off **Provider update notifications** to stop automatic checks and notices; **Check latest versions** remains available manually. OpenCode checks stay on the installed v1 or v2 release line. Checks never install or update software automatically.

Executable paths can also be supplied through `RAMU_CLAUDE_BIN`, `RAMU_CODEX_BIN`, `RAMU_CURSOR_BIN`, `RAMU_ANTIGRAVITY_BIN`, and `RAMU_OPENCODE_BIN`. Saved settings take precedence over these variables. Each path names an executable, without shell arguments.

OpenCode supports both the original and native v2 SDK APIs. Its local server binds to loopback on an available port with a per-process password. Cursor, Antigravity and OpenCode queue follow-ups until the current turn completes. Claude and Codex default to Steer: follow-ups stay in the same message queue UI until all active tools finish, then use native steering without interrupting tools. Queue remains available to wait for the entire turn. Background analysis requires a read-only provider mode; unsupported modes fail explicitly. Ramu's scoped MCP connection is injected into ACP and the original OpenCode API; OpenCode v2 currently uses the tools configured in OpenCode itself.


