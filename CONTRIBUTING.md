# Contributing

Open an issue before a substantial feature or architecture change. For fixes, include the problem, expected behavior, and steps to reproduce it.

## Development

Use Git, Node.js 24, pnpm 11.21.0, and ripgrep (`rg`, needed by project search and its tests):

```sh
npm install --global pnpm@11.21.0
pnpm install --frozen-lockfile
pnpm dev
```

Native dependencies may need Python 3 and a C/C++ toolchain. Keep the hoisted dependency layout in `pnpm-workspace.yaml`; Electron Forge depends on it.

## Checks

- Run `pnpm check` before submitting; it runs formatting (`pnpm format` fixes it), ESLint (`pnpm lint`), knip (`pnpm knip`, unused code and dependencies), typechecks, tests and builds. To work on one package, use `pnpm --filter @ramu/server test` (or `typecheck`).
- For desktop behavior, run `pnpm build` followed by `pnpm test:desktop-smoke` on macOS. This single startup check uses an isolated profile and simulated providers. Add focused unit or integration tests for behavior changes; see [AGENTS.md](AGENTS.md).
- For packaging changes, build and test the installer with `pnpm make`.

Live-provider tests are opt-in and may use paid model calls. Report which checks ran and include screenshots for UI changes. Keep generated output, private logs, credentials, and personal repositories out of commits.

## Code layout

pnpm workspace; each package has its own `src`, `test`, and `typecheck`/`test` scripts.

| Directory | Contents |
| --- | --- |
| `apps/desktop` | Electron shell: windows, menus, native dialogs, preload bridge, updates, packaging |
| `apps/web` | React workspace UI and editor, rendered inside the desktop app |
| `apps/server` | Workspace server and `ramu` CLI: agents, providers, files, Git, terminals, schedules, database |
| `packages/contracts` | Wire protocol: versions, capabilities, request encoding |
| `packages/client-runtime` | Node client for a workspace server (local socket or authenticated WebSocket) |
| `packages/shared` | Domain types, the API method table, and pure helpers |
| `scripts/smoke` | One desktop startup smoke test |
| `scripts/release` | Packaging and release tooling |

Read the [architecture overview](docs/contributing/architecture.md) before a large change; it explains how a call travels from the UI to the server and where new code belongs. Import shared code as `@ramu/shared/<module>`. Server code must not import Electron or `apps/desktop`; desktop reaches the server through `@ramu/client-runtime`. See [headless server](docs/guide/remote-hosts.md).

Follow the [code conventions](docs/contributing/code-style.md), keep changes focused, and test behavior. See also [UI development](docs/contributing/ui.md), [localization](docs/contributing/localization.md), [the roadmap](docs/roadmap.md) and [release maintenance](docs/contributing/releasing.md).

Contributions use the [MIT license](LICENSE). Follow the [Code of Conduct](CODE_OF_CONDUCT.md). For vulnerabilities, follow [SECURITY.md](SECURITY.md).
