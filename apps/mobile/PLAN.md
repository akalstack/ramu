# Ramu mobile implementation plan

Status: live companion implementation, replacing the UI scaffold. Pairing/QR, independent
connections, persisted drafts/outbox, live thread and input controls, host folders,
attachments, host usage, Git/reviews/undo, terminal recovery and opt-in Expo push
registration/delivery are implemented. See README.md for setup and validation.

Remaining release gates: physical iOS/Android acceptance, signed builds with owned
Expo project/APNs/FCM credentials, remaining advanced desktop input polish,
terminal gesture/custom-toolbar polish, and any explicitly granted remote network
administration. Relay remains deferred. This is not a claim that every beta gate
below has been met.
Platforms: iOS and Android.

## Product scope

Build a phone companion for an existing Ramu workspace server. Users can pair a
computer, follow agent work, send instructions, answer questions and permissions,
and inspect changes. Agents, providers, repositories, terminals, schedules and
the database continue running on the host computer. The host must be awake and
reachable directly over HTTPS or a trusted private network (LAN/VPN).

First release:

- Pair with a server address and the existing one-time code, or scan a QR offer.
- Save multiple computers and connect to all of them concurrently while the app
  is active. Show one computer's workspace at a time, with a switcher displaying
  each computer's connection status and running/waiting thread counts.
- Receive in-app notifications from every connected computer; opening one selects
  its computer and thread.
- Browse existing projects, tasks and threads, including standalone threads.
- Browse host folders, create projects/repositories, initialize or clone Git
  repositories and attach them to the selected computer's workspace.
- Use interactive host terminals with a customizable extra-key toolbar and
  useful touch gestures inspired by Termius.
- Read live conversations, expandable tool activity and agent status.
- Send messages; queue or steer where supported; interrupt or stop work.
- Answer permission requests, questions and elicitation forms.
- Include all supported desktop input interactions: commands, skills, prompts,
  context selection, attachments, provider/model/settings selection, queued and
  steering messages, editable drafts and pending-input forms.
- Start threads in existing projects or standalone scope using host providers.
- Show provider availability, usage windows, reset times and fallback/wait state
  separately for every computer, including explicit unavailable/stale readings.
- Administer host network access and paired devices, and create/edit/control
  schedules through commands, skills or prompts with real host-backed execution.
- View goals and pause/resume them.
- Read recorded reviews and diffs; send review comments back to the agent.
- Perform Git actions and recorded undo, including destructive operations, with
  previews, host/repository identification and existing conflict checks.
- Upload photos, camera captures and files to the selected host's thread.
- Receive background push notifications for every paired computer; tapping opens
  the correct workspace/thread and refreshes its current state.
- Keep composer drafts on the phone, scoped by computer and thread/project.
- Support English and Bahasa Indonesia, light/dark mode and accessibility.

Deferred: relay connections, a full native editor and dedicated mobile provider
installation/sign-in screens. Host provider setup can still be performed through
terminal or agent workflows where supported. All features above are in the planned
release scope, delivered in stages; background push remains a required milestone.
The first release requires direct host reachability and does not deploy a relay.

## Repository findings

- `apps/mobile` is new; `apps/*` is already included in the pnpm workspace.
- `apps/server` already exposes `POST /pair`, authenticated `POST /invoke`,
  `GET /events` (SSE) and unauthenticated `GET /health`.
- `packages/contracts` contains protocol versions, capabilities, pairing types,
  bearer authentication and argument encoding. Reuse it unchanged initially.
- `packages/shared/api` contains typed methods and push events. Its
  `RamuBridge.pathForFile` is desktop-specific; mobile should use only the
  invoke/event portion of that contract.
- `packages/client-runtime` imports Node HTTP, crypto, OS and path APIs. Do not
  import its current entry point into Metro.
- `apps/web` uses DOM, Electron bridges, Monaco and xterm. Reuse domain helpers
  after auditing their imports; build native screens rather than porting components.
- The workspace uses hoisted dependencies for Electron Forge. Preserve that
  setting. Mobile's React version must match its selected Expo SDK; the root
  React catalog must not force a version unsupported by React Native.
- Remote clients currently cannot use host dialogs or network/device administration.
  Folder browsing needs new remote-safe host APIs. Network administration needs
  explicit server authorization changes, not a client workaround for the local-only guard.
  Desktop-local `computers.*` methods also need a mobile-local equivalent.
- SSE currently has no resumable replay cursor. Reconnection must rehydrate
  persisted state rather than assume every event was delivered.

## Stack and boundaries

Use React Native with Expo, TypeScript and Expo Router. Use development builds
for real device validation. Select and pin a stable Expo SDK and its supported
React/React Native versions during bootstrap; verify Node 24 and pnpm 11 support
before changing dependencies. Keep SDK-specific React dependencies in mobile
if they differ from the desktop catalog, and verify Metro resolves one React copy.

Use TanStack Query for server snapshots, a small typed event subscription layer,
SecureStore for device tokens, and local persistent storage for computer metadata,
preferences and drafts. A connection manager owns one independent connection
per saved computer; selecting a computer only changes the visible workspace.
Cache keys, event routing, drafts and pending requests must include computer ID.
Switching keeps every computer's connection and subscriptions alive, and results
must update only their originating computer's state. Forgetting a computer cancels
its requests and subscriptions and removes its state.

Initial layout:

```text
apps/mobile/
  PLAN.md
  package.json
  app.config.ts
  tsconfig.json
  eas.json
  src/
    app/                 # Pairing, computers, projects, chats, terminals, Git, settings
    components/          # Transcript, composer, forms, diff rows and terminal controls
    features/            # Workspace, inputs, terminals, repositories, usage, automation
    runtime/             # Typed HTTP invoke, SSE and connection lifecycle
    storage/             # Credentials, preferences and device-local drafts
    theme/               # Tokens and native styling
  test/
```

Keep the first mobile transport in `apps/mobile/src/runtime`. Extract a shared
transport package only if another non-Node client needs it. No Electron, Node,
DOM or server implementation imports may enter the native mobile bundle. A terminal
renderer may use xterm inside a dedicated WebView if the spike demonstrates correct
input, rendering and accessibility; that isolated page must have a narrowly scoped
bridge, no credentials and no arbitrary navigation or remote script loading.

## Expanded feature design

### Terminal controls and gestures

Use the Ramu host PTY through typed terminal APIs, not a second SSH session. Provide
terminal tabs per computer/task, open/attach, resize, copy/select/paste, scrollback,
exit state, reconnect and explicit close. Switching workspaces must preserve PTYs.
Add host APIs for listing/reattaching terminals and bounded output recovery where
missing; `term:data` alone cannot recover output missed during suspension.

Provide a customizable toolbar above the keyboard with Esc, Tab, Ctrl, Alt,
arrows, Home/End, PgUp/PgDn, Ctrl+C, Ctrl+D, Ctrl+Z, paste and keyboard show/hide.
Modifier keys support a visible latch and reset predictably. Include external
keyboard shortcuts, IME/composition handling and multiline paste preview.

Termius's documented iOS terminal uses long-press-and-drag for arrows, double-tap
for Tab and pinch for font sizing. Adopt these as configurable Ramu gestures on
both platforms, validated independently on Android. Use a visible navigation/
selection mode toggle to resolve long-press conflicts; normal scrollback gestures
must not accidentally send keys. Toolbar buttons remain alternatives to gestures.
Support arrow repeat/history navigation and TUI mouse mode only with explicit
mode feedback. Test shell prompts, vim, less and tmux, including bracketed paste,
keyboard resizing and portrait/landscape changes.

### Repositories, provider usage and all input interactions

Add authenticated host folder enumeration, parent navigation, folder creation,
repository inspection and init/clone operations. Paths belong to the selected
host; never treat phone picker paths as host paths. Enforce configured browse roots,
symlink/path checks and OS permissions, and report inaccessible folders. Clone
reports progress/cancellation and uses host credentials without returning secrets.

Use `usage.get`, `usage.refresh`, `usage:changed` and provider status per computer.
Display source/freshness and reset windows; unsupported readings must not look
like zero usage. Keep provider/model catalogs and fallback state isolated by host.

Audit the desktop composer and every input-bearing event into a parity checklist
before implementation. Include command/skill discovery and invocation, text and
multiline paste, host file/context references, provider/model and supported agent
settings, draft restoration/editing, attachment removal/preview, queue controls,
steering, permission allow/deny with feedback, single/multiple-choice and free-text
questions, question drafts/dismissal, and elicitation submit/decline/cancel. Include
review comments/replies and supported helper-agent messaging. Derive availability
from provider/host capabilities; unsupported interactions get an explanation.

Network and schedule workflows may be command/skill/prompt driven instead of
dedicated settings screens. They must show structured results, resolve missing
fields through input cards and execute validated host methods. Schedules support
timezone, next-run preview, create/edit, pause/resume, run-now, delete and history.
Network actions support status, listeners, pairing offers and revocation; require
explicit administration authorization and a reviewable change summary. Warn when
a listener change or self-revocation will disconnect this device, show recovery
instructions and verify the resulting state. Existing unprivileged paired devices
must not silently gain administrative rights.

### Git, undo, attachments and QR pairing

Expose status, stage/unstage, commit, branches, checkout, fetch/pull/push and stashes,
plus discard, branch/stash deletion, undo commit and recorded selective undo.
Use existing review undo previews/tokens, expected HEAD/fingerprints and conflict
checks. Before destructive actions, show the computer, repository, affected paths
and consequence; distinguish tracked-file restore from permanent untracked-file
deletion. A changed repository invalidates the preview; never retry a mutation
automatically after an ambiguous response.

Use native photo/camera/document pickers and copy temporary picker assets before
their grants expire. Upload to the originating host, preserve draft association,
show progress/cancellation and retry failed transfers without resubmitting a thread.
Enforce size/MIME limits on the server; current base64 `attachments.add` is bounded
by the 16 MB invoke limit, so add chunked/streaming upload capabilities for larger
files. Keep unsent attachments on the phone until upload is confirmed; define
orphan cleanup, and do not expose host tokens to preview renderers.

Have the host display a versioned QR offer containing direct connection
details and an expiring one-time pairing code. Validate scanned payloads, show the
target host and transport before redeeming, and keep manual pairing available.
Do not embed long-lived credentials; protect the camera/deep-link flow against
unrecognized schemes, expired codes and connecting to an unintended host.

### Deferred relay

A relay forwards connections between phone and host when direct routing is
unavailable. The host establishes an outbound tunnel, avoiding router port
forwarding. Agents, files and PTYs still run on the host; an offline host remains
unavailable. This is additional service infrastructure, not an automatic feature
of the existing HTTP server, and must support multiple simultaneous host tunnels.

When relay work resumes, evaluate Cloudflare Workers + Durable Objects for managed
hosting and a compatible self-hosted WebSocket service. Validate operating costs
and free-tier limits before committing to hosting. This work is outside the first
release and is not a beta prerequisite.

Design an opt-in relay. Authenticate host registration and bind mobile access to paired devices.
Use end-to-end authenticated encryption so the relay cannot read workspace data
or bearer tokens; establish host identity through pairing and a reviewed protocol,
not custom cryptography. Define tunnel multiplexing, backpressure, rate limits,
revocation, reconnect and direct/relay failover without duplicate event delivery
or mutation retries. Advertise relay support as a new capability and retain direct
connections when relay is unavailable. Future relay acceptance includes outage/
failover, host identity rejection, revoked tunnel access and multi-host isolation
without duplicate mutations or readable workspace content at the relay.

### Background push

Use a host-triggered notification service delivering through APNs/FCM (Expo push
is an implementation option). Register each phone installation with every paired
host; keep push credentials on the service, not in the app. Send completion,
needs-input and failure alerts even when that computer's workspace is hidden or
the phone is suspended. Minimize payloads by default: opaque routing IDs and
generic text, with detailed previews opt-in. Route taps to computer/session and
refetch before allowing responses. Deduplicate foreground SSE/push alerts, remove
registrations on revoke/forget, handle denied permissions and expired tokens, and
document best-effort delivery. The relay does not replace push, and push does not
keep background SSE streams running.

## Connection and state rules

1. Normalize the server URL with contracts. The current protocol supports an
   origin, not a reverse-proxy path prefix; explain this in address validation.
2. Pair through `/pair`; save the device token in SecureStore and metadata
   separately. Never place credentials in URLs, logs, crash reports or query caches.
3. Invoke `background.status` to check protocol and capabilities. Show an
   actionable incompatibility screen before opening the workspace.
4. Use `encodeInvoke`, bearer authentication and the protocol header for calls.
   Distinguish server errors, HTTP errors, timeout, offline and malformed responses.
5. Validate an SSE implementation on both native platforms that supports request
   headers and incremental delivery; do not assume browser EventSource or Node
   streams are available. Keep exactly one active stream per saved, compatible,
   authorized computer while the app is active, including computers not visible
   in the UI. Reconnect and authentication state are independent per computer;
   one unavailable host must not block the others.
6. Subscribe before loading snapshots; buffer/merge live updates during hydration.
   Reuse the desktop's sequence/revision behavior after checking server persistence
   guarantees. Handle transient unsequenced text separately from persisted events.
7. On reconnect or foreground entry, refetch session, transcript, pending inputs,
   goals and workspace lists for that computer. Discard callbacks from older
   connection generations. Track running/waiting counts and in-app notifications
   for every computer; hydrate full transcripts when their threads are opened.
   Refresh lists after mutations; add a bounded foreground refresh for changes
   without a corresponding push event.
8. Retry transient connection failures with capped backoff and jitter. A rejected
   token stops reconnecting and shows Pair again; rate limits respect server delay.
9. Suspend all streams in the background and reconnect all saved computers on
   return, independently of the selected workspace. Host agents keep working,
   but the phone cannot promise continuous background delivery.
10. Do not automatically retry message submission or approvals after an ambiguous
    timeout. Preserve the draft and refresh state before offering an explicit retry.
    The current protocol provides no general mutation idempotency key.

HTTPS is the default. Trusted-network HTTP needs an explicit per-computer choice
and platform transport-policy validation. Confirm iOS local-network permissions,
ATS and Android cleartext behavior on physical devices; never bypass certificate
validation. Forget removes local credentials, drafts and cache and unregisters
push when possible; queue cleanup if the host is offline. Revocation is host-backed
and available to explicitly authorized mobile administrators. Explain that paired
devices have the host's existing broad
remote privileges; UI feature limits are not server-enforced authorization scopes.

## Implementation sequence

| Phase | Work | Completion gate |
| --- | --- | --- |
| 0. Bootstrap and transport spike | Create `@ramu/mobile`, native navigation/theme, mobile scripts and development build configuration. Audit shared imports. Test pairing, invoke and authenticated SSE against a simulated provider. | Physical iOS and Android devices pair and stream output; desktop build still works with the hoisted workspace. |
| 1. Computers and workspace | Secure token storage, concurrent per-computer connections, workspace switching, compatibility checks, status/count indicators, notifications, project/task/thread lists and settings. | All saved computers connect independently; switching preserves connections without mixing state; notifications open the correct host/thread; revoked devices stop retrying. |
| 2. Thread companion | Virtualized transcript, tool cards, composer, local drafts, provider/model selection, thread creation, queue/steer, interrupt/stop and pending-input forms. | A complete agent interaction works on both platforms, including approval, question, disconnect and recovery. |
| 3. Host workspace and inputs | Remote folder APIs, repository creation/init/clone, per-computer provider usage, attachments, QR pairing and complete desktop input parity. | Both platforms create a repo, upload an attachment and exercise the input checklist against the correct host. |
| 4. Terminals, Git and automation | PTY attach/recovery, toolbar/gestures, goals, reviews, Git/undo, authorized network commands and schedule workflows. | TUI/input tests pass; destructive actions reject stale previews; network/schedule changes execute and report host state. |
| 5. Background push | Push service, per-host registration/revocation and notification routing, independent of relay infrastructure. | Suspended-phone alerts from all paired hosts route correctly; revoked registrations are removed; foreground alerts are deduplicated. |
| 6. Beta hardening | Accessibility, localization, long-thread/terminal performance, lifecycle tests, sanitized diagnostics, CI and preview builds. | TestFlight and Android internal builds pass the expanded acceptance checklist below. |

Phase 0 is the first implementation task. If native SSE is unreliable, resolve the
transport before building thread screens. Any protocol extension must remain
compatible with existing desktop clients and advertise new capabilities.

Add `dev:mobile`, `mobile:ios` and `mobile:android` scripts without changing the
default desktop commands. Mobile should supply `typecheck` and `test` for recursive
checks. Keep native builds in separate CI jobs with explicit platform prerequisites.
Use local native builds during development; EAS preview/distribution setup can
follow when bundle identifiers, signing credentials and account ownership are known.

## Verification and acceptance

Use a disposable server profile and simulated providers; paid provider calls stay
opt-in. Add focused tests for transport parsing, hydration races, lifecycle cleanup,
computer-scoped drafts and ambiguous mutation errors. Verify UI flows on both
platforms, including physical devices for network and lifecycle behavior.

- Pair successfully; reject expired/used codes; handle rate limiting and protocol
  mismatch; restart the phone app without exposing or losing credentials.
- Revoke the device on the host during a live stream; show Pair again and stop
  retries. Forget locally clears all state for that computer.
- Switch computers during hydration and message streaming without cross-host data.
- Connect at least two hosts concurrently. Keep receiving events, status/count
  updates and notifications from the hidden host while viewing the other; opening
  a notification selects its host/thread without reconnecting either host.
- Disconnect or revoke one host while another streams; only the affected host
  changes connection state. Forget one host without disrupting the others.
- Lose connectivity during a response; recover the persisted transcript without
  duplicate messages or missed pending questions. Handle host sleep and restart.
- Background and foreground the app; restore state without claiming that the
  phone was connected while suspended. Reconnect all saved hosts on foreground
  entry, including hosts whose workspaces are not selected.
- Submit a message and answer a pending request from either desktop or mobile;
  handle stale/already-answered requests after refetching.
- Render long conversations and large diffs with bounded list rendering and
  expandable content; preserve scroll position when reading earlier output.
- Verify safe areas, keyboard avoidance, large text, screen-reader labels,
  contrast and both languages on iOS and Android.
- Exercise terminal keys/gestures and external keyboard input with shell, vim,
  less and tmux; preserve PTYs across computer switches and recover bounded output.
- Browse allowed host folders and reject path/symlink escapes; init/clone and
  cancellation report the correct host/repository state.
- Verify per-host usage freshness, all input forms, commands/skills, attachments,
  upload cancellation/limits and expired QR offers on both platforms.
- Change schedules with timezone previews through prompts; verify run history.
  Test authorized network changes, rejected unauthorized administration and
  disconnection/recovery after listener changes or self-revocation.
- Preview destructive Git/undo operations in disposable repos; concurrent edits
  invalidate previews and permanent deletion is clearly identified.
- Test direct HTTPS and private-network routes with multi-host isolation.
- Deliver push while suspended with two hosts; route taps correctly, deduplicate
  foreground alerts, handle denied permission and unregister revoked devices.
- Run mobile checks, existing affected package checks, and the repository's
  `pnpm check` before submission; retain screenshots of the main native flows.

## Follow-up decisions

Choose final app identifiers and signing/distribution accounts before beta.
Measure transcript payload sizes before adding pagination or cursor replay.
Choose push-service credentials before phase 5. Relay deployment/ownership,
cost validation and tunnel identity verification remain deferred.
Specify administrative device grants and remote browsing roots before adding
the corresponding server capabilities. Track native
terminal renderer selection and complete input parity as explicit phase gates.

## References

- [Ramu headless server](../../docs/HEADLESS-SERVER.md)
- [Ramu contribution and validation guidance](../../CONTRIBUTING.md)
- [Expo monorepo support](https://docs.expo.dev/guides/monorepos/)
- [Expo development builds](https://docs.expo.dev/develop/development-builds/introduction/)
- [Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/)
- [React Native networking](https://reactnative.dev/docs/network)
- [EAS builds in a monorepo](https://docs.expo.dev/build-reference/build-with-monorepos/)
- [Termius mobile terminal controls and gestures](https://docs.termius.com/terminal/mobile-terminal)
- [Expo push notifications](https://docs.expo.dev/push-notifications/overview/)
