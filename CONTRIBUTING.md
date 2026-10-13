# Contributing to Ramu

Bug reports, documentation, tests and focused improvements are welcome. For a substantial feature or architecture change, open an issue first so we can agree on the scope.

## Development

Use Node.js 24 and pnpm 11.21.0 (the version pinned in `package.json`). On macOS or Linux:

```sh
npm install --global pnpm@11.21.0
pnpm install --frozen-lockfile
pnpm dev
```

Git must be on PATH. Native dependencies may need Python 3 and a C/C++ toolchain: Xcode Command Line Tools on macOS, or `build-essential` on Debian/Ubuntu. The dependency layout is intentionally hoisted for Electron Forge; keep `pnpm-workspace.yaml` settings when changing installation tooling.

Run `pnpm check` before submitting. On macOS, also run `pnpm test:e2e` after building for changes to desktop behavior. It uses an isolated profile and simulated providers without paid model calls. Live provider tests are opt-in and are not part of CI. Build and test installers with `pnpm make` when changing packaging.

For changes to large lists, review rendering, or editor lifecycle, also run `node scripts/rendering-performance-smoke.mjs` after building. It seeds a disposable 5,000-file review and checks bounded rendering, scrolling, keyboard navigation, draft preservation, and editor cleanup without model calls.

## Project layout

- `src/main`: Electron host, background runtime, providers and repository operations.
- `src/preload`: the isolated IPC bridge.
- `src/renderer`: React workspace and editor UI.
- `src/shared`: shared types and pure helpers.
- `test`: Vitest coverage.
- `scripts`: development, integration and release helpers.

Match the existing TypeScript style and keep changes focused. Add tests for behavior changes where they provide useful coverage. Include screenshots for visible UI changes and say which checks ran. Avoid including credentials, private repositories, generated output or personal logs. Generated screenshots belong in the ignored `output/` directory and should remain local.

Contributions are licensed under the project's [MIT license](LICENSE). Be respectful and constructive in issues, pull requests and reviews. For release maintenance, see [the release guide](docs/RELEASING.md).
