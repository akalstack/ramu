# Working in this repository

Guidance for coding agents (Claude Code, Codex and others). Human contributors: see [CONTRIBUTING.md](CONTRIBUTING.md).

## Testing: run what the change can break

1. Add or update focused unit tests alongside future behavior changes and bug fixes. Cover the changed behavior, meaningful edge cases, and regressions in the package's existing test directory. Prefer unit tests for logic and integration tests when a real package boundary matters; avoid tests that only mirror the implementation.
2. Run unit tests and types scoped to the package you touched after every meaningful change: `pnpm --filter @ramu/web typecheck`, `pnpm --filter @ramu/server test`, and so on.
3. Keep exactly one desktop startup smoke test: `scripts/smoke/desktop-smoke.mjs`. For desktop-facing changes, run `pnpm build` followed by `pnpm test:desktop-smoke`. It launches the built app with an isolated profile and simulated providers, checks that the shell loads, and watches for startup errors. CI runs it on macOS; release checks also run it against the packaged macOS app.
4. Docs, unit tests, `apps/mobile` and `apps/site` changes need no desktop smoke run. Do not recreate a desktop e2e or performance suite; cover future behavior with focused unit or integration tests instead.

Rebuild before smoke runs; the test drives `apps/desktop/out` and `apps/server/dist`. Don't build while the smoke test is running, since it replaces those folders. Set `RAMU_PACKAGED_EXECUTABLE` to test a packaged app. Failure diagnostics are saved under `output/desktop-smoke/`.

## Shared working tree

Other sessions may edit this checkout at the same time. Stage files by path (`git add <files>`), never `git add -A`, and check `git diff --cached --stat` before committing.
