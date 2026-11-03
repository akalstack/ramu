# Providers

Ramu runs the agent tools you already use, with your own accounts.

## Setup

| Provider    | Install                                                                                        |
| ----------- | ---------------------------------------------------------------------------------------------- |
| Claude Code | Install Claude Code and sign in                                                                |
| Codex       | Install Codex and sign in                                                                      |
| OpenCode    | Install OpenCode and configure a model provider                                                |
| Cursor      | **Login** in Settings (Cursor's browser sign-in), or set `CURSOR_API_KEY`                      |
| Antigravity | **Settings → Providers → Antigravity → Install runtime**, then **Login** with Google           |

A new profile opens a short setup that finds installed tools and offers their sign-ins. **Settings → Providers** handles sign-in, accounts, updates and executable paths (`RAMU_CLAUDE_BIN`, `RAMU_CODEX_BIN`, `RAMU_OPENCODE_BIN`, `RAMU_CURSOR_BIN`, `RAMU_ANTIGRAVITY_BIN`). Ramu stores no provider passwords.

Each provider card shows whether its installed version is **Supported**, **Limited**, **Incompatible** or **Unverified**, with **Update** when a tested release exists.

## Accounts

Codex and OpenCode can hold several accounts; a saved account applies to new threads. When a thread hits a limit, every enabled account is tried before another model. A provider or account turned off in **Settings → Providers** starts nothing: new threads, threads continuing after a stop or restart, and fallback switches all refuse it and say why.

## Environment variables

**Settings → Environment variables** adds variables to every provider process on the host, for all providers or one. Paste `.env` text to fill several rows. Values stay in the host's OS credential store and paired devices see only names. `RAMU_*` names are reserved.

## Access modes

- **Allow edits:** the agent edits files in the project and asks before other actions, where the provider supports asking.
- **Auto:** Ramu's own tools run without asking; everything else follows the provider's automatic review, so risky commands still ask.
- **Full access:** nothing asks. Use it only for work you trust.

Approvals default to **Allow once**. For a command you can save a prefix rule (such as `git diff *`) for the project or for every project. **Settings → Permissions → Saved approvals** lists and removes them.

## Plan usage

The sidebar footer shows each provider's remaining allowance. Claude and Codex report their own; for Cursor and Antigravity Ramu reads the same services their apps use. With several hosts connected, the popover also lists other hosts' logins once each, and a **This week** line adds finished turns, reported cost and tokens across hosts. Claude and Codex report tokens for each turn; hosts with turns from other providers are named under the total rather than counted as zero.

## Advisor

**Settings → Goals & delegation → Advisor** lets the agent ask a second model for an opinion. Each consultation sends the thread to that model and uses its tokens. Turn on **Always wait for advice** to pause while it answers.

## Provider notes

- OpenCode 2 runs one `opencode serve` per thread; OpenCode 1.x and Antigravity use ACP.
- ACP runtimes cannot take input mid-turn, so **Steer** cancels the turn and continues with your message.
- Cursor steers within the turn.
