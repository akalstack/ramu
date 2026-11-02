<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo.svg" />
    <img src="assets/logo-light.svg" alt="Ramu" width="300" />
  </picture>
</p>

<p align="center">An open-source workspace for coding with agents, on desktop and mobile.</p>

<p align="center">
  <a href="https://github.com/ahxar/ramu/actions/workflows/ci.yml"><img src="https://github.com/ahxar/ramu/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-8b5cf6" alt="License: MIT" /></a>
  <a href="https://github.com/ahxar/ramu/releases">Downloads</a> ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

Ramu is an **Agent Development Environment (ADE)**: work with a coding agent next to your editor, terminals, Git, and code review, all in one window. Use Claude Code, Codex, OpenCode, Cursor, or Antigravity with your existing provider accounts.

Open a project, describe what you want, and review the result. Everything else is optional: the defaults work out of the box, and **Settings** has the controls for power users.

Inspired by [T3 Code](https://github.com/pingdotgg/t3code), [Codex](https://github.com/openai/codex), and [VS Code](https://github.com/microsoft/vscode).

## Why Ramu

On top of the workspace, Ramu adds orchestration that works without setup:

- **Keep working through usage limits.** Rank providers and models for automatic fallback, carrying visible conversation context into the same thread. When all are limited, Ramu waits and resumes when capacity returns, even after a restart.
- **Follow goals across turns.** Persistent goals keep agents working toward an objective across provider changes, with pause, resume, and continuation limits. Schedule recurring work and leave threads and terminals running after closing the window.
- **Bring models together.** Ask a second model for advice or review, and delegate tasks to helpers across providers, with optional isolated checkouts.
- **Carry knowledge forward.** Share project memory and preferences across providers. Turn completed work into reusable skills and lessons, with editable notes and revision history. A periodic "What Ramu learned" summary says what was saved, merged or archived, and a review thread can fix it.
- **Recall past work.** Ask agents to find decisions and fixes in earlier threads across providers, with links to the original messages. Skills can declare required tools and fallback procedures so agents can select instructions that fit their current tools.
- **Work across repositories.** Add a parent folder and Ramu detects the child Git repositories and groups them into one workspace, with no multi-root file to write. Each repository gets its own branches, staging, stashes, sync, and diffs, and agents see the whole workspace.
- **Give agents useful tools.** Use the integrated browser, grant an agent access to a specific app or screen, and connect external MCP tools with per-thread approvals and host-managed credentials. See [browser](docs/guide/browser-and-computer.md#browser), [computer use](docs/guide/browser-and-computer.md#computer-use), and [MCP security and setup](docs/contributing/architecture.md#shared-mcp).
- **Continue from your phone.** Pair the iOS or Android app with your host to chat, review changes, manage Git, use terminals, and respond to agent requests.

## Features

- Monaco editor, split terminals, and Git branches, staging, stashes, and sync.
- Recorded diffs, inline review comments, and selective undo with conflict checks.
- GitHub pull requests and issues: start a thread from an issue, open a pull request that closes it, and hand failing checks or review comments back to an agent.
- File attachments, saved drafts, configurable fonts and colors, and English/Bahasa Indonesia.
- A standalone workspace server for [headless use](docs/guide/remote-hosts.md) and mobile access.

Provider capabilities vary. Agents run on your host, which must stay awake; mobile access also requires a reachable connection.

## Get started

Download installers and SHA-256 checksums from [GitHub Releases](https://github.com/ahxar/ramu/releases).

Ramu is in alpha. Release targets are **macOS arm64/x64** and **Linux x64**; Linux packaged GUI validation is pending. Windows is not supported yet. CI macOS builds are unsigned and not notarized. Install alpha updates manually; automatic installation requires a signed macOS app and excludes prereleases.

Install and sign in to an agent provider, select it in **Settings → Providers**, then add a repository or start a thread. See [provider setup](docs/guide/providers.md). For iOS and Android setup and pairing, see the [mobile guide](apps/mobile/README.md).

### Run from source

Requires Git, Node.js 24, pnpm 11.21.0, and [ripgrep](https://github.com/BurntSushi/ripgrep) (`rg`, used for project search and replace; also required by installed builds). Native dependencies may need Python 3 and a C/C++ toolchain (Xcode Command Line Tools on macOS; `build-essential` on Debian/Ubuntu).

```sh
git clone https://github.com/ahxar/ramu.git
cd ramu
npm install --global pnpm@11.21.0
pnpm install --frozen-lockfile
pnpm dev
```

## Development

Built with Electron, React, React Native, and TypeScript. See the [architecture](docs/contributing/architecture.md) for the desktop, mobile, and server layout.

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start with hot reload |
| `pnpm check` | Format, lint, type-check, test, and build |
| `pnpm test:desktop-smoke` | One macOS desktop startup check with simulated providers |
| `pnpm make` | Build installers for the current platform |
| `pnpm server serve` | Run the workspace server without the desktop app (after `pnpm build`) |

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and validation requirements. [Report bugs or request features](https://github.com/ahxar/ramu/issues/new/choose); report vulnerabilities through [SECURITY.md](SECURITY.md).

## Docs

The [guide](docs/README.md#guide) covers using Ramu, and [contributing](docs/README.md#contributing) covers working on it. Unfinished work is in [the roadmap](docs/roadmap.md).

## Acknowledgments

- [T3 Code](https://github.com/pingdotgg/t3code) by Ping Labs and Theo for client-host agent UX patterns, companion socket transport, and workflow shortcuts that inspired parts of Ramu.
- [VS Code](https://github.com/microsoft/vscode) for foundational UI patterns and editor architecture.
- [Codex](https://github.com/openai/codex) for agent session and provider interaction patterns.

## License

[MIT](LICENSE). Third-party assets and provider trademarks retain their respective licenses; see [provider assets](apps/web/src/assets/providers/README.md) and [branding](assets/branding/README.md).
