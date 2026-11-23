# Contributing

Ramu is in a stability push. The most helpful thing you can send is a fix: a bug, a crash, something slow, a missing test, a docs mistake or a translation. Those get reviewed first, and we're grateful for every one. New features stay with the core team until the push is over. Got an idea? Start a thread in [Ideas](https://github.com/akalstack/ramu/discussions/categories/ideas) so we can talk it through before anyone writes code.

Report bugs in issues. For a fix, describe the problem, the expected behavior and the steps to reproduce it. Open an issue before a large architecture change.

To send a change: fork the repository, create a branch, commit with a message that says what changes for the person using Ramu, and open a pull request against `main`. Questions go to [Discussions](https://github.com/akalstack/ramu/discussions).

## Development

Use Git, Node.js 26 LTS and pnpm 12.21.0:

```sh
npm install --global pnpm@12.21.0
pnpm install --frozen-lockfile
pnpm dev
```

| Command | Starts |
| --- | --- |
| `pnpm dev` | The desktop app with hot reload |
| `pnpm dev:server` | The workspace server alone |
| `pnpm dev:mobile` | Metro for the phone app ([mobile README](apps/mobile/README.md#development)) |
| `pnpm dev:site` | The getramu.dev website |

`pnpm dev` runs as **Ramu Dev**, with its own data folder (`~/Library/Application Support/Ramu Dev` on macOS) and its own keychain item, so it never touches the Ramu you use or asks for your keychain password. `RAMU_USER_DATA=/path` points it at another folder. To work without signing in to a paid provider, start with `RAMU_FAKE_AGENT=1 pnpm dev`: every provider is simulated.

Project search uses your `rg` if installed, otherwise the ripgrep inside the bundled Claude Code binary. Native dependencies may need Python 3 and a C/C++ toolchain. Keep the hoisted dependency layout in `pnpm-workspace.yaml`. Electron Forge depends on it.

## Checks

- Run `pnpm check` before submitting. It runs Prettier (`pnpm format` fixes it), ESLint (`pnpm lint`), knip (`pnpm knip`, unused code and dependencies), typechecks, tests and builds. For one package, use `pnpm --filter @ramu/server test` (or `typecheck`).
- For desktop behavior, run `pnpm build` then `pnpm test:desktop-smoke` (on Linux, `xvfb-run -a pnpm test:desktop-smoke`). It's the single startup check, with an isolated profile and simulated providers. Add focused unit or integration tests for behavior changes (see [AGENTS.md](AGENTS.md)).
- For packaging changes, build and test the installer with `pnpm make` ([Packaging](docs/contributing/packaging.md)).

Live-provider tests are opt-in and may use paid model calls. Report which checks ran and include screenshots for UI changes. Keep generated output, private logs, credentials, and personal repositories out of commits.

## Code layout

A pnpm workspace. Each package has its own `src`, `test`, and `typecheck`/`test` scripts.

| Directory | Contents |
| --- | --- |
| `apps/desktop` | Electron shell: windows, menus, native dialogs, preload bridge, updates, packaging |
| `apps/web` | React workspace UI and editor, rendered inside the desktop app |
| `apps/server` | Workspace server and `ramu` CLI: agents, providers, files, Git, terminals, schedules, database |
| `apps/mobile` | Expo phone app for iOS and Android ([README](apps/mobile/README.md)) |
| `apps/site` | The getramu.dev website |
| `packages/contracts` | Wire protocol: versions, capabilities, request encoding |
| `packages/client-runtime` | Node client for a workspace server (local socket or authenticated WebSocket) |
| `packages/shared` | Domain types, the API method table, and pure helpers |
| `scripts/smoke` | One desktop startup smoke test |
| `scripts/release` | Packaging and release tooling |

Read the [architecture overview](docs/contributing/architecture.md) before a large change. It shows how a call travels from the UI to the server and where new code belongs. Import shared code as `@ramu/shared/<module>`. Server code must not import Electron or `apps/desktop`. The desktop reaches the server through `@ramu/client-runtime`. See [headless server](docs/guide/remote-hosts.md).

Follow the [code conventions](docs/contributing/code-style.md) and keep changes focused. See also [UI development](docs/contributing/ui.md), [localization](docs/contributing/localization.md), [the roadmap](docs/roadmap.md) and [packaging](docs/contributing/packaging.md).

Contributions use the [MIT license](LICENSE). Follow the [Code of Conduct](CODE_OF_CONDUCT.md). For vulnerabilities, follow [SECURITY.md](SECURITY.md).
