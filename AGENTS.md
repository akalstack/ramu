# Working in this repository

Guidance for coding agents. Human contributors: see [CONTRIBUTING.md](CONTRIBUTING.md).

## Product design and architecture

Build only what helps a person working with AI agents complete a concrete task and makes their work easier: fewer steps, less to remember, less rework. Ship complete workflows with useful defaults and a clear next action, and remove effort wherever the app can infer, prefill or remember. Keep advanced controls optional. Preserve accessibility, localization, drafts and the ability to review, correct, stop and recover agent work.

Follow [Architecture](docs/contributing/architecture.md) and [UI](docs/contributing/ui.md). Reuse existing navigation, components and services. Agents, files, Git and workspace state belong on the execution server behind the typed API; device interactions and preferences belong on the device. Preserve host isolation and provider boundaries. Add abstractions or settings only for demonstrated needs.

## Code conventions

Follow [Code conventions](docs/contributing/code-style.md) for every change; it is the reference that keeps human and agent contributions consistent. In short:

- Extend what exists before adding anything. Shared pure logic goes in `packages/shared`; the server owns agents, files, Git, terminals and storage.
- Strict TypeScript, no new `any`, no `@ts-ignore`, no dead code or unused exports. Prettier and ESLint decide style; run `pnpm format`.
- Keep released behavior compatible: a schema change adds a migration, and a renamed API, tool, link or setting keeps its old name working until a later release removes it.
- Validate and bound every server input with `zod`; enforce authorization on the server; keep secrets in `credentials/`; never build shell strings.
- Every visible string goes through `t()` with an Indonesian translation; UI is built from the app-owned wrappers in `apps/web/src/components`, never raw buttons.
- Comments explain why, not what, and never narrate history. Docs describe current behavior only.

## UI components

Treat `apps/web/src/components/ui/` as upstream-owned shadcn primitives: do not edit or copy them for Ramu-specific behavior. Compose reusable app components outside that directory, following `apps/web/src/components/desktop-button.tsx`. Keep shared variants, theme tokens and interaction states there, preserving accessibility, refs and composition APIs.

## Testing

Add or update focused tests for behavior changes and bug fixes in the package's existing test directory. Cover observable behavior and meaningful edge cases; avoid tests that repeat implementation details. Use integration tests when a real package boundary matters.

Run relevant tests and typechecks for affected packages, such as `pnpm --filter @ramu/web test` and `pnpm --filter @ramu/web typecheck`. Report what ran and any checks you could not complete. Documentation-only changes need formatting and link checks.

For desktop-facing changes, run `pnpm build` followed by `pnpm test:desktop-smoke`. Do not rebuild while smoke runs. Keep `scripts/smoke/desktop-smoke.mjs` as the single desktop startup check; do not add another desktop e2e or performance suite. Docs, test-only, mobile-only and site-only changes need no desktop smoke. See [Architecture](docs/contributing/architecture.md#testing) and [Packaging](docs/contributing/packaging.md) for broader validation and packaged-app checks.

## Planning docs

Unfinished work lives only in [the roadmap](docs/roadmap.md). Plans describe unfinished work: the human need and how the delivery makes that person's work easier (steps removed, context carried over, mistakes prevented), the full intended delivery, existing services to extend and acceptance checks. Keep later options separate. Validate with a representative task: the person finishes it with less effort than before.

Remove completed items and delete finished plans. Put lasting behavior in feature guides and blockers in [the roadmap](docs/roadmap.md), and update links. Do not keep completed-plan ledgers.

Public docs are for people using and contributing to Ramu. Checks that need a physical device, a paid account or a second host, and maintainer-only release steps, are kept by the maintainers outside this repository; name any such check you could not run in your pull request instead of adding it to the docs.

## Shared working tree

Preserve other sessions' edits. Stage files by path, never `git add -A`, and inspect `git diff --cached --stat` before committing.

Do not copy your agent tool's built-in skills (such as `run-workflow`) into this repository; the root `skills/` folder is ignored.
