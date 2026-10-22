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
| `apps/mobile` | Expo companion app that pairs with a server over the network. Built from source; there are no store or TestFlight builds yet. |
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

## Hosts and windows

The desktop has one shell renderer for every paired host. `HostSelectionProvider` selects a host and destination; `WorkspaceProvider` lazily mounts a `HostWorkspace` store for each requested connected host. Sidebar rows read those live stores, and `useWorkspace()` refers to the store on screen. Main retains connection lifecycle and delivers host-tagged events to the shell. `workspace/hostEvents.ts` routes them to host listeners and coalesces hidden-store work fairly; terminal output has bounded cursor-aware buffers.

`invokeOn(host, method, ...args)` in `apps/web/src/ipc.ts` routes explicit host calls through `hostInvoke.ts` (known, connected host; server-only allow-list). Native menus, dialogs, clipboard and device lifecycle operations stay local. Queries use `['ipc', hostId, method, ...]`; content state lives under `host:<hostId>:`. `deviceState.ts` owns device-wide UI choices. Legacy remote storage partitions are imported once before the shell starts, without overwriting newer shell values, and then no remote renderer is retained. Notification clicks select their host and thread in the same shell. Remaining real-host measurements and migration acceptance are tracked in [the roadmap](ROADMAP.md#host-and-provider-acceptance).

### Integrated browser boundary

The execution server's browser broker resolves a runtime per turn: host-managed Chromium by default (prepared on first use), or one named local desktop event stream when the host runtime is turned off over the existing Unix-socket transport. An acknowledgement precedes readiness; replies require an opaque connection credential. Browser tool arguments cannot choose another thread, run or desktop. The backend/profile selection is frozen with the provider connection, obsolete connections are refused, and disconnect/run stop settles pending work without replaying mutations. Remote execution has no implicit bridge to the viewing desktop's localhost or website identities. The optional host runtime uses the same ownership, snapshot and transfer domain code through a Playwright factory with sandboxed persistent/Temporary contexts. Its authenticated viewer uses the existing paired-owner connection, like terminals, with tabs scoped to their thread; viewer-role devices cannot control it.

Electron owns sandboxed, context-isolated guest contents, the non-secret local profile catalog, persistent/Temporary partitions, native input and user-only sign-in windows. Fixed isolated-world scripts handle DOM observations and element actions. Private fixed CDP operations provide named keys, bounded network metadata and live website-dialog handling; there is no general-purpose evaluation or public debugging endpoint. Website data never enters host preferences. Profile administration locks all owned contexts and waits for their destruction before clearing site data; failed metadata/data writes retain a retry path. The web pane receives metadata and explicit user actions through named desktop APIs. See [browser behavior](UI.md#integrated-browser) and [remaining delivery](BROWSER-PLAN.md).

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
| `browser/` | Private local-desktop browser broker and scoped provider tools; no Electron imports. |
| `mcp/` | Host-owned Shared MCP management, policy, external gateway, SQLite metadata and isolated HTTP/stdio clients. Chats receive approved tools through a separate `ramu_external` server (`mcp/sessionTools.ts`). |
| `credentials/` | OS-backed host credential storage shared by integrations; only opaque references belong in ordinary storage. |
| `ipc/` | Dispatcher, handler groups, shared context, schemas. |

`index.ts` is the service entry point, `cli.ts` the CLI, `db.ts` the database, and `build.ts` the build fingerprint used to decide when a running service is stale.

Host preferences and model sets live in `userData/settings.json` through `settings/settingsStore.ts`; SQLite retains operational state and the legacy migration archive. Existing workspace preference readers delegate to this store. `workspace/projectConfig.ts` reads bounded repository configuration without executing commands or expanding permissions. See [Configuration files](CONFIGURATION.md).

### Shared MCP server boundary

`packages/shared/src/mcp.ts` defines non-secret connections and account-sharing grants. `mcp/policy.ts` binds grants to one execution host, stable connection and service-account IDs, provider-account IDs, project scope, configuration revision and catalog digest. Explicit account setup can share approvals bidirectionally; opting out or removing an account removes its shared access. Connection renames preserve identity; security-relevant definition changes invalidate grants. Production policy and outcome metadata use an atomically replaced SQLite `app_state` record through `SharedMcpStorage`; a failed save leaves live policy unchanged. An interrupted pending call becomes an unknown outcome on restart, and uncertain calls are retained when old settled history is pruned. Policy approval is not a runtime-readiness or authentication result.

`mcp/gateway.ts` owns one upstream session per thread and connection. External tools never enter the trusted Ramu `ToolRegistry`. Discovery filters the catalog through the same policy used before dispatch; restricted sessions are denied, and background sessions need an explicit external-access policy. Catalog pages, total size, tool arguments, output, concurrent operations and requests are bounded. Catalog changes invalidate approvals, including changes while a per-call approval is pending. Outcome recording precedes dispatch; transport failure records an unknown outcome without replaying the operation. The host manager persists these records and binds credentials to the selected service account. `mcp/sessionTools.ts` serves each chat's approved tools on `/mcp/external` under the `ramu_external` server name, never `ramu`, so no permission mode that trusts Ramu's own tools trusts them. Names are `<server>-<hash of the connection ID>__<tool>` within Claude's 64-character limit. Every list and call goes through a gateway bound to that chat's provider login, project and role; sub-agents and review chats get none, and each call asks through the chat's existing permission card with the server, service account, login and arguments. Claude, Codex, OpenCode, Cursor and ACP runners add the server only when a connection applies to the provider and project. Upstream errors are replaced with setup/recovery messages rather than copied into diagnostics.

`mcp/stdio.ts` uses the installed MCP SDK's shell-free executable/argument spawning and platform environment allowlist. Local commands have the host user's filesystem/process access: this is not an OS sandbox and must be disclosed before explicit connection setup. Stderr is discarded, and Ramu/provider credentials and unrelated environment variables are not automatically inherited. Environment-secret references require an injected host-owned secret reader; missing or locked storage fails before execution. There is no plaintext fallback. `mcp/http.ts` uses Streamable HTTP with a separate TLS pool per upstream session, exact-origin requests, no automatic redirects, bounded bodies, and vetted DNS answers used directly by the socket. Private/reserved addresses are denied unless the host administrator explicitly enables private-network access on that definition; TLS certificate validation remains enabled. Reconnect never automatically repeats a tool invocation.

Settings → Agent setup → MCP servers provides host-scoped status, search, remote definitions, project/provider selection, explicit Connect/Check and catalog review, enable/disable, edit, disconnect and removal. Saving never starts a command or opens a connection. Administration is enforced on the execution server: paired clients can read status but cannot mutate connections, run checks or provision credentials. Management checks use isolated sessions, close after five idle minutes, and reject late responses after an edit/disconnect. Catalog review permits selection of tools; calls currently retain per-call approval rather than trusting upstream read-only hints. A connection check is not provider-runtime readiness. The editor covers remote servers and local commands (executable, one argument per line, working folder, private-network approval, service-account label). Header and environment credentials are write-only (`mcp.setCredential`, `mcp.removeCredential`): the value goes to the host credential store under a fresh reference, the old entry is deleted only after the new definition is saved, a locked store leaves the working credential in place, and changing the service account deletes the old account's entries. Replacing a credential changes the configuration revision, so approvals are reviewed again. Remote servers sign in with OAuth (`mcp/oauth.ts`): the MCP SDK's authorization flow (protected-resource and authorization-server discovery, resource binding, dynamic registration of a public PKCE client, `state`) runs on the host, and the sign-in page opens on the host's own window only, because the callback is a loopback listener that exists for one transaction (ten minutes at most), accepts a single callback with the matching `state`, and refuses it if the connection's revision or service account changed or the sign-in was cancelled. Tokens and the registered client live in one host credential entry referenced as `mcp-oauth`; refresh rewrites that entry in place so approvals are not invalidated, and an expired or revoked login surfaces as Sign-in required. Requests to the authorization server go through the same vetted-address fetch, with no MCP headers carried to another origin. Native discovery/import and provider availability remain in the [Shared MCP plan](MCP-MANAGEMENT-PLAN.md).

`credentials/store.ts` uses [`@napi-rs/keyring`](https://github.com/Brooooooklyn/keyring-node) through asynchronous native APIs, without Electron imports or secret process arguments. Entries are bound to host, integration, connection, account and opaque reference. Linux explicitly requires Secret Service instead of silently falling back to a kernel keyring. Verification performs a write/read/delete round trip; locked or unavailable storage fails with a sanitized error. Replacement writes a fresh reference and preserves the old entry until its caller validates and publishes the replacement. Headless hosts need an unlocked OS credential service in the execution user's session; no secret provisioning is available merely because a paired client can open Settings. Disconnect/removal revokes grants and deletes only Ramu-owned referenced credentials; failed deletion retains the definition for retry and never logs out a CLI.

Focused tests use real SQLite reopenings, SDK in-memory client/server pairs, a child-process stdio fixture, DNS/HTTP transport tests and Settings rendering. Opt-in acceptance on 2026-10-19 verified native credential write/read/delete on this Mac and the production HTTP gateway against the public [DeepWiki endpoint](https://docs.devin.ai/work-with-devin/deepwiki-mcp), reading a public repository for two configured provider principals. This does not establish paid/live provider-thread injection, OAuth/Atlassian support, packaged native storage or Linux/Windows/headless acceptance.

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

`pnpm check` also runs ESLint (`eslint.config.mjs`: typescript-eslint and the classic React hooks rules) and [knip](https://knip.dev) (`knip.json`) to catch unused files, exports and dependencies. Desktop lists runtime packages (for example the provider SDKs) that its bundled service loads, so `knip.json` ignores them on purpose.

## Known follow-ups

- Warnings remain for `react-hooks/exhaustive-deps` and `@typescript-eslint/no-explicit-any`; they are not errors yet.
- Provider install, login and update flows are only exercised by live providers; validate changes there against real CLIs.
