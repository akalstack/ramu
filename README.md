<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo.svg" />
    <img src="assets/logo-light.svg" alt="Ramu" width="300" />
  </picture>
</p>

<p align="center">
  <strong>Your project. Every repo. One workspace.</strong><br />
  A desktop coding workspace for working with agents, reviewing their changes, and managing Git, without leaving the app.
</p>

---

*Ramu* (pronounced RAH-moo) is Indonesian for blending ingredients into one mixture, which is the idea behind the app: an editor, coding agents, Git and project management, blended into one workspace. Ramu groups one or more independent Git repositories into a project. Each chat brings the relevant repositories, files, terminals, and reviews together, so you stop reopening another editor to check what your coding agent did.

## Why Ramu is different

Most AI coding tools are moving away from the editor. You hand over a task, wait, and read a summary or a diff afterwards.

Ramu brings the editor back and builds the agent around it. You work **alongside** the agent in the same workspace:

- **Edit while it works.** The agent runs in one tab while you read, edit and run code in the others. Your open files, including unsaved edits, are sent to the agent as context.
- **Review it like a teammate.** Comment on a line or file in the recorded changes. Send those comments with your next chat message, including the surrounding code.
- **Stay in control.** Comments stay local until you send them, and you can preview undoing a run while preserving later edits.
- **Keep your tools.** Git, terminals and every repository in the project are in the same window, so you don't reopen another editor to finish the job.

The result is a loop closer to pair programming than to delegation: the agent works, you review and edit, you discuss, the agent fixes, and you approve.

## Features

- **Agents with Claude, Codex, OpenCode, Cursor and Antigravity.** Chats work with or without a project. Choose the model and reasoning effort from a slider, and keep several chats running at once.
- **Background service.** A separate runner owns agent sessions, so chats and schedules keep going when you close the window. Reopening Ramu reconnects to the live output.
- **Schedules.** Run a prompt once or on a recurrence, with timezones and a missed-run policy. Ask an agent to create a schedule from chat, or manage them in the Schedules tab.
- **Daily recap.** Home shows what still needs you and what moved since your last visit. On by default and can be turned off in Settings.
- **Review beside chat.** Recorded changes appear with each agent turn. Open their diffs, comment on lines or files, and send those comments with your next message. Nothing is sent until you choose to.
- **Recorded revisions and undo.** Compare agent changes with current files, browse earlier revisions, and preview undoing a run while preserving later edits.
- **Composer context.** `/` opens commands and skills, `@` mentions files, and open editor tabs are attached as context, including unsaved edits.
- **Editor, terminal and Git.** Monaco editor, integrated terminals, and repository-aware staging, commits, branches and diffs.
- **Your project's own tools.** Problems and Format document come from the Prettier, Biome, Oxc, ESLint, Ruff, gofmt or rustfmt setup already in the repo, with optional format on save. TypeScript and JavaScript get completion, hover, go to definition and real type errors from the project's own TypeScript.
- **AI inline completion.** Optional ghost-text suggestions from a local Ollama model (Ramu recommends one for your hardware and can install it) or Mistral's Codestral. Off by default; code only leaves your machine with a cloud provider.

## Getting started

Ramu is in desktop alpha. macOS is the primary validated desktop platform; Linux release builds are included in CI. Windows runtime support is still experimental and Windows downloads are not produced by the release workflow. Automated macOS builds are unsigned and not notarized.

### Run from source

Requires Git, Node.js 24 and [pnpm](https://pnpm.io) 11.21.0. Native dependencies may require Python 3 and a C/C++ toolchain (Xcode Command Line Tools on macOS or `build-essential` on Debian/Ubuntu).

Clone this repository, then run from its root:

```sh
npm install --global pnpm@11.21.0
pnpm install --frozen-lockfile
pnpm dev
```

### Connect an agent

Open **Settings → Providers** to detect installed runtimes, choose executable paths, and sign in. Ramu supports Claude Code, Codex, OpenCode, Cursor and Antigravity through their local runtimes. Each provider requires its own installation and account or model configuration. See [provider setup and compatibility](docs/PROVIDERS.md) for details.

All providers appear in the model picker and model sets. Favorite models can be reordered with the pencil toggle, using drag handles or Alt+↑/↓; the checkmark returns to model selection.

| Command | What it does |
| --- | --- |
| `pnpm dev` | Run the app with hot reload |
| `pnpm build` | Build the main process, background runner, preload and renderer |
| `pnpm check` | Type-check, run unit and release-script tests, and build |
| `pnpm typecheck` | Type-check the main and renderer projects |
| `pnpm test` | Run the unit tests |
| `pnpm test:e2e` | Run the Electron integration journey with simulated providers |
| `pnpm package` / `pnpm make` | Package or create installers with Electron Forge |
| `pnpm release:prepare <version>` | Update the version and scaffold reviewable release notes |
| `pnpm release:draft <tag>` | Start CI builds and create a draft GitHub release |
| `pnpm ui:add <component>` | Add a shadcn component |
| `pnpm icons` | Re-render the app icon from `assets/icon.svg` |

## Documentation

- [Contributing](CONTRIBUTING.md)
- [Releasing and draft-release commands](docs/RELEASING.md)
- [Provider setup](docs/PROVIDERS.md)
- [Background chats, schedules, recaps and reviews](docs/AUTOMATION.md)
- [Formatting, linting and completion](docs/EDITOR-TOOLING.md)
- [UI components, logo and releases](docs/UI-AND-RELEASES.md)

## Releases and contributions

Download installers from this repository's **GitHub Releases** page when a release is available. Choose the asset matching your OS and CPU; checksum files accompany the downloads. To build locally, run `pnpm make`. The [release guide](docs/RELEASING.md) covers draft releases, CI targets and signing setup. No automatic update channel is configured.

Bug reports and focused contributions are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md); use the repository's issue templates for bugs and feature requests. For vulnerabilities, follow [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © 2026 Ramu contributors. Agent providers and bundled dependencies retain their own licenses and terms.
