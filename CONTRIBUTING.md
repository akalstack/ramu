# Contributing

Open an issue before a substantial feature or architecture change. For fixes, include the problem, expected behavior, and steps to reproduce it.

## Development

Use Git, Node.js 24, and pnpm 11.21.0:

```sh
npm install --global pnpm@11.21.0
pnpm install --frozen-lockfile
pnpm dev
```

Native dependencies may need Python 3 and a C/C++ toolchain. Keep the hoisted dependency layout in `pnpm-workspace.yaml`; Electron Forge depends on it.

## Checks

- Run `pnpm check` before submitting.
- For desktop behavior, build and run `pnpm test:e2e` on macOS. It uses disposable repositories, an isolated profile, and simulated providers.
- For large lists, reviews, or editor lifecycle changes, run `node scripts/rendering-performance-smoke.mjs` after building.
- For packaging changes, build and test the installer with `pnpm make`.

Live-provider tests are opt-in and may use paid model calls. Report which checks ran and include screenshots for UI changes. Keep generated output, private logs, credentials, and personal repositories out of commits.

## Code layout

| Directory | Contents |
| --- | --- |
| `src/main` | Electron host, background service, providers, and repository operations |
| `src/preload` | IPC bridge |
| `src/renderer` | React UI and editor |
| `src/shared` | Types and pure helpers |
| `test` | Vitest tests |
| `scripts` | Integration, development, and release helpers |

Match the existing TypeScript style. Keep changes focused and test behavior where useful. See [UI development](docs/UI.md), [localization](docs/LOCALIZATION.md), and [release maintenance](docs/RELEASING.md).

Contributions use the [MIT license](LICENSE). Be respectful in issues and reviews. For vulnerabilities, follow [SECURITY.md](SECURITY.md).
