# Working in this repository

Guidance for coding agents (Claude Code, Codex and others). Human contributors: see [CONTRIBUTING.md](CONTRIBUTING.md).

## Testing: run what the change can break

Desktop e2e specs launch the real app, one app per spec file, so the full suite takes many minutes. Don't run all of it by default.

1. Unit tests and types first, scoped to the package you touched: `pnpm --filter @ramu/web typecheck`, `pnpm --filter @ramu/server test`, and so on. These are fast; run them after every meaningful change.
2. E2E only for desktop-facing changes, and only the affected specs. After `pnpm build`:
   - `pnpm test:e2e:changed --list` shows which specs your changes affect and why (it reads `git diff` against `origin/main`, plus uncommitted and untracked files).
   - `pnpm test:e2e:changed` runs just those. `node e2e/run.mjs --changed HEAD` limits it to uncommitted work.
   - `pnpm test:e2e <name>` runs one spec by name while iterating.
3. Docs, unit tests, `apps/mobile` and `apps/site` changes need no desktop run; `--changed` skips them.
4. The full suite (`pnpm test:e2e`) is for release prep, changes to `e2e/support/`, or when the user asks.

When a new source area has no rule in `e2e/impact.mjs`, `--changed` falls back to a short smoke run (`layout`, `chat`). Add a rule mapping that area to the specs that exercise it.

Rebuild (`pnpm build`) before e2e runs; specs drive `apps/desktop/out` and `apps/server/dist`. Don't run `pnpm build` while specs are running, since it replaces those folders. Remove any throwaway spec files (for example screenshot helpers) before committing; every file in `e2e/specs` is a gating spec.

## Shared working tree

Other sessions may edit this checkout at the same time. Stage files by path (`git add <files>`), never `git add -A`, and check `git diff --cached --stat` before committing.
