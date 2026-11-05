<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo.svg" />
    <img src="assets/logo-light.svg" alt="Ramu" width="300" />
  </picture>
</p>

<p align="center">A free, open-source workspace for coding with agents, on desktop and mobile.</p>

<p align="center">
  <a href="https://github.com/akalstack/ramu/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-8b5cf6" alt="License: MIT" /></a>
  <a href="https://github.com/sponsors/akalstack"><img src="https://img.shields.io/badge/sponsor-GitHub-ea4aaa?logo=githubsponsors&logoColor=white" alt="Sponsor on GitHub" /></a>
  <a href="https://trakteer.id/akalstack"><img src="https://img.shields.io/badge/traktir-Trakteer-be1e2d" alt="Traktir di Trakteer" /></a>
</p>

<p align="center">
  <a href="https://github.com/akalstack/ramu/releases"><b>Download</b></a> ·
  <a href="https://github.com/akalstack/ramu/blob/main/docs/README.md#guide"><b>Guide</b></a> ·
  <a href="https://github.com/akalstack/ramu/blob/main/CONTRIBUTING.md"><b>Contributing</b></a>
</p>

Ramu is an **Agent Development Environment**: your coding agents, editor, terminals, Git and review in one window. Use Claude Code, Codex, OpenCode, Cursor or Antigravity with the accounts you already have. No Ramu account, no subscription, nothing to host: agents run on your own computer.

Open a project, say what you want, and review the result. The defaults work out of the box; **Settings** holds the rest.

## What it does

**Agents that keep going**

- **Usage limits handled.** Rank providers and models; when one runs out, the thread moves to the next with its context. When all are limited, Ramu waits and resumes, even after a restart.
- **Goals.** An agent works toward an objective across turns, with an optional verification command that decides when it is done.
- **Background work.** Schedules, webhook triggers, queued messages and long-running commands keep going after you close the window. Recaps say what happened.

**Models working together**

- **Teammates and helpers.** `@`-mention another model into a thread, delegate tasks to helpers on any provider (optionally in their own checkout), or save custom agents for recurring jobs.
- **Advice and asides.** Ask a second model for a review or an opinion; select text to quote it or ask a quick read-only question.
- **Memory that carries over.** Project memory, preferences, skills and lessons are shared across providers, and agents can search earlier threads for past decisions and fixes.

**A full workspace**

- Monaco editor, split terminals, recorded diffs, inline review comments and selective undo.
- Git branches, staging, stashes, sync and worktrees, across several repositories in one folder.
- GitHub, GitLab, Bitbucket and Azure DevOps: start from an issue, open a pull request, and hand failing checks or review comments back to an agent.
- An integrated browser, computer use for a chosen app or screen, and iOS Simulator and Android emulator testing, all watchable and stoppable.
- Interactive documents agents publish in a thread: diagrams, calculators, prototypes.
- Shared MCP tools with per-thread approval, Inbox for what needs you, themes, and English or Bahasa Indonesia.

**Anywhere**

- **Phone app** (iOS and Android): chat, review, Git, terminals and approvals, with push notifications.
- **Several hosts** from one desktop: continue a thread on another machine, or let agents start work there.
- **Your network, your way**: LAN, a private network such as Tailscale or NetBird, SSH, or your own tunnel ([remote hosts](docs/guide/remote-hosts.md)).
- **Headless server** and a `ramu` CLI for servers and terminals.

Provider features vary. Agents run on your host, so it must stay awake while they work.

## Get started

Download the installer from [GitHub Releases](https://github.com/akalstack/ramu/releases), install and sign in to a provider ([setup](docs/guide/providers.md)), then open a folder or start a thread. For the phone, see the [mobile guide](apps/mobile/README.md).

Ramu is in alpha: builds are for **macOS** (arm64, x64) and **Linux** (x64), unsigned for now, so updates are installed by hand. Windows is in progress.

### Run from source

Requires Git, Node.js 24 and pnpm 11.21.0. Native modules may need Python 3 and a C/C++ toolchain (Xcode Command Line Tools on macOS, `build-essential` on Debian/Ubuntu).

```sh
git clone https://github.com/akalstack/ramu.git
cd ramu
npm install --global pnpm@11.21.0
pnpm install --frozen-lockfile
pnpm dev
```

## Development

Electron, React, React Native and TypeScript; see the [architecture](docs/contributing/architecture.md).

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start with hot reload |
| `pnpm check` | Format, lint, type-check, test and build |
| `pnpm test:desktop-smoke` | Desktop startup check with simulated providers |
| `pnpm make` | Build installers for this platform |
| `pnpm server serve` | Run the workspace server without the desktop app (after `pnpm build`) |

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. [Report a bug or request a feature](https://github.com/akalstack/ramu/issues/new/choose); report vulnerabilities through [SECURITY.md](SECURITY.md). Unfinished work is in [the roadmap](docs/roadmap.md).

## Support Ramu

Ramu is free and stays free. If it saves you time, you can help keep it going through [GitHub Sponsors](https://github.com/sponsors/akalstack) or [Trakteer](https://trakteer.id/akalstack).

## Acknowledgments

- [T3 Code](https://github.com/pingdotgg/t3code) by Ping Labs and Theo, for client-host agent UX, the companion socket transport and workflow shortcuts.
- [VS Code](https://github.com/microsoft/vscode), for UI patterns and editor architecture.
- [Codex](https://github.com/openai/codex), for agent session and provider interaction patterns.

## License

[MIT](LICENSE). The license doesn't cover the Ramu name and logo; see [trademarks](TRADEMARKS.md). Third-party assets and provider trademarks keep their own licenses; see [provider assets](apps/web/src/assets/providers/README.md) and [branding](assets/branding/README.md).
