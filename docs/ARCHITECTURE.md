# Architecture

Ramu is a pnpm workspace. The desktop app is a thin Electron shell around a workspace **server** that owns every agent, terminal, Git operation, and database. The same server runs headless; see [headless server](HEADLESS-SERVER.md).

```
apps/web (React UI) ──► apps/desktop (Electron main + preload) ──► @ramu/client-runtime ──► apps/server
                                                                   (Unix socket, or WebSocket + bearer token)
```

The UI never touches the filesystem, Git, or providers directly. It calls named methods; the server executes them.

Call an ongoing conversation and its work a **thread** in product copy. A **task** is a specific agent job, including delegated or scheduled work; **chat** is the act of messaging an agent. Internal `Task` types, `tasks.*` methods, `chat` routes and storage keys retain their existing names for compatibility.

## Packages

| Package | Role |
| --- | --- |
| `apps/server` | Workspace service and `ramu` CLI. Agents, providers, files, Git, terminals, schedules, SQLite. Must not import Electron or `apps/desktop`. |
| `apps/desktop` | Electron windows, menus, native dialogs, the preload bridge, update checks, packaging. Reaches the server through `@ramu/client-runtime`. |
| `apps/web` | React workspace UI and Monaco editor, rendered in the desktop app. |
| `apps/mobile` | Expo companion app that pairs with a server over the network. Built from source; there are no store or TestFlight builds yet. |
| `apps/site` | Project website. |
| `packages/shared` | Domain types, the API method table, and pure helpers used by every app, grouped into `chat/`, `review/`, `search/`, `workspace/` and `providers/` (import as `@ramu/shared/<folder>/<module>`). |
| `packages/contracts` | Wire protocol: versions, capabilities, request encoding. |
| `packages/client-runtime` | Node client for a server: Unix socket or authenticated WebSocket, reconnects, limits. |
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

## Transport

A paired remote host is reached over one authenticated WebSocket per host (`RuntimeSocket`, pooled in `hostSocket.ts` for the Node client and `socketTransport.ts` on the phone). It carries every call and every event; there is no HTTP/SSE path. The local service speaks the same socket over its Unix socket. HTTP remains only for pairing, token renewal, health and `GET /session`, which happen before a socket can authenticate.

- **Reconnect:** bounded, jittered backoff. After three failed attempts an `events`-mode host waits for an announcement or wake; a `periodic` host checks every five minutes. A network loss suspends the socket; a network change or wake reconnects at once. The phone rehydrates whenever its stream ends.
- **Errors:** a refused socket is reported as such ("Pairing was revoked"). A socket that never connects is probed once over HTTP so a blocked WebSocket is named.
- **Subscriptions:** clients subscribe by channel and resource (`hostSubscription.ts` on the phone). Agent events stream in full only for the thread on screen; state, questions, permission requests, queue and goal events still arrive for all threads.
- **Recovery:** `agent.changes(sessionId, cursor, knownLastSeq)` resumes a transcript from a per-row revision counter, with a full snapshot for no cursor, a future cursor, a rewind or more than 2000 changes. `TerminalService.snapshot(id, since)` fetches only the missed terminal gap.
- **Flow control:** terminal flow control is opt-in per subscription. A client with `flow: true` acknowledges each `term:data` chunk; the host holds output past a 1,000,000-character unacknowledged window and sends `term:behind` once the client catches up so it fetches the gap. The phone enables it.
- **New threads:** `thread.start` creates, sets up a worktree if needed, and starts in one operation-keyed call. A failure after the thread exists returns the thread so it is kept and retried.

A warm HTTP call and a socket call cost the same; the socket's benefit is one connection and one authenticated channel per host for calls and events, not speed.

Frames over 4 KB are deflated for clients that negotiate it, except on the local Unix socket; streamed tokens are sent as they are.

Clients keep each transcript with its `agent.changes` cursor and read only what changed: the desktop for its 24 most recent threads, the phone for every thread it holds. Opening a thread on another host applies at once when that host's store holds it, and the lists refresh behind it; only a thread the store has not seen waits for a read. Each task pane mounts the first time it is shown.

A thread without held rows shows `agent.tail` (its last turns, bounded in rows and bytes) while the full read completes behind it; on the phone a thread nobody has open stops at the tail. The desktop and the phone both ask a host for the streaming event kinds only for the threads on screen, and everything else arrives in brief.

A follow-up waits for the review capture alone. That capture also starts the next run's snapshot, and the comparison and line stats finish after the message is sent.

## Hosts and windows

The desktop has one shell renderer for every paired host. `HostSelectionProvider` selects a host and destination; `WorkspaceProvider` lazily mounts a `HostWorkspace` store per connected host. Sidebar rows read those stores, and `useWorkspace()` returns the store on screen. The main process owns connection lifecycle and delivers host-tagged events; `workspace/hostEvents.ts` routes them to listeners and coalesces work for hidden stores. Terminal output uses bounded, cursor-aware buffers.

`invokeOn(host, method, ...args)` in `apps/web/src/ipc.ts` routes explicit host calls through `hostInvoke.ts` (known, connected host; server-only allowlist). Native menus, dialogs, the clipboard and device lifecycle stay local. Query keys are `['ipc', hostId, method, ...]`; content state lives under `host:<hostId>:`. `deviceState.ts` owns device-wide UI choices.

### Integrated browser

The server's browser broker resolves a runtime per turn: the attached local desktop's browser over its event stream when one is ready and the engine is Automatic, otherwise host-managed Chromium (prepared on first use). Turning the host browser off always uses the desktop.

- **Isolation:** tool arguments cannot choose another thread, run or desktop. The backend and profile are frozen with the provider connection; a disconnect or run stop settles pending work without replaying a mutation. Remote execution has no implicit bridge to the viewing desktop's localhost or sign-ins.
- **Viewing:** paired owner devices view the host browser through the existing host connection, like terminals. A private CDP compositor feed keeps only the newest bounded JPEG per tab, shared across viewers. No CDP endpoint or page JavaScript authority reaches clients, and viewer-role devices cannot control it.
- **Desktop browser:** Electron owns sandboxed, context-isolated guest contents, the non-secret profile catalog, partitions, native input and sign-in windows. Fixed isolated-world scripts read the DOM and act on elements; there is no general evaluation or debugging endpoint. Website data never enters host preferences.

User-facing behavior is in [UI](UI.md#integrated-browser).

## Server layout (`apps/server/src`)

| Folder | Contents |
| --- | --- |
| `agent/` | Thread lifecycle, one collaborator per concern: session store and registry, recorder, message dispatcher, goals, provider wait, user requests (questions, permissions, elicitation), fallback router, advisor, sub-agents, stream pump, restart recovery. Each owns its state and sees the rest through a narrow `*Host` interface. `agent.ts` is the thin `AgentService` façade that wires them together. |
| `providers/` | Provider plumbing and the `ProviderAdapter` interface (`adapter.ts`) with one adapter per provider in `adapters/`: binary lookup, account environment, sign-in checks, login arguments and update plans. Also usage and usage-limit detection and `fakeAgent.ts` for simulated runs. |
| `workspace/` | Repositories, files, Git, isolation checkouts, terminals (PTY), editorconfig, discard previews, forge (GitHub) adapters. |
| `review/` | Recorded diffs, review state and stats, undo and restore with conflict checks. |
| `memory/` | Shared memory notes, memory files, learning, recaps. |
| `remote/` | Pairing, devices, network listener and socket, presence announcements, mobile push, host folder browsing. |
| `background/` | Schedules, activity, keep-awake, app update checks, notices. |
| `browser/` | Host browser broker and scoped provider tools; no Electron imports. |
| `computer/` | Computer-use sessions and control leases. |
| `interactive/` | Agent-generated interactive documents: compile, bundle, store. |
| `mcp/` | Shared MCP: management, policy, external gateway, SQLite metadata, isolated HTTP/stdio clients. |
| `credentials/` | OS-backed credential storage shared by integrations; only opaque references go in ordinary storage. |
| `settings/` | Host preferences and model sets. |
| `ipc/` | Dispatcher, handler groups, shared context, schemas. |

`index.ts` is the service entry point, `cli.ts` the CLI, `db.ts` the database, and `build.ts` the build fingerprint that detects a stale running service.

Host preferences and model sets live in `userData/settings.json` through `settings/settingsStore.ts`; SQLite keeps operational state. `workspace/projectConfig.ts` reads bounded repository configuration without executing commands or widening permissions. See [Configuration files](CONFIGURATION.md). The schema is one script in `db.ts`, stamped with a version; a new profile runs it, and a profile at another version is refused untouched.

### Shared MCP

`packages/shared/src/mcp.ts` defines non-secret connections and account-sharing grants. `mcp/policy.ts` binds a grant to one host, connection, service account, provider accounts, project scope, configuration revision and catalog digest; security-relevant changes invalidate grants. Policy approval is not a readiness or authentication result.

`mcp/gateway.ts` owns one upstream session per thread and connection. External tools never enter Ramu's trusted `ToolRegistry`; `mcp/sessionTools.ts` serves each chat's approved tools on `/mcp/external` under the `shared_mcp` server name, so no permission mode that trusts Ramu's own tools trusts them. Every call goes through a gateway bound to the chat's login, project and role, asks through the thread's permission card, and records its outcome before dispatch. A transport failure records an unknown outcome and is never replayed. An upstream that closes is reconnected on the next call; a chat's gateways close when it stops, fails or is deleted, and an earlier one closes as soon as the chat switches login, provider or project, so no local server outlives its use (idle ones close after ten minutes). Sub-agents and review chats get no external tools. Catalog size, arguments, output and concurrency are bounded.

- **Transports:** `mcp/stdio.ts` spawns without a shell, with an environment allowlist and discarded stderr. Local commands run with the host user's access; this is not a sandbox and is disclosed before setup. `mcp/http.ts` uses Streamable HTTP with exact-origin requests, no automatic redirects, bounded bodies and vetted DNS answers; private and reserved addresses are denied unless an administrator enables them for that definition.
- **Credentials:** header and environment secrets are write-only (`mcp.setCredential`, `mcp.removeCredential`), stored in the host credential store under a fresh reference, and never copied into diagnostics. Replacing one changes the revision, so approvals are reviewed again.
- **OAuth:** `mcp/oauth.ts` runs the MCP SDK authorization flow on the host with a one-transaction loopback callback (single use, matching `state`, ten minutes at most). Tokens live in one credential entry; an expired login shows as Sign-in required.
- **Administration** is enforced on the server: paired clients can read status but not change connections, run checks or set credentials. Settings → Agent setup → MCP servers is the UI.

`credentials/store.ts` uses [`@napi-rs/keyring`](https://github.com/Brooooooklyn/keyring-node) without Electron imports. Entries are bound to host, integration, connection, account and reference. Linux requires Secret Service rather than falling back to a kernel keyring. Locked or unavailable storage fails with a sanitized error; headless hosts need an unlocked OS credential service in the execution user's session. Removing a connection deletes only Ramu-owned credentials and never logs out a CLI.

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
| `inbox/` | The Inbox page (Waiting, Running, Recaps, Learned, Completed), recap actions, and the cross-host Inbox. |
| `summaries/` | The "What Ramu learned" card, host and notice. |
| `palette/` | The command palette and its sources (see [UI development](UI.md#command-palette)). |
| `editor/` | Monaco setup and editor buffers. |
| `lib/` | Small framework-free helpers and hooks. |
| `components/` | Shared UI primitives (`components/ui` is shadcn-based). |

## Providers

Threads run through provider adapters selected per thread (`AgentSettings.provider`). Provider-specific setup behavior (executable and `RAMU_*_BIN` variable, account profiles, sign-in detection, login and update) is a `ProviderAdapter` in `apps/server/src/providers/adapters/`; `providers.ts` and `providerBinaries.ts` keep the shared spawning, caching and parsing. To add a provider, add an adapter, register it in `adapters/index.ts`, and add its id to `AgentProvider` in `packages/shared`. How it chats is an `AgentRunner` (`agent/agentRunner.ts`) listed in `providers/runners.ts`; use the provider's own SDK where it has one, or `createAcpRunner` for an ACP runtime. Features the provider has natively (`NativeFeatures` on the adapter) replace Ramu's own where they can serve Ramu's flow. An adapter may also define `skillsLaunch`, which points the provider at Ramu's per-scope managed-skill export for one thread (a Claude plugin, a Codex skill root, an OpenCode `skills` entry, or `linkDirs` for Cursor and Antigravity, which scan a fixed folder in the thread's working directory and get git-excluded symlinks from `memory/skillLinks.ts`; see [learning](LEARNING.md)). `providers/fakeAgent.ts` implements the same events, permission requests and transcript paths without model usage; the desktop smoke test uses it.

Accounts: every enabled account of a provider is tried in order (selected account, the default login, then the others) when a thread reaches a usage limit, before Ramu falls back to another model. Turn an account off in Settings to remove it from the rotation.

## Testing

- `pnpm check`: format, lint, knip, typecheck, unit tests, release-script tests, build. CI runs it on macOS and Linux. While working, run only the scoped checks for the package you touched (`pnpm --filter @ramu/web test`, `typecheck`, and so on).
- `pnpm test:desktop-smoke`: one desktop startup check with simulated providers and an isolated profile (macOS). Run after `pnpm build`; release checks also run it against the packaged macOS app.
- Server tests are in `apps/server/test`, mirroring `src` by file name.

## Code quality

`pnpm check` runs Prettier, ESLint (`eslint.config.mjs`: typescript-eslint and the React hooks rules) and [knip](https://knip.dev) (`knip.json`) for unused files, exports and dependencies. `knip.json` ignores runtime packages that bundled code loads by name (provider SDKs, interactive-content libraries). Conventions are in [Code conventions](CODE-STYLE.md).

Provider install, login and update flows run only against live providers; validate changes there with the real CLIs.
