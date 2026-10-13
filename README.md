<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo.svg" />
    <img src="assets/logo-light.svg" alt="Ramu" width="300" />
  </picture>
</p>

<p align="center">An open-source desktop workspace for coding with agents.</p>

<p align="center">
  <a href="https://github.com/ahxar/ramu/actions/workflows/ci.yml"><img src="https://github.com/ahxar/ramu/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-8b5cf6" alt="License: MIT" /></a>
  <a href="https://github.com/ahxar/ramu/releases">Downloads</a> ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

Ramu puts agent chats, an editor, terminals, and Git in one window. A project can contain several repositories; chats can also run without a project.

## Features

- **Agents:** Claude Code, Codex, OpenCode, Cursor, and Antigravity through installed runtimes. Select models, send file context, and steer or queue follow-ups.
- **Review:** recorded diffs, file and line comments, and file restoration with conflict checks.
- **Workspace:** Monaco editor, repository linters, split terminals, branches, staging, stashes, and commit/push/sync actions.
- **Background work:** persistent chats, goals, schedules, and daily recaps through a local service.
- **Routing:** helper agents, usage-limit fallback, shared memory, and optional advice from a second model.
- **Appearance:** configurable fonts and colors; English and Bahasa Indonesia.

Provider capabilities vary. Background work requires an awake computer.

## Installation

Ramu is a desktop alpha. Download available installers and SHA-256 checksums from [GitHub Releases](https://github.com/ahxar/ramu/releases).

| Platform | Status |
| --- | --- |
| macOS arm64 / x64 | Primary desktop platform; DMG and ZIP release targets |
| Linux x64 | DEB and ZIP release targets; packaged GUI validation pending |
| Windows | Experimental; no release downloads |

CI macOS builds are unsigned and not notarized. Automatic installation requires a signed macOS app. Update checks exclude prereleases; install alpha updates manually.

### Run from source

Requires Git, Node.js 24, and pnpm 11.21.0. Native dependencies may need Python 3 and a C/C++ toolchain: Xcode Command Line Tools on macOS or `build-essential` on Debian/Ubuntu.

```sh
git clone https://github.com/ahxar/ramu.git
cd ramu
npm install --global pnpm@11.21.0
pnpm install --frozen-lockfile
pnpm dev
```

Install and sign in to an agent provider, then select it under **Settings → Providers**. Add a repository or start a chat without a project. See [provider setup](docs/PROVIDERS.md) for runtime requirements.

## Development

Built with Electron, React, TypeScript, Monaco, and xterm.js. The desktop app connects to a local service that owns agents, terminals, and schedules.

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start with hot reload |
| `pnpm check` | Type-check, test, and build |
| `pnpm test:e2e` | macOS Electron checks with simulated providers |
| `pnpm package` | Package the desktop app |
| `pnpm make` | Build installers for the current platform |

See [CONTRIBUTING.md](CONTRIBUTING.md) for development and validation requirements.

## Documentation

- [Providers and advisor](docs/PROVIDERS.md)
- [Agents, helpers, and fallback](docs/AGENTS.md)
- [Background work, schedules, reviews, and undo](docs/AUTOMATION.md)
- [Goals](docs/GOALS.md)
- [Shared memory](docs/MEMORY.md)
- [Editor](docs/EDITOR.md)
- [UI development](docs/UI.md)
- [Localization](docs/LOCALIZATION.md)
- [ACP integration](docs/ACP-CHAT-UI.md)
- [Releases](docs/RELEASING.md)
- [Mobile and remote access proposal](docs/MOBILE-AND-REMOTE.md)

Report bugs and request features through [GitHub Issues](https://github.com/ahxar/ramu/issues/new/choose). Report vulnerabilities using [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE). Provider trademarks and third-party assets retain their respective licenses; see the [provider asset notes](src/renderer/src/assets/providers/README.md) and [branding notes](assets/branding/README.md).
