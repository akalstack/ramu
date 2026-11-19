# Code conventions

Rules for human and agent contributors. `pnpm check` enforces what tools can (Prettier, ESLint, knip, `tsc`, tests). This page covers the rest. When code and this page disagree, fix whichever is wrong in the same change.

## Before writing code

1. Find the existing module, component or service that already does the job, and extend it. Search `packages/shared` first: pure logic used by more than one app lives there.
2. Put code where [Architecture](architecture.md) says it belongs. The server owns agents, files, Git, terminals and storage. The UI calls typed methods and never touches them directly.
3. Add an abstraction, setting or dependency only for a need that exists today.

## TypeScript

- Prettier decides formatting (no semicolons, single quotes, 120 columns, trailing commas). Run `pnpm format` and don't hand-format.
- `strict` and `noUncheckedIndexedAccess` are on. Narrow indexed reads instead of asserting with `!` unless the invariant is local and obvious.
- Avoid `any`. Use `unknown` and narrow, or a precise type. `any` is allowed only at the untyped wire boundaries and in the tests listed in `eslint.config.mjs`, and is a lint error elsewhere. Don't add `@ts-ignore`. Use `@ts-expect-error` with the reason, and only when the error is real.
- Prefer `const`, early returns, small functions and discriminated unions over flags and optional-field bags. Name things for what they are, not how they are used.
- Imports: ES modules only. Shared code is imported as `@ramu/shared/<module>`, with its folder when it has one (`@ramu/shared/chat/presentation`). Never reach into another package's `src` by relative path. `apps/server` must not import Electron or `apps/desktop`.
- Throw `Error` with a message a person can act on (a sentence, no stack jargon). When rethrowing, pass `{ cause }`. Never put tokens, prompts or file contents in error text or logs.
- Empty `catch {}` is allowed only when failure is expected and harmless. Say why in a comment if it isn't obvious.
- Disabling an ESLint rule needs a one-line reason after `--`. The usual case is a regex that matches control characters on purpose.
- No dead code, commented-out code or exports nothing imports (`pnpm knip` fails the build). Delete rather than deprecate.

## Comments and naming

- Comment the why: a constraint, an ordering requirement, a security boundary or a surprising platform behavior. Do not narrate what the next line does.
- Exported functions and types that are not self-explanatory get a short `/** … */`. Keep comments true to the current code: no history ("now", "previously", "fixed in …"), no task or ticket references.
- Files are `camelCase.ts` for modules, `PascalCase.tsx` for components, `kebab-case.tsx` for the app-owned shared controls in `apps/web/src/components`. Tests are `<module>.test.ts` (`.test.mjs` in `apps/mobile`) in the package's `test/` directory.
- User-facing words: **thread** (product copy), **task** (internal and API names). See [Architecture](architecture.md).

## Server (`apps/server`)

- A new call is a method in `packages/shared/src/api.ts`, implemented in a handler group under `src/ipc/handlers/`. Handlers take the shared `HandlerContext`, not globals.
- Validate every input at the handler boundary with a `zod` schema from `ipc/schemas.ts` or beside the handler. Bound strings, arrays and numbers (`max`, `int`, `positive`). Unbounded input is a defect.
- Use the keyed locks in `ipc/helpers.ts` for work that must not interleave.
- Authorization is server-side. Hiding a control in the UI is never a permission check. New methods are denied to viewer-role devices unless added to the viewer allowlist (`viewerMayInvoke` in `packages/shared/src/viewerAccess.ts`) on purpose (see [Security](../../SECURITY.md)).
- Secrets go through `credentials/`. Only opaque references are stored in settings or SQLite.
- Mutations that may be retried take an operation key so a repeat returns the first result.
- Build commands Ramu runs itself as an executable plus an argument array, never a shell string. (Terminals, background terminals and goal `verify:` commands run user-supplied shell text on purpose. Keep their approvals and limits.) Resolve paths and check containment before reading or writing user-supplied paths.
- Keep one collaborator per concern with a narrow `*Host` interface, as in `agent/`. Don't grow the façade files.

## Web (`apps/web`)

- Function components and hooks. List every dependency. Omit one only when the effect is keyed on a trigger on purpose, and say why in the disable comment. Never put a call, conditional or fresh object in a dependency array. Prefer an event handler or a ref over a suppressed effect. `react-hooks/exhaustive-deps` and `no-explicit-any` are lint errors, so a new violation fails `pnpm check`. Existing disables are debt, not precedent.
- Server data goes through `ipc.ts` (`ramu.invoke`, `invokeOn`) and TanStack Query keys of the form `['ipc', hostId, method, ...]`. Don't keep a second copy of server state in component state.
- Every visible string goes through `t()`. Add the Indonesian translation in the same change ([Localization](localization.md)).
- UI is composed from `components/ui` (upstream shadcn, never edited) through the app-owned wrappers (`desktop-button.tsx`, `row-button.tsx`, `drag-handle.tsx`, …). No raw `<button>` (`sharedButtons.test.ts` enforces it). See [UI](ui.md).
- Respect reduced motion, keyboard operation and accessible names for every new control.
- Keep per-device choices (layout, appearance) on the device and anything an agent or repository depends on on the server.

## Mobile (`apps/mobile`)

- Share logic with the desktop by moving it into `packages/shared`. Keep screens thin.
- Copy goes through `useT()` or `useSay()` and the shared dictionary.
- Controls need accessible labels and touch targets, and must work when the host is offline or the device is a viewer. Row actions are siblings of the row, not nested inside it.

## Compatibility

People install Ramu, keep their data in it, and pair phones and hosts that update at different times. Keep what they already have working:

- A schema change updates `SCHEMA` in `apps/server/src/db.ts` and adds an entry to `MIGRATIONS` in the same change, so existing profiles upgrade in place. Don't edit a released migration or drop people's data.
- The host's API, agent tools, links (`ramu://`), push payloads and saved settings are contracts with other devices and older versions. To rename or remove one, keep the old name working beside the new one and remove it in a later release on purpose.
- Say in the pull request when a change can't stay compatible, and why.


- Vitest for packages and apps (`apps/mobile` uses `node --test`). Add or update a test for every behavior change or bug fix, in the package's `test/` directory.
- Test observable behavior and edge cases: failure paths, limits, races, permission denial. Do not assert implementation details or re-test the library.
- Prefer real boundaries (SQLite on a temp directory, an in-process server) over mocks, and fakes for providers (`providers/fakeAgent.ts`). Tests must not need network, credentials or a paid model. Opt-in live tests use the `*.live.test.ts` suffix and skip unless their environment variable is set.
- Leave nothing behind: temp directories and timers are cleaned up.
- The single desktop startup check is `scripts/smoke/desktop-smoke.mjs`. Don't add another end-to-end suite.

## Documentation

- Docs describe how things work now. No changelogs, status ledgers, dates of when something was verified, or "we plan to" outside [the roadmap](../roadmap.md).
- One home per fact. Link instead of repeating. A feature guide covers behavior a person or contributor needs. Implementation detail belongs in code comments.
- Write short, concrete sentences in the present tense. Cut filler, hedging and marketing. Prefer a list or table to a long paragraph.
- Update the guide in the same change that alters the behavior, and delete its section when the feature goes.

## Commits and pull requests

- Conventional commit subjects: `feat(scope): …`, `fix(scope): …`, `docs: …`, `refactor`, `test`, `chore`. Describe the outcome, not the files.
- One focused change per pull request. State what you ran (`pnpm check`, desktop smoke) and attach screenshots for UI changes.
