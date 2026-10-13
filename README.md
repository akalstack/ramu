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

Ramu brings agent chats, an editor, terminals, and Git into one desktop workspace. Work across multiple repositories or start a standalone chat.

Inspired by **T3 Code**, **Codex**, and **VS Code**.

## Why Ramu

- **Cross-provider advisor:** let your working agent consult a second model, even from another provider, for guidance on its approach and a final review. The advisor reads the conversation and tool summaries; the agent can continue independent work while advice arrives.
- **Automatic provider fallback:** keep working when a provider reaches its usage limit. Configure an ordered list of providers and models, switch at the limit or an earlier usage threshold, and optionally return to the original model after its limit resets. Visible conversation context carries into the same chat.
- **Automatic goals:** agents can create a persistent goal when authorized work is likely to need multiple turns. Ramu starts follow-up turns toward that objective, keeps the goal across provider changes, and gives you pause, resume, and continuation limits. You can also start a goal explicitly with `/goal`.
- **Cross-provider helpers:** route delegated tasks to another provider or model, with rules by task type and separate fallback policies. Inspect helper progress and transcripts, or use isolated checkouts for their changes.
- **Shared memory across providers:** carry project knowledge and personal preferences between agents through shared notes. Browse and edit memories, restore earlier versions, and use model-assisted cleanup to merge duplicates and archive outdated notes.
- **Persistent background work:** chats and terminals keep running when you close the window. Resume unfinished chats after a service restart, schedule recurring tasks, and catch up through recaps linked to the original conversations.

## Features

- **Agents:** Claude Code, Codex, OpenCode, Cursor, and Antigravity, with model selection, file context, and follow-ups.
- **Workspace:** Monaco editor, split terminals, and Git branches, staging, stashes, and sync.
- **Reviews:** recorded diffs, file and line comments, and selective undo with conflict checks.
- **Background work:** persistent chats, goals, schedules, shared memory, helper agents, and provider fallback.
- **Appearance:** configurable fonts and colors, with English and Bahasa Indonesia.

Provider capabilities vary. Background work requires an awake computer.

## Get started

Download installers and SHA-256 checksums from [GitHub Releases](https://github.com/ahxar/ramu/releases).

Ramu is in alpha. Release targets are **macOS arm64/x64** and **Linux x64**; Linux packaged GUI validation is pending. Windows is experimental, with no release downloads. CI macOS builds are unsigned and not notarized. Install alpha updates manually; automatic installation requires a signed macOS app and excludes prereleases.

Install and sign in to an agent provider, select it in **Settings → Providers**, then add a repository or start a chat. See [provider setup](docs/PROVIDERS.md).

### Run from source

Requires Git, Node.js 24, and pnpm 11.21.0. Native dependencies may need Python 3 and a C/C++ toolchain (Xcode Command Line Tools on macOS; `build-essential` on Debian/Ubuntu).

```sh
git clone https://github.com/ahxar/ramu.git
cd ramu
npm install --global pnpm@11.21.0
pnpm install --frozen-lockfile
pnpm dev
```

## Development

Built with Electron, React, TypeScript, Monaco, and xterm.js. A local service manages agents, terminals, and schedules.

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start with hot reload |
| `pnpm check` | Type-check, test, and build |
| `pnpm test:e2e` | macOS Electron checks with simulated providers |
| `pnpm make` | Build installers for the current platform |

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and validation requirements. [Report bugs or request features](https://github.com/ahxar/ramu/issues/new/choose); report vulnerabilities through [SECURITY.md](SECURITY.md).

## Guides

[Providers](docs/PROVIDERS.md) · [Agents and routing](docs/AGENTS.md) · [Background work and reviews](docs/AUTOMATION.md) · [Goals](docs/GOALS.md) · [Shared memory](docs/MEMORY.md) · [Editor](docs/EDITOR.md)

## License

[MIT](LICENSE). Third-party assets and provider trademarks retain their respective licenses; see [provider assets](src/renderer/src/assets/providers/README.md) and [branding](assets/branding/README.md).
