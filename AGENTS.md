# Working in this repository

Guidance for coding agents. Human contributors: see [CONTRIBUTING.md](CONTRIBUTING.md).

## Product design and architecture

Build only what helps a person working with AI agents complete a concrete task and makes their work easier: fewer steps, less to remember, less rework. Ship complete workflows with useful defaults and a clear next action, and remove effort wherever the app can infer, prefill or remember. Keep advanced controls optional. Preserve accessibility, localization, drafts and the ability to review, correct, stop and recover agent work.

Follow [Architecture](docs/ARCHITECTURE.md) and [UI](docs/UI.md). Reuse existing navigation, components and services. Agents, files, Git and workspace state belong on the execution server behind the typed API; device interactions and preferences belong on the device. Preserve host isolation and provider boundaries. Add abstractions or settings only for demonstrated needs.

## UI components

Treat `apps/web/src/components/ui/` as upstream-owned shadcn primitives: do not edit or copy them for Ramu-specific behavior. Compose reusable app components outside that directory, following `apps/web/src/components/desktop-button.tsx`. Keep shared variants, theme tokens and interaction states there, preserving accessibility, refs and composition APIs.

## Testing

Add or update focused tests for behavior changes and bug fixes in the package's existing test directory. Cover observable behavior and meaningful edge cases; avoid tests that repeat implementation details. Use integration tests when a real package boundary matters.

Run relevant tests and typechecks for affected packages, such as `pnpm --filter @ramu/web test` and `pnpm --filter @ramu/web typecheck`. Report what ran and any checks you could not complete. Documentation-only changes need formatting and link checks.

For desktop-facing changes, run `pnpm build` followed by `pnpm test:desktop-smoke`. Do not rebuild while smoke runs. Keep `scripts/smoke/desktop-smoke.mjs` as the single desktop startup check; do not add another desktop e2e or performance suite. Docs, test-only, mobile-only and site-only changes need no desktop smoke. See [Architecture](docs/ARCHITECTURE.md#testing) and [Releasing](docs/RELEASING.md) for broader validation and packaged-app checks.

## Planning docs

Plans describe unfinished work: the human need and how the delivery makes that person's work easier (steps removed, context carried over, mistakes prevented), the full intended delivery, existing services to extend and acceptance checks. Keep later options separate. Validate with a representative task: the person finishes it with less effort than before.

Remove completed items and delete finished plans. Put lasting behavior in feature guides, remaining checks or blockers in [the roadmap](docs/ROADMAP.md) or an active plan, and update links. Do not keep completed-plan ledgers.

## Shared working tree

Preserve other sessions' edits. Stage files by path, never `git add -A`, and inspect `git diff --cached --stat` before committing.
