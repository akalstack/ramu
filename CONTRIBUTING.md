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
- For desktop behavior, build and run `pnpm test:e2e` on macOS (headless; `pnpm test:e2e settings` runs one spec, `RAMU_E2E_HEADED=1` shows windows). It uses disposable repositories, an isolated profile, and simulated providers; see [e2e/README.md](e2e/README.md).
- For large lists, reviews, or editor lifecycle changes, run `pnpm test:e2e:perf rendering` after building.
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
| `packages/client-runtime` | Node client for a workspace server (local socket or authenticated HTTP) |
| `packages/shared` | Domain types, the API method table, and pure helpers |
| `e2e` | End-to-end specs that drive the built desktop app and servers, plus on-demand performance checks |
| `scripts/release` | Packaging and release tooling |

Read the [architecture overview](docs/ARCHITECTURE.md) before a large change; it explains how a call travels from the UI to the server and where new code belongs. Import shared code as `@ramu/shared/<module>`. Server code must not import Electron or `apps/desktop`; desktop reaches the server through `@ramu/client-runtime`. See [headless server](docs/HEADLESS-SERVER.md).

Match the existing TypeScript style. Keep changes focused and test behavior where useful. See [UI development](docs/UI.md), [localization](docs/LOCALIZATION.md), and [release maintenance](docs/RELEASING.md).

Contributions use the [MIT license](LICENSE). Be respectful in issues and reviews. For vulnerabilities, follow [SECURITY.md](SECURITY.md).
