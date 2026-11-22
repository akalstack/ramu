# Architecture

Ramu is a pnpm workspace. The desktop app is a thin Electron shell around a workspace **server** that owns every agent, terminal, Git operation and database. The same server runs headless (see [headless server](../guide/remote-hosts.md)).

```
apps/web (React UI) ──► apps/desktop (Electron main + preload) ──► @ramu/client-runtime ──► apps/server
                                                                   (Unix socket, or WebSocket + bearer token)
```

The UI never touches the filesystem, Git or providers directly. It calls named methods and the server runs them.

In product copy, a conversation and its work is a **thread**. A **task** is one agent job, including delegated or scheduled work, and **chat** is messaging an agent. In code, `Task` types, `tasks.*` methods, `chat` routes and storage keys use those names.

## Packages

| Package | Role |
| --- | --- |
| `apps/server` | Workspace service and `ramu` CLI. Agents, providers, files, Git, terminals, schedules, SQLite. Must not import Electron or `apps/desktop`. |
| `apps/desktop` | Electron windows, menus, native dialogs, the preload bridge, update checks, packaging. Reaches the server through `@ramu/client-runtime`. |
| `apps/web` | React workspace UI and Monaco editor, rendered in the desktop app. |
| `apps/mobile` | Expo phone app that pairs with a server over the network. On Google Play and the App Store, or built from source ([README](../../apps/mobile/README.md)). |
| `apps/site` | Project website (getramu.dev): static Astro pages, with React islands for the hero demo and backdrop, and shadcn/ui components. |
| `packages/shared` | Domain types, the API method table, and pure helpers used by every app, some grouped into folders such as `chat/`, `review/`, `search/`, `workspace/` and `providers/` (import as `@ramu/shared/<module>` or `@ramu/shared/<folder>/<module>`). |
| `packages/contracts` | Wire protocol: versions, capabilities, request encoding. |
| `packages/client-runtime` | Node client for a server: Unix socket or authenticated WebSocket, reconnects, limits. |
| `scripts/smoke/` | The desktop startup smoke test and the Linux `.deb` smoke test. |
| `scripts/release/` | Packaging and release tooling. |

The optional Ramu account (sign-in, settings backups sealed on the device, and Your hosts) is served at `account.akalstack.com` by the Akalstack account service, which lives in its own repository and is shared with other Akalstack apps. Ramu's clients reach it through the shapes in `packages/shared/src/account.ts`.

## Calling the server

Every call is a method in the table in `packages/shared/src/api.ts`, for example `'providers.signIn'(provider, accountId?)`.

1. **Declare** the method and its types in `packages/shared/src/api.ts` (types live in `packages/shared/src/types/` by domain).
2. **Implement** it in a handler group under `apps/server/src/ipc/handlers/` (`agent`, `git`, `files`, `reviews`, `terminals`, `memory`, `settings`, `providers`, and so on). Handlers receive a shared `HandlerContext` (`ipc/types.ts`) instead of reaching for globals.
3. **Register:** `ipc/registry.ts` merges the groups. A duplicate method name throws at startup.
4. **Dispatch:** `ipc/dispatcher.ts` validates input, runs the handler, and notifies the workspace of changes.
5. **Call it** from the UI through `apps/web/src/ipc.ts`.
6. **Results are checked.** `packages/shared/src/rpcResults.generated.ts` holds the shape of every method's declared result, made from `RamuMethods` by `pnpm --filter @ramu/shared rpc-results`. Run it after changing a result type (a test fails until you do). Every client checks a host's answer against it in `RuntimeSocket.invoke`, so a host that answers in a shape the app does not know fails with the method and the field named. Extra fields a newer host adds pass. Under tests the dispatcher checks every handler's answer the same way. A test whose stub returns partial objects sets `RAMU_RESULT_CHECKS=0`.

Use the keyed locks in `ipc/helpers.ts` (`lockSession`, `gitExclusive`, `lockCheckouts`) when a handler must not interleave with another on the same thread or repository.

## Transport

A paired remote host is reached over one authenticated WebSocket per host (`RuntimeSocket`, pooled in `hostSocket.ts` for the Node client and `socketTransport.ts` on the phone). It carries every call and every event. There is no HTTP/SSE path. The local service speaks the same socket over its Unix socket. HTTP remains only for pairing, token renewal, health and `GET /session`, which happen before a socket can authenticate.

- **Reconnect:** bounded, jittered backoff. After three failed attempts an `events`-mode host waits for an announcement or wake. A `periodic` host checks every five minutes. A network loss suspends the socket. A network change or wake reconnects at once. The phone rehydrates whenever its stream ends.
- **Errors:** a refused socket is reported as such ("Pairing was revoked"). A socket that never connects is probed once over HTTP so a blocked WebSocket is named.
- **Subscriptions:** clients subscribe by channel and resource (`hostSubscription.ts` on the phone). Agent events stream in full only for the thread on screen. State, questions, permission requests, queue and goal events still arrive for all threads.
- **Recovery:** `agent.changes(sessionId, cursor, knownLastSeq)` resumes a transcript from a per-row revision counter, with a full snapshot for no cursor, a future cursor, a rewind or more than 2000 changes. `TerminalService.snapshot(id, since)` fetches only the missed terminal gap.
- **Flow control:** terminal flow control is opt-in per subscription. A client with `flow: true` acknowledges each `term:data` chunk. The host holds output past a 1,000,000-character unacknowledged window and sends `term:behind` once the client catches up so it fetches the gap. The phone enables it.
- **New threads:** `thread.start` creates, sets up a worktree if needed, and starts in one operation-keyed call. A failure after the thread exists returns the thread so it is kept and retried.

A warm HTTP call and a socket call cost the same. The socket's benefit is one connection and one authenticated channel per host for calls and events, not speed.

Frames over 4 KB are deflated for clients that negotiate it, except on the local Unix socket. Streamed tokens are sent as they are.

Clients keep each transcript with its `agent.changes` cursor and read only what changed: the desktop for its 24 most recent threads, the phone for every thread it holds. Opening a thread on another host applies at once when that host's store holds it, and the lists refresh behind it. Only a thread the store has not seen waits for a read. Each task pane mounts the first time it is shown.

A thread without held rows shows `agent.tail` (its last turns, bounded in rows and bytes) while the full read completes behind it. On the phone a thread nobody has open stops at the tail. The desktop and the phone both ask a host for the streaming event kinds only for the threads on screen, and everything else arrives in brief.

A follow-up waits for the review capture alone. That capture also starts the next run's snapshot, and the comparison and line stats finish after the message is sent.

## Discovery and protocol

- **Discovery:** a discoverable host advertises its name, a random identifier, protocol version and port over mDNS (`_ramu._tcp`), nothing else. Finding a host grants nothing. The desktop also gives hosts a UDP port for short signed "reconnect" announcements when their network changes.
- **Protocol:** `packages/contracts` defines the wire format. `GET /socket` upgrades to the one WebSocket for calls and events, authenticated by the `Authorization` header. Frames: `invoke` (with an optional `operationKey` so a retried mutation runs once), `subscribe`, `ack` and `ping`. The host answers `ready`, `result`, `error` and `event`. HTTP stays for `POST /pair`, `POST /renew`, `GET /health` and `GET /session`.
- **Limits:** the desktop starts at most eight handshakes and runs sixteen remote calls at once, keeps up to four remote views warm, and releases idle hidden views after ten minutes unless they hold unsaved work.

## Hosts and windows

The desktop has one shell renderer for every paired host. `HostSelectionProvider` selects a host and destination. `WorkspaceProvider` lazily mounts a `HostWorkspace` store per connected host. Sidebar rows read those stores, and `useWorkspace()` returns the store on screen. The main process owns connection lifecycle and delivers host-tagged events; `workspace/hostEvents.ts` routes them to listeners and coalesces work for hidden stores. Terminal output uses bounded, cursor-aware buffers.

`invokeOn(host, method, ...args)` in `apps/web/src/ipc.ts` routes explicit host calls through `apps/desktop/src/main/hostInvoke.ts` (known, connected host, server-only allowlist). Native menus, dialogs, the clipboard and device lifecycle stay local. Query keys are `['ipc', hostId, method, ...]`. Content state lives under `host:<hostId>:`. `apps/desktop/src/main/deviceState.ts` owns device-wide UI choices.

### Integrated browser

The server's browser broker resolves a runtime per turn: the attached local desktop's browser over its event stream when one is ready and the engine is Automatic, otherwise host-managed Chromium (prepared on first use; Stop browser in Settings closes it until the next tab).

- **Isolation:** tool arguments cannot choose another thread, run or desktop. The backend and profile are frozen with the provider connection. A disconnect or run stop settles pending work without replaying a mutation. Remote execution has no implicit bridge to the viewing desktop's localhost or sign-ins.
- **Viewing:** paired owner devices view the host browser through the existing host connection, like terminals. A private CDP compositor feed keeps only the newest bounded JPEG per tab, shared across viewers. No CDP endpoint or page JavaScript authority reaches clients, and viewer-role devices cannot control it.
- **Desktop browser:** Electron owns sandboxed, context-isolated guest contents, the non-secret profile catalog, partitions, native input and sign-in windows. Fixed isolated-world scripts read the DOM and act on elements. There is no general evaluation or debugging endpoint. Website data never enters host preferences.

User-facing behavior is in the [browser guide](../guide/browser-and-computer.md#browser).

## Server layout (`apps/server/src`)

| Folder | Contents |
| --- | --- |
| `agent/` | Thread lifecycle, one collaborator per concern: session store and registry, recorder, message dispatcher, goals, provider wait, user requests (questions, permissions, elicitation), fallback router, advisor, sub-agents, stream pump, restart recovery. Each owns its state and sees the rest through a narrow `*Host` interface. `agent.ts` is the thin `AgentService` façade that wires them together. |
| `providers/` | Provider plumbing and the `ProviderAdapter` interface (`adapter.ts`) with one adapter per provider in `adapters/`: binary lookup, account environment, sign-in checks, login arguments and update plans. Also usage and usage-limit detection and `fakeAgent.ts` for simulated runs. |
| `workspace/` | Repositories, files, Git, isolation checkouts, terminals (PTY), editorconfig, discard previews, forge adapters in `forge/`, and the platform-agnostic deploy loop in `deploy/` ([Forges and platforms](#forges-and-platforms)). |
| `review/` | Recorded diffs, review state and stats, undo and restore with conflict checks. |
| `memory/` | Shared memory notes, memory files, learning, recaps. |
| `remote/` | Pairing, devices, network listener and socket, presence announcements, mobile push, host folder browsing. |
| `background/` | Schedules, activity, keep-awake, app update checks, notices, Resources, and threads started by agents, people and terminals. |
| `browser/` | Host browser broker and scoped provider tools; no Electron imports. |
| `computer/` | Computer-use sessions and control leases. |
| `testDevice/` | iOS Simulators and Android emulators as computer-use backends, with their lifecycle and agent tools. |
| `interactive/` | Agent-generated interactive documents: compile, bundle, store. |
| `mcp/` | Shared MCP: management, policy, external gateway, SQLite metadata, isolated HTTP/stdio clients. |
| `credentials/` | OS-backed credential storage shared by integrations; only opaque references go in ordinary storage. |
| `settings/` | Host preferences and model sets. |
| `identities/` | Identities and which one each project acts as. |
| `rules/` | User-written rules and their delivery to providers. |
| `plugins/` | Plugin install, review and `platform_cli` ([Forges and platforms](#forges-and-platforms)). |
| `media/` | Media accounts for abilities (Google Gemini, ElevenLabs) on the person's own API key. |
| `hosting/` | GitHub Pages publishing for artifacts. |
| `account/` | This host's side of the optional Ramu account: sign-in, sealed backups, Your hosts. |
| `ipc/` | Dispatcher, handler groups, shared context, schemas. |

`index.ts` is the service entry point, `cli.ts` the CLI, `db.ts` the database, and `build.ts` the build fingerprint that detects a stale running service.

Host preferences and model sets live in `userData/settings.json` through `settings/settingsStore.ts`. SQLite keeps operational state. `workspace/projectConfig.ts` reads bounded repository configuration without executing commands or widening permissions. See [Configuration files](../guide/configuration.md). The schema is one script in `db.ts`, stamped with a version. A new profile runs it, an existing one upgrades in place through `MIGRATIONS`, and a profile from a newer build is refused untouched ([Compatibility](code-style.md#compatibility)).

### Shared MCP

`packages/shared/src/mcp.ts` defines non-secret connections and account-sharing grants. `mcp/policy.ts` binds a grant to one host, connection, service account, provider accounts, project scope, configuration revision and catalog digest. Security-relevant changes invalidate grants. Policy approval is not a readiness or authentication result.

`mcp/gateway.ts` owns one upstream session per thread and connection. External tools never enter Ramu's trusted `ToolRegistry`. `mcp/sessionTools.ts` serves each chat's approved tools on `/mcp/external` under the `shared_mcp` server name, so no permission mode that trusts Ramu's own tools trusts them. Every call goes through a gateway bound to the chat's login, project and role, asks through the thread's permission card, and records its outcome before dispatch. A transport failure records an unknown outcome and is never replayed. An upstream that closes is reconnected on the next call; a chat's gateways close when it stops, fails or is deleted, and an earlier one closes as soon as the chat switches login, provider or project, so no local server outlives its use (idle ones close after ten minutes). Sub-agents and review chats get no external tools. Catalog size, arguments, output and concurrency are bounded.

- **Transports:** `mcp/stdio.ts` spawns without a shell, with an environment allowlist and discarded stderr. Local commands run with the host user's access. This is not a sandbox and is disclosed before setup. `mcp/http.ts` uses Streamable HTTP with exact-origin requests, no automatic redirects, bounded bodies and vetted DNS answers. Private and reserved addresses are denied unless an administrator enables them for that definition.
- **Credentials:** header and environment secrets are write-only (`mcp.setCredential`, `mcp.removeCredential`), stored in the host credential store under a fresh reference, and never copied into diagnostics. Replacing one changes the revision, so approvals are reviewed again.
- **OAuth:** `mcp/oauth.ts` runs the MCP SDK authorization flow on the host with a one-transaction loopback callback (single use, matching `state`, ten minutes at most). Tokens live in one credential entry. An expired login shows as Sign-in required.
- **Administration** is enforced on the server: paired clients can read status but not change connections, run checks or set credentials. Settings → Agent setup → MCP servers is the UI.

`credentials/store.ts` uses [`@napi-rs/keyring`](https://github.com/Brooooooklyn/keyring-node) without Electron imports. Entries are bound to host, integration, connection, account and reference. Linux requires Secret Service rather than falling back to a kernel keyring. Locked or unavailable storage fails with a sanitized error. Headless hosts need an unlocked OS credential service in the execution user's session. Removing a connection deletes only Ramu-owned credentials and never logs out a CLI.

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
| `inbox/` | The Inbox page (Brief, Running with Resources, Recaps, Learned, Completed), recap actions, and the cross-host Inbox. |
| `liveView/` | Float: the live view card and the window above other apps. |
| `summaries/` | The "What Ramu learned" card, host and notice. |
| `palette/` | The command palette and its sources (see [UI development](ui.md#command-palette)). |
| `editor/` | Monaco setup and editor buffers. |
| `lib/` | Small framework-free helpers and hooks. |
| `components/` | Shared UI primitives (`components/ui` is shadcn-based). |

## Providers

Threads run through provider adapters selected per thread (`AgentSettings.provider`). Provider-specific setup behavior (executable and `RAMU_*_BIN` variable, account profiles, sign-in detection, login and update) is a `ProviderAdapter` in `apps/server/src/providers/adapters/`. `providers.ts` and `providerBinaries.ts` keep the shared spawning, caching and parsing. To add a provider, add an adapter, register it in `adapters/index.ts`, and add its id to `AgentProvider` in `packages/shared`. How it chats is an `AgentRunner` (`agent/agentRunner.ts`) listed in `providers/runners.ts`; use the provider's own SDK where it has one, or `createAcpRunner` for an ACP runtime. Features the provider has natively (`NativeFeatures` on the adapter) replace Ramu's own where they can serve Ramu's flow. An adapter may also define `skillsLaunch`, which points the provider at Ramu's per-scope managed-skill export for one thread (a Claude plugin, a Codex skill root, an OpenCode `skills` entry, or `linkDirs` for Cursor and Antigravity, which scan a fixed folder in the thread's working directory and get git-excluded symlinks from `memory/skillLinks.ts`; see [learning](../guide/memory-and-learning.md)). `providers/fakeAgent.ts` implements the same events, permission requests and transcript paths without model usage; the desktop smoke test uses it.

Logins: a provider's login belongs to its own runtime. Ramu reaches a provider only through that runtime or its documented protocol (Claude Agent SDK, `codex app-server`, `opencode serve`, Cursor and Antigravity ACP). It never reads a provider's token file to call the provider's private services, and never presents its own calls as the provider's app. Plan usage comes only from the runtime: Claude and Codex report it, and for OpenCode, Cursor and Antigravity Ramu learns a limit from the runtime's limit notice (`usageOnlyAtLimit` in `packages/shared/src/usage/presentation.ts`). `apps/server/test/providerBoundary.test.ts` fails on code that borrows a login. Ramu's own OAuth clients (MCP servers, plugins) are not provider logins.

Accounts: when a thread reaches a usage limit, it moves on only to an enabled login of the same provider that runs on an API key (provider terms bar working around a subscription's limits), then to the next model in the fallback order. A person can still pick any login themselves. Turn an account off in Settings to remove it from the rotation.

Background commands: Ramu's own `background_terminal_launch` tools give every provider host-owned commands that outlive a turn, with output, waits and **Stop**. A provider's native background shell has its own owner and lifetime, and `NativeFeatures.terminals` stays off for a provider that runs commands in its own shell even when the client offers ACP terminals.

## Forges and platforms

Outside services stay out of callers, IPC and the UI. They live on the server, take their tokens from `credentials/`, and report in shared types so the desktop and the phone never depend on one service's API.

- **Forges** (GitHub, GitLab, Bitbucket, Azure DevOps): `ForgeAdapter` in `workspace/forge/adapter.ts`, one file per forge, registered with `registerForgeAdapter`. Repositories, pull requests, issues, checks and reviews go through it. `commitChecks` reads the checks on one commit, which is also where hosting platforms connected to a repository report their deploys, so the Live app sheet's latest deploy (`workspace/deploy/gitHostStatus.ts`) and the push follow in `background/pullRequestWatches.ts` work for any platform without platform code.
- **Plugins** (`apps/server/src/plugins`): a plugin folder is read by `folder.ts` against the manifest schema in `packages/shared/src/plugins.ts`, fetched at a pinned commit and signature-checked by `source.ts`, and installed by `service.ts` into the services each part already belongs to (installed skills, Shared MCP, custom agents, rules), tagged so removal takes them together. Credentials are `SavedCredential`s in the host store. `cli.ts` registers `platform_cli` for every plugin CLI, and `service.query` serves dashboard data sources. Every hosting platform and data source is a plugin, not Ramu code: the platform's own in Claude's directory, or one in `akalstack/ramu-plugins` where Claude's directory has none (Fly.io, Grafana, Amplitude, Salesforce); `DEPLOY_TARGET_PLUGINS` in `packages/shared/src/plugins.ts` names the plugin for each stack's platform.
- **Production deploys** are recognised from the action by `packages/shared/src/deployActions.ts` (a shell command, a CLI's arguments or an MCP tool call), and every path applies the same rule through `UserRequests`: `sessionRecorder.ts` marks a provider's permission request for a production deploy (no saved rule, at most Allow in this thread), `alwaysAsks` in `agent/dangerousCommands.ts` makes providers that would run a command on their own ask, the Shared MCP gateway asks even for a tool set to Allow, and `platform_cli` asks through `approveProductionDeploy`. Each runs the project's migrations before the deploy goes out.
- **Deploy loop** (`workspace/deploy/`): what stays platform-agnostic. `migrations.ts` keeps each project's production database address and runs the `migrate` command before every production deploy. `uptime.ts` checks the live address and opens incident threads through `wake.ts`; `localApp.ts` and `namedTunnel.ts` publish an app from this computer.

### Adding a platform

Use the platform's own plugin in Claude's directory when there is one. Otherwise add a plugin with a CLI in `akalstack/ramu-plugins`: its credential and the CLI's read-only prefixes ([Plugins](../guide/plugins.md)). Teach `packages/shared/src/deployActions.ts` the CLI's preview and production commands. Then add the platform to [Deploying an app](../guide/deploy.md), and say in the pull request which live deploys you ran.

## Testing

- `pnpm check`: format, lint, knip, typecheck, unit tests, release-script tests, build. CI runs it on macOS and Linux. While working, run only the scoped checks for the package you touched (`pnpm --filter @ramu/web test`, `typecheck`, and so on).
- `pnpm test:desktop-smoke`: one desktop startup check with simulated providers and an isolated profile. Run after `pnpm build` on macOS, or under `xvfb-run` on Linux. CI and release builds also run it against the packaged macOS app and the installed Linux `.deb` ([Packaging](packaging.md#test-a-packaged-build)).
- Server tests are in `apps/server/test`, mirroring `src` by file name.

## Code quality

`pnpm check` runs Prettier, ESLint (`eslint.config.mjs`: typescript-eslint and the React hooks rules) and [knip](https://knip.dev) (`knip.json`) for unused files, exports and dependencies. `knip.json` ignores runtime packages that bundled code loads by name (provider SDKs, interactive-content libraries). Conventions are in [Code conventions](code-style.md).

Provider install, login and update flows run only against live providers. Validate changes there with the real CLIs.
