<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo.svg" />
    <img src="assets/logo-light.svg" alt="Ramu" width="300" />
  </picture>
</p>

<h3 align="center">Describe it. Ramu ships it.</h3>

<p align="center">The free, open-source workspace where your coding agents build the app, put it online and keep it running.<br />On desktop and phone, with accounts you own.</p>

<p align="center">
  <a href="https://github.com/akalstack/ramu/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-8b5cf6" alt="License: MIT" /></a>
  <img src="https://img.shields.io/badge/status-alpha-b7a6f3" alt="Status: alpha" />
  <a href="https://github.com/sponsors/akalstack"><img src="https://img.shields.io/badge/sponsor-GitHub-ea4aaa?logo=githubsponsors&logoColor=white" alt="Sponsor on GitHub" /></a>
  <a href="https://trakteer.id/akalstack"><img src="https://img.shields.io/badge/traktir-Trakteer-be1e2d" alt="Traktir di Trakteer" /></a>
</p>

<p align="center">
  <a href="https://github.com/akalstack/ramu/releases"><b>Download</b></a> ·
  <a href="https://getramu.dev"><b>Website</b></a> ·
  <a href="docs/README.md#guide"><b>Guide</b></a> ·
  <a href="CONTRIBUTING.md"><b>Contributing</b></a>
</p>

---

Ramu puts your coding agents, editor, terminals, Git and review in one window. Bring **Claude Code, Codex, OpenCode, Cursor or Antigravity** with the plans you already pay for.

- **No Ramu account.** Signing in is optional: it adds encrypted settings backups and lets your devices find your hosts.
- **No subscription.** Ramu is free and resells nothing.
- **Nothing to host.** Agents run on your own computer.

Open a project, say what you want, review the result. The defaults work as they are, and **Settings** has the rest.

## Why Ramu

|                                    |                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🚀 **One sentence to a live app**  | Ramu asks a few questions, picks a stack and builds until the build and tests pass. Then it deploys to _your_ Vercel, Netlify, Railway, Cloudflare or Fly.io account through that platform's own plugin, and every later change comes as a pull request with CI. [Shipping →](docs/guide/shipping.md) |
| 🎯 **Work that finishes itself**   | For longer tasks the agent sets a goal and keeps going across turns and providers. Ramu calls it done only when the checks pass and the changes are really in the repo. Add your own check, like your test suite. [Goals →](docs/guide/goals.md)                                                                          |
| 🔁 **Usage limits don't stop you** | Rank your providers. When one runs out, the thread moves to the next with its context, and comes back when your first choice has room. If all are limited, Ramu waits and resumes, even after a restart.                                                                                                                  |

## What's inside

**🤖 Agents that keep going**

- Schedules, webhooks, queued messages and long commands keep running after you close the window. Recaps tell you what happened.
- `@`-mention another model into a thread, delegate to helpers on any provider, or save custom agents for repeat jobs.
- Ask a second model for advice or a review. Select text to quote it or ask a quick question.
- Borrow abilities across providers, such as Codex's image generation in a Claude thread.
- Memory, preferences, skills and lessons are shared across providers. Agents can search old threads for past fixes.

**📄 Artifacts you keep**

- Agents make apps, docs, diagrams, slide decks, dashboards, designs and short motion videos, right in the thread.
- Keep them under **Artifacts**, edit them in place, open them on your phone, and export to Word, PowerPoint, PDF or video. [Artifacts →](docs/guide/artifacts.md)

**🛠️ A full workspace**

- Monaco editor, split terminals, recorded diffs, inline review comments and selective undo.
- Git branches, staging, stashes, sync and worktrees, across several repos in one folder.
- GitHub, GitLab, Bitbucket and Azure DevOps: start from an issue, open a pull request, hand failing checks back to an agent.
- Built-in browser, computer use, and iOS Simulator and Android emulator testing, all watchable and stoppable.
- **Home** to start work and an **Inbox** for what needs you, what's running and what finished.
- **Identities:** work and personal accounts (Git author, provider logins) picked per project, so nothing is switched by hand. [Identities →](docs/guide/identities.md)
- Shared MCP tools with per-thread approval, themes, English and Bahasa Indonesia.

**🌐 Shipping and running**

- Deploy with each platform's own plugin: Vercel, Netlify, Railway, Cloudflare or Fly.io. Ramu keeps the part an agent shouldn't decide alone: production always waits for your OK, and migrations run first. [Deploying →](docs/guide/deploy.md)
- **Run on this computer** for demos and home use: no hosting account, just a public address through a tunnel.
- [Plugins](docs/guide/plugins.md) add a service in one install: its skills, MCP servers, CLI and credential, for every provider. Browse them at [getramu.dev/plugins](https://getramu.dev/plugins).
- **Set up CI** in one pull request. After a push, the thread hears how its checks went (GitHub and GitLab). When the live site stops answering, an incident thread opens and your phone is told.

**📱 Anywhere**

- **Phone app** for iOS and Android: chat, review, Git, terminals, artifacts and approvals, with push notifications. On [Google Play](https://play.google.com/store/apps/details?id=com.akalstack.ramu) and the App Store, or [build it from source](apps/mobile/README.md).
- **Several hosts** from one desktop: continue a thread on another machine.
- **Your network:** LAN, Tailscale, NetBird, SSH or your own tunnel. [Remote hosts →](docs/guide/remote-hosts.md)
- **Headless server** and a `ramu` CLI for servers and terminals.

> Some features depend on the provider. Agents run on your computer, and on a Mac Ramu can keep it awake while they work. Crash reports are off by default and never leave your computer ([diagnostics](docs/guide/diagnostics.md)).

Every feature has a page in the [guide](docs/README.md#guide).

## Get started

1. Download the installer from [GitHub Releases](https://github.com/akalstack/ramu/releases).
2. Sign in to a provider ([setup](docs/guide/providers.md)).
3. Open a folder or start a thread.

For the phone, install the app and pair it with your computer ([mobile guide](apps/mobile/README.md)):

<a href="apps/mobile/README.md"><img src="apps/site/public/badges/app-store.svg" alt="Download on the App Store" height="44" /></a>&nbsp;
<a href="https://play.google.com/store/apps/details?id=com.akalstack.ramu"><img src="apps/site/public/badges/google-play.png" alt="Get it on Google Play" height="44" /></a>

| Platform | Builds                                     |
| -------- | ------------------------------------------ |
| macOS    | arm64, x64                                 |
| Linux    | x64, arm64 · `.deb`, `.rpm`, AppImage, ZIP |
| Windows  | in progress                                |

Ramu is in **alpha**. Builds are unsigned for now, so you install updates by hand. The AppImage needs FUSE 2: `sudo apt install libfuse2t64` on Ubuntu 24.04+, `libfuse2` on 22.04.

### Run from source

You need Git, Node.js 24 and pnpm 11.21.0. Native modules may also need Python 3 and a C/C++ toolchain (Xcode Command Line Tools on macOS, `build-essential` on Debian/Ubuntu).

```sh
git clone https://github.com/akalstack/ramu.git
cd ramu
npm install --global pnpm@11.21.0
pnpm install --frozen-lockfile
pnpm dev
```

## Development

Built with Electron, React, React Native and TypeScript. Start with the [architecture](docs/contributing/architecture.md).

| Command                   | What it does                                                          |
| ------------------------- | --------------------------------------------------------------------- |
| `pnpm dev`                | Start with hot reload                                                 |
| `pnpm check`              | Format, lint, type-check, test and build                              |
| `pnpm test:desktop-smoke` | Desktop startup check with simulated providers                        |
| `pnpm make`               | Build installers for this platform                                    |
| `pnpm server serve`       | Run the workspace server without the desktop app (after `pnpm build`) |

> [!NOTE]
> **Ramu is in a stability push.** The most helpful thing you can send is a fix: a bug, a crash, something slow, a missing test, a docs mistake or a translation. Those get reviewed first, and we're grateful for every one. New features stay with the core team until the push is over. Got an idea? Start a thread in [Ideas](https://github.com/akalstack/ramu/discussions/categories/ideas) so we can talk it through before anyone writes code.

- Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.
- [Report a bug](https://github.com/akalstack/ramu/issues/new/choose).
- Report vulnerabilities through [SECURITY.md](SECURITY.md).
- Planned work lives in [the roadmap](docs/roadmap.md).

## Support Ramu

Ramu is free and stays free. If it saves you time, chip in through [GitHub Sponsors](https://github.com/sponsors/akalstack) or [Trakteer](https://trakteer.id/akalstack).

## Acknowledgments

- [T3 Code](https://github.com/pingdotgg/t3code) by Ping Labs and Theo, for client-host agent UX, the companion socket transport and workflow shortcuts.
- [VS Code](https://github.com/microsoft/vscode), for UI patterns and editor architecture.
- [Codex](https://github.com/openai/codex), for agent session and provider interaction patterns.

## License

[MIT](LICENSE). The license doesn't cover the Ramu name and logo; see [trademarks](TRADEMARKS.md). Third-party assets and provider trademarks keep their own licenses; see [provider assets](apps/web/src/assets/providers/README.md) and [branding](assets/branding/README.md).
