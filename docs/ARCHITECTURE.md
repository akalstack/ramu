# Architecture

Ramu is a pnpm workspace. The desktop app is a thin Electron shell around a workspace **server** that owns every agent, terminal, Git operation, and database. The same server runs headless; see [headless server](HEADLESS-SERVER.md).

```
apps/web (React UI) ──► apps/desktop (Electron main + preload) ──► @ramu/client-runtime ──► apps/server
                                                                   (local socket or HTTPS + bearer token)
```

The UI never touches the filesystem, Git, or providers directly. It calls named methods; the server executes them.

Call an ongoing conversation and its work a **thread** in product copy. A **task** is a specific agent job, including delegated or scheduled work; **chat** is the act of messaging an agent. Internal `Task` types, `tasks.*` methods, `chat` routes and storage keys retain their existing names for compatibility.

## Packages

| Package | Role |
| --- | --- |
| `apps/server` | Workspace service and `ramu` CLI. Agents, providers, files, Git, terminals, schedules, SQLite. Must not import Electron or `apps/desktop`. |
| `apps/desktop` | Electron windows, menus, native dialogs, the preload bridge, update checks, packaging. Reaches the server through `@ramu/client-runtime`. |
| `apps/web` | React workspace UI and Monaco editor, rendered in the desktop app. |
| `apps/mobile` | Expo companion app that pairs with a server over the network. Not part of the alpha release. |
| `apps/site` | Project website. |
| `packages/shared` | Domain types, the API method table, and pure helpers used by every app, grouped into `chat/`, `review/`, `search/`, `workspace/` and `providers/` (import as `@ramu/shared/<folder>/<module>`). |
| `packages/contracts` | Wire protocol: versions, capabilities, request encoding. |
| `packages/client-runtime` | Node client for a server: local socket or authenticated HTTP, reconnects, limits. |
| `scripts/smoke/` | One desktop startup smoke test. |
| `scripts/` | `release/` packaging and release tooling. |

## Calling the server

Every call is a method in the table in `packages/shared/src/api.ts`, for example `'providers.signIn'(provider, accountId?)`.

1. **Declare** the method and its types in `packages/shared/src/api.ts` (types live in `packages/shared/src/types/` by domain).
2. **Implement** it in a handler group under `apps/server/src/ipc/handlers/` (`agent`, `git`, `files`, `reviews`, `terminals`, `memory`, `settings`, `providers`, and so on). Handlers receive a shared `HandlerContext` (`ipc/types.ts`) instead of reaching for globals.
3. **Register** happens in `ipc/registry.ts`, which merges the groups. A duplicate method name throws at startup.
4. **Dispatch** is `ipc/dispatcher.ts`: it validates input, runs the handler, and notifies the workspace of changes.
5. **Call it** from the UI through `apps/web/src/ipc.ts`.

Use the keyed locks in `ipc/helpers.ts` (`lockSession`, `gitExclusive`, `lockCheckouts`) when a handler must not interleave with another on the same thread or repository.

## Server layout (`apps/server/src`)

| Folder | Contents |
| --- | --- |
| `agent/` | Thread lifecycle, one collaborator per concern: session store and registry, recorder, message dispatcher, goals, provider wait, user requests (questions, permissions, elicitation), fallback router, advisor, sub-agents, stream pump, restart recovery. Each owns its state and sees the rest through a narrow `*Host` interface. `agent.ts` is the thin `AgentService` façade that wires them together. |
| `providers/` | Provider plumbing and the `ProviderAdapter` interface (`adapter.ts`) with one adapter per provider in `adapters/`: binary lookup, account environment, sign-in checks, login arguments and update plans. Also usage and usage-limit detection and `fakeAgent.ts` for simulated runs. |
| `workspace/` | Repositories, files, Git, isolation checkouts, terminals (PTY), editorconfig, discard previews. |
| `review/` | Recorded diffs, review state and stats, undo and restore with conflict checks. |
| `memory/` | Shared memory notes, memory files, learning, recaps. |
| `remote/` | Pairing, devices, network listener, presence announcements, mobile push, host folder browsing. |
| `background/` | Schedules, activity, keep-awake, app update checks, notices. |
| `ipc/` | Dispatcher, handler groups, shared context, schemas. |

`index.ts` is the service entry point, `cli.ts` the CLI, `db.ts` the database, and `build.ts` the build fingerprint used to decide when a running service is stale.

## Web layout (`apps/web/src`)

| Folder | Contents |
| --- | --- |
| `views/` and `views/agent/` | Editor, diff, file, terminal and thread views. `views/agent/` holds the thread transcript split into `components/`, `hooks/` and `lib/`. |
| `chat/` | Thread chrome shared across views: activity, find, goal bar, questions, notifications. |
| `composer/` | Message composer, suggestions, attachments, drafts, the offline outbox. |
| `models/` | Model and reasoning pickers, provider icons and setup. |
| `settings/` | Settings dialog and its sections; provider cards, login and account rows. |
| `git/` | Git controls, review chips and diffs, commit dialogs. |
| `changes/` | The review tab for a thread's recorded changes. |
| `workspace/` | Layout, panes, terminals, project switching, paired hosts. |
| `sidebar/` | Projects, Explorer, Source Control and Search panels, each in its own subfolder. |
| `editor/` | Monaco setup and editor buffers. |
| `lib/` | Small framework-free helpers and hooks. |
| `components/` | Shared UI primitives (`components/ui` is shadcn-based). |

## Providers

Threads run through provider adapters selected per thread (`AgentSettings.provider`). Provider-specific setup behavior (executable and `RAMU_*_BIN` variable, account profiles, sign-in detection, login and update) is a `ProviderAdapter` in `apps/server/src/providers/adapters/`; `providers.ts` and `providerBinaries.ts` keep the shared spawning, caching and parsing. To add a provider, add an adapter, register it in `adapters/index.ts`, and add its id to `AgentProvider` in `packages/shared`. How it chats is an `AgentRunner` (`agent/agentRunner.ts`) listed in `providers/runners.ts`; use the provider's own SDK where it has one, or `createAcpRunner` for an ACP runtime. Features the provider has natively (`NativeFeatures` on the adapter) replace Ramu's own where they can serve Ramu's flow. An adapter may also define `skillsLaunch`, which points the provider at Ramu's per-scope managed-skill export for one thread (a Claude plugin, a Codex skill root, an OpenCode `skills` entry, or `linkDirs` for Cursor and Antigravity, which scan a fixed folder in the thread's working directory and get git-excluded symlinks from `memory/skillLinks.ts`; see [learning](LEARNING.md)). `providers/fakeAgent.ts` implements the same events, permission requests and transcript paths without model usage; the desktop smoke test uses it.

Accounts: every enabled account of a provider is tried in order (selected account, the default login, then the others) when a thread reaches a usage limit, before Ramu falls back to another model. Turn an account off in Settings to remove it from the rotation.

## Testing

- `pnpm check`: format, typecheck, unit tests, release-script tests, build. CI runs it on macOS and Linux.
- `pnpm test:desktop-smoke`: one desktop startup check with simulated providers and an isolated profile (macOS). Run after `pnpm build`; release checks also run it against the packaged macOS app.
- Server tests are in `apps/server/test`, mirroring `src` by file name.

## Code quality

`pnpm check` also runs ESLint (`eslint.config.mjs`: typescript-eslint and the classic React hooks rules) and [knip](https://knip.dev) (`knip.json`) to catch unused files, exports and dependencies. Desktop lists runtime packages (for example the provider SDKs) that its bundled service loads, so `knip.json` ignores them on purpose.

## Known follow-ups

- Warnings remain for `react-hooks/exhaustive-deps` and `@typescript-eslint/no-explicit-any`; they are not errors yet.
- Provider install, login and update flows are only exercised by live providers; validate changes there against real CLIs.
