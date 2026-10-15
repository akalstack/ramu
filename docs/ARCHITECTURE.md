# Architecture

Ramu is a pnpm workspace. The desktop app is a thin Electron shell around a workspace **server** that owns every agent, terminal, Git operation, and database. The same server runs headless; see [headless server](HEADLESS-SERVER.md).

```
apps/web (React UI) ──► apps/desktop (Electron main + preload) ──► @ramu/client-runtime ──► apps/server
                                                                   (local socket or HTTPS + bearer token)
```

The UI never touches the filesystem, Git, or providers directly. It calls named methods; the server executes them.

## Packages

| Package | Role |
| --- | --- |
| `apps/server` | Workspace service and `ramu` CLI. Agents, providers, files, Git, terminals, schedules, SQLite. Must not import Electron or `apps/desktop`. |
| `apps/desktop` | Electron windows, menus, native dialogs, the preload bridge, update checks, packaging. Reaches the server through `@ramu/client-runtime`. |
| `apps/web` | React workspace UI and Monaco editor, rendered in the desktop app. |
| `apps/mobile` | Expo companion app that pairs with a server over the network. Not part of the alpha release. |
| `apps/site` | Project website. |
| `packages/shared` | Domain types, the API method table, and pure helpers used by every app. |
| `packages/contracts` | Wire protocol: versions, capabilities, request encoding. |
| `packages/client-runtime` | Node client for a server: local socket or authenticated HTTP, reconnects, limits. |
| `scripts/` | `smoke/` Electron and integration checks, `release/` packaging and release tooling. |

## Calling the server

Every call is a method in the table in `packages/shared/src/api.ts`, for example `'providers.signIn'(provider, accountId?)`.

1. **Declare** the method and its types in `packages/shared/src/api.ts` (types live in `packages/shared/src/types/` by domain).
2. **Implement** it in a handler group under `apps/server/src/ipc/handlers/` (`agent`, `git`, `files`, `reviews`, `terminals`, `memory`, `settings`, `providers`, and so on). Handlers receive a shared `HandlerContext` (`ipc/types.ts`) instead of reaching for globals.
3. **Register** happens in `ipc/registry.ts`, which merges the groups. A duplicate method name throws at startup.
4. **Dispatch** is `ipc/dispatcher.ts`: it validates input, runs the handler, and notifies the workspace of changes.
5. **Call it** from the UI through `apps/web/src/ipc.ts`.

Use the keyed locks in `ipc/helpers.ts` (`lockSession`, `gitExclusive`, `lockCheckouts`) when a handler must not interleave with another on the same chat or repository.

## Server layout (`apps/server/src`)

| Folder | Contents |
| --- | --- |
| `agent/` | Chat lifecycle: runner, permissions (`canUseTool`), goals, advisor, questions and elicitation, handoff, asides, usage reading. `agent.ts` is the `AgentService` that wires them together. |
| `providers/` | Provider adapters and plumbing: Claude (SDK and ACP), Codex, OpenCode, Cursor, Antigravity; binary discovery, login and update, usage and usage-limit detection, and `fakeAgent.ts` for simulated runs. |
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
| `views/` and `views/agent/` | Editor, diff, file, terminal and chat views. `views/agent/` holds the chat transcript split into `components/`, `hooks/` and `lib/`. |
| `chat/` | Chat chrome shared across views: activity, find, goal bar, questions, notifications. |
| `composer/` | Message composer, suggestions, attachments, drafts, the offline outbox. |
| `models/` | Model and reasoning pickers, provider icons and setup. |
| `settings/` | Settings dialog and its sections; provider cards, login and account rows. |
| `git/` | Git controls, review chips and diffs, commit dialogs. |
| `changes/` | The review tab for a chat's recorded changes. |
| `workspace/` | Layout, panes, terminals, project switching, paired computers. |
| `sidebar/` | Projects, Explorer, Source Control and Search panels, each in its own subfolder. |
| `editor/` | Monaco setup and editor buffers. |
| `lib/` | Small framework-free helpers and hooks. |
| `components/` | Shared UI primitives (`components/ui` is shadcn-based). |

## Providers

Chats run through provider adapters selected per chat (`AgentSettings.provider`). `providers/fakeAgent.ts` implements the same events, permission requests and transcript paths without model usage; the Electron smoke tests depend on it. Provider behavior that differs by name (install, login, update, binary lookup) currently lives in `providers/providers.ts` and `providers/providerBinaries.ts`.

## Testing

- `pnpm check`: format, typecheck, unit tests, release-script tests, build. CI runs it on macOS and Linux.
- `pnpm test:e2e`: a full Electron journey with simulated providers and an isolated profile (macOS). Other `scripts/smoke/` checks cover layout, SCM, remote access, localization and performance; see [CONTRIBUTING](../CONTRIBUTING.md).
- Server tests are in `apps/server/test`, mirroring `src` by file name.

## Known follow-ups

- `AgentService` is still a large class. Goals, questions, fallback and the queue share about thirty mutable maps, so splitting them needs a deliberate state design rather than moving code.
- Per-provider branching in `providers/providers.ts` and `providers/providerBinaries.ts` could become a descriptor per provider. Its install, login and update flows are only exercised by live providers, so change it with live validation.
