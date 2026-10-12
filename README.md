<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo.svg" />
    <img src="assets/logo-light.svg" alt="Ramu" width="300" />
  </picture>
</p>

<p align="center">
  <strong>Your project. Every repo. One workspace.</strong><br />
  An open-source desktop workspace for coding alongside agents.<br />
  Chat, edit, review, and ship from the same window.
</p>

<p align="center">
  <a href="https://github.com/ahxar/ramu/actions/workflows/ci.yml"><img src="https://github.com/ahxar/ramu/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-8b5cf6" alt="License: MIT" /></a>
  <a href="#installation"><img src="https://img.shields.io/badge/status-desktop_alpha-f59e0b" alt="Status: desktop alpha" /></a>
  <a href="package.json"><img src="https://img.shields.io/badge/Node.js-24-339933?logo=nodedotjs&logoColor=white" alt="Node.js 24" /></a>
  <a href="package.json"><img src="https://img.shields.io/badge/pnpm-11.21.0-F69220?logo=pnpm&logoColor=white" alt="pnpm 11.21.0" /></a>
</p>

<p align="center">
  <a href="#features">Features</a> ·
  <a href="#getting-started">Getting started</a> ·
  <a href="https://github.com/ahxar/ramu/releases">Downloads</a> ·
  <a href="#documentation">Documentation</a> ·
  <a href="CONTRIBUTING.md">Contribute</a>
</p>

---

**Ramu** (RAH-moo) is Indonesian for blending ingredients into one mixture. Here, those ingredients are your editor, coding agents, terminals, and Git. Group one or more independent repositories into a project, or start a chat without one. Keep the code and the conversation together as you work.

## Features

### Work alongside your agents

- **Choose your provider.** Use Claude Code, Codex, OpenCode, Cursor, or Antigravity through their local runtimes. Pick models and reasoning effort, save favorites, and run several chats at once.
- **Give context from your workspace.** Mention files with `@`, discover commands and skills with `/`, and include editor selections and unsaved buffers in your message.
- **Keep the conversation moving.** Steer or queue follow-ups while work runs. Supported agents can ask questions while continuing independent work; answers return to the same conversation.
- **Get a second perspective.** Ask a read-only aside about the conversation, or enable an advisor on another provider or model to consult during the task.
- **Work with helpers.** Follow sub-agent progress and transcripts in chat. Configure cross-provider helper routing and optional worktree isolation.
- **Handle usage limits.** See Claude and Codex usage windows and configure model/provider fallback chains, including a return to the original provider after reset.

### Edit, review, and ship

- **An editor beside the chat.** Monaco, project-aware TypeScript/JavaScript language support, and formatting and linting with your repository's own tools.
- **Review each run.** Browse recorded revisions, compare them with current files, and comment on a file or line. Comments stay local until you send them back to the agent.
- **Preview file restoration.** Undo from a sent message with a proposed diff and conflict checks that preserve nonoverlapping later edits.
- **Git in the workspace.** Stage changes, inspect diffs and history, manage branches, stashes, and rebases, and choose a branch when committing and pushing.
- **Terminals that stay with you.** Run shells in tabs and split panes alongside your code.
- **Optional AI suggestions.** Enable inline completion with local Ollama or cloud Codestral, and next-edit predictions with Codestral. Both features are off by default.

### Pick up where you left off

- **Background work.** Chats, terminals, and schedules keep running when the window closes. Reopen Ramu to reconnect; unfinished chats can continue after a service restart.
- **Goals.** Keep a chat working toward an objective across turns, with configurable continuation limits and pause/resume controls.
- **Schedules.** Run prompts once or on a recurring schedule, with execution history and missed-run handling.
- **Daily recap.** Home brings together outstanding questions, blockers, recent outcomes, and upcoming schedules, with links back to their conversations.
- **Make it yours.** Choose accent colors, fonts, and editor settings. Use English or Bahasa Indonesia, with a Follow system language option.

Background work requires an awake computer. Provider capabilities vary; see [provider setup](docs/PROVIDERS.md) and [background workflows](docs/AUTOMATION.md) for details.

## Getting started

### Installation

Ramu is in **desktop alpha**. Check [GitHub Releases](https://github.com/ahxar/ramu/releases) for available downloads and their SHA-256 checksums, or run from source below.

| Platform | Current support |
| --- | --- |
| macOS · Apple Silicon / Intel | Primary validated desktop platform; release workflow builds DMG and ZIP assets |
| Linux · x64 | CI checks and DEB/ZIP release builds; packaged GUI validation is still pending |
| Windows | Experimental; no Windows downloads in the release workflow |

The checked-in release workflow produces unsigned, unnotarized macOS builds. In-app update checks use GitHub Releases; restart-to-install requires a signed macOS app. Other builds use manual installation.

### Run from source

Requires **Git**, **Node.js 24**, and **pnpm 11.21.0**. Native dependencies may also need Python 3 and a C/C++ toolchain: Xcode Command Line Tools on macOS or `build-essential` on Debian/Ubuntu.

```sh
git clone https://github.com/ahxar/ramu.git
cd ramu
npm install --global pnpm@11.21.0
pnpm install --frozen-lockfile
pnpm dev
```

### Start your first chat

1. Open **Settings → Providers** to detect installed runtimes, choose executable paths, and find installation and sign-in commands. Each provider needs its own installation and account or model configuration.
2. Add a repository or a folder containing multiple repositories as a project, or start without a project.
3. Choose a model, describe the task, and open files beside the chat. Review the recorded changes and send comments when you want a follow-up.

See [provider setup and compatibility](docs/PROVIDERS.md) for provider-specific requirements, including the separate Antigravity ACP runtime.

## Development

Built with **Electron, React, TypeScript, Monaco, and xterm.js**. The desktop UI connects to a separate local background service that owns agent sessions and scheduled work.

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start the desktop app with hot reload |
| `pnpm check` | Type-check, run unit and release-script tests, and build |
| `pnpm test` | Run unit tests |
| `pnpm build` | Build the desktop app and background service |
| `pnpm test:e2e` | Run the macOS Electron integration journey with simulated providers |
| `pnpm package` | Package the app with Electron Forge |
| `pnpm make` | Create installers for the build machine's platform |

For project layout, development conventions, and validation requirements, read [CONTRIBUTING.md](CONTRIBUTING.md). Release commands and signing instructions live in the [release guide](docs/RELEASING.md).

## Documentation

| Guide | What's inside |
| --- | --- |
| [Providers and advisor](docs/PROVIDERS.md) | Runtime setup, authentication, compatibility, and advisor behavior |
| [Background workflows](docs/AUTOMATION.md) | Schedules, recaps, questions, reviews, undo, and restart recovery |
| [Goals](docs/GOALS.md) | Automatic continuation, limits, quota waiting, and chat controls |
| [Agents and routing](docs/AGENTS-NEXT.md) | Helpers, asides, usage limits, fallback, and remaining work |
| [Editor tooling](docs/EDITOR-TOOLING.md) | Project formatters, linters, language servers, and AI completion |
| [Languages](docs/LOCALIZATION.md) | English, Bahasa Indonesia, and translation conventions |
| [UI and packaging](docs/UI-AND-RELEASES.md) | Components, branding, terminals, and desktop packaging |
| [Releasing](docs/RELEASING.md) | Release preparation, CI targets, checksums, and signing |

## Contributing

Bug reports, documentation, tests, and focused improvements are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) to get started, then use the [bug report or feature request templates](https://github.com/ahxar/ramu/issues/new/choose). Open an issue before a substantial feature or architecture change so we can agree on scope.

For vulnerability reports, follow [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © 2026 Ramu contributors. Agent providers and bundled dependencies retain their own licenses and terms.
