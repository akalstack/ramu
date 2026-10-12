# Agent providers

## Setup

| Provider | Integration | Setup |
| --- | --- | --- |
| Claude | Ramu ACP host over Claude Agent SDK | Install Claude Code and sign in |
| Codex | Ramu ACP host over Codex app-server | Install Codex and sign in |
| OpenCode | Native `opencode acp` | Install OpenCode and configure a connected model provider |
| Cursor | [Native ACP](https://cursor.com/docs/cli/acp) | Install Cursor CLI and run `agent login` |
| Antigravity | Official ACP runtime | Download Google's runtime from the [ACP registry](https://github.com/agentclientprotocol/registry/blob/main/antigravity-acp/agent.json), keep its matching `localharness_external` helper alongside it, and sign in through a supported ACP client |

Ramu discovers model IDs from the installed runtime. Cursor uses `agent acp`; Antigravity uses `agy_acp_server.par` on macOS/Linux (`--uid=` on Linux) or `agy_acp_server.exe` on Windows. The Antigravity ACP runtime is separate from its IDE and CLI. Set `ANTIGRAVITY_HARNESS_PATH` to the matching helper when required by that runtime.

Open **Settings → Providers** for **Login**, **Update CLI**, per-provider **Auto-update CLI**, and account selection where supported. Executable/helper paths are under **Advanced**. The install/setup command panels were removed. Login uses the selected CLI and opens its interactive authentication flow; Ramu does not store passwords or OAuth tokens in its preferences.

Codex and OpenCode support named, isolated credential profiles. Codex uses `CODEX_HOME`; OpenCode uses its XDG data/config/state directories. The original system profile remains **Default CLI account**. Save the chosen account to use it for new chats; existing chats persist their original account ID, including history reads and Codex Aside. Usage windows are kept separately per account. Claude and Cursor offer their supported CLI login without advertising unverified isolated account support; Antigravity retains its official runtime authentication path.

Version checks run in the detached service every six hours after startup, including while the app is closed. Notifications default on; CLI auto-update is opt-in per provider and continues even when notices are off. Claude/Cursor use their native update commands, OpenCode uses `upgrade`, and Codex updates into a Ramu-owned npm prefix rather than rewriting an unrelated global installation. Custom Codex paths and Antigravity require their installation's own update mechanism. Updates affect new provider processes; the updater does not restart active chats.

Executable paths can also be supplied through `RAMU_CLAUDE_BIN`, `RAMU_CODEX_BIN`, `RAMU_CURSOR_BIN`, `RAMU_ANTIGRAVITY_BIN`, and `RAMU_OPENCODE_BIN`. Saved settings take precedence over these variables. Each path names an executable, without shell arguments.

All active providers now cross an ACP boundary. OpenCode, Cursor, and Antigravity connect directly to their native ACP executables. Claude and Codex use Ramu-maintained local ACP hosts, with the official `@agentclientprotocol/sdk` pinned to `1.8.0` and real newline-JSON transport. The host retains Claude's owning SDK Query and Codex's owning app-server, preserving native policies, usage, async questions, patches/diffs, helper controls, hooks, and stable transcript IDs through scoped extensions. This is a hybrid migration; it does not install the stock Claude/Codex ACP adapters or remove every native implementation. Native history/usage/Aside support is retained deliberately.

OpenCode, Cursor and Antigravity queue follow-ups until the current turn completes. Claude and Codex keep their existing steering behavior. Background analysis requires an advertised read-only mode or the retained native tool/sandbox policy. Ramu's scoped MCP connection is injected into the host/native ACP session. Model discovery, history and account-usage reads may still use native control paths. The legacy OpenCode SDK driver is retained for compatibility tests, but is no longer the active OpenCode connection.

Claude and Codex sub-agents (including background agents that keep running after a turn) appear as cards in the chat, with their own transcript, Stop, and a message box. See [AGENTS-NEXT.md](AGENTS-NEXT.md) for how that works and which provider features are still open.

Claude and Codex also receive scoped Ramu question tools. By default an agent can ask and continue independent work, then wait when an answer is needed. Related questions send together; independent replies send separately. Codex native async questions are supported, while native blocking questions and permission approvals keep their blocking behavior. See [questions while work continues](AUTOMATION.md#questions-while-work-continues).

## Advisor

**Settings → Advisor** is off by default. When on, main chats (not sub-agents) get Ramu's `advisor` and `wait_for_advice` tools, and the agent is told to consult the advisor before it commits to an approach, when it is stuck, when it is about to change approach, and before it declares the task done. The advisor can be any installed provider, model and effort. For example, GPT can review a Claude chat, or the other way round. Each call sends the chat transcript (messages and tool summaries) through the same isolated analysis path that titles and recaps use, including usage-limit fallback. Code is in `src/main/advisor.ts` and `AgentService.consultAdvisor` / `waitForAdvice`.

- **Non-blocking by default.** Claude Code's own advisor pauses the agent until the advice arrives. Ramu's returns a request ID instead, and the agent may continue only with work the advice cannot change, such as reading code, running tests or gathering context. The advice arrives as a steering message, the same way late async question answers do. The agent calls `wait_for_advice` when its next step depends on the advice, and calls `advisor` with `wait=true` for the final check before declaring done. Advice the agent waited for is not delivered a second time. **Always wait for advice** makes every call block, like Claude Code's.
- **Claude Code's own advisor.** Claude's server-side advisor (`advisorModel` in `~/.claude/settings.json`, or `/advisor`) can only use Claude models. While Ramu's advisor is on, Ramu passes `settings: { advisorModel: '' }` as flag settings to every Claude session it starts, which turns Claude's advisor off without changing the user's files. Settings shows the detected Claude advisor model. While Ramu's advisor is off, Claude chats keep the user's own advisor. Background analysis (titles, commit drafts, recaps, the advisor itself) never uses Claude's advisor.
- **In the chat.** Each consultation is a card like a sub-agent card, with provider, model, Background when the agent did not wait, duration, and Stop. Clicking it opens the panel with the question, the advice, and any tool calls the advisor made. The raw `advisor` and `wait_for_advice` tool rows are hidden behind the card. Advice delivered later appears as a compact "Advice delivered to the agent" row that opens the same panel; the agent still receives the full text. Stopping a card cancels the analysis, and nothing is delivered.
- Instructions reach Claude through the appended system prompt and Codex through `developerInstructions`. ACP providers and OpenCode get the tool, whose description carries the same guidance.
- The setting applies when a chat's agent process starts. A running Claude chat keeps its tools, instructions and Claude-advisor override until it restarts, for example after a provider switch or a service restart.
- A pending async request lives in memory. If the background service restarts, the request is lost and `wait_for_advice` asks the agent to call `advisor` again.
- Checks: `test/advisor.test.ts`, and `pnpm build && node scripts/advisor-smoke.mjs` (Electron, fake agents, Codex advising Claude and Codex chats). Screenshots go to `output/playwright/advisor/`.

