# Ramu mobile

A live iOS/Android companion for a Ramu workspace server. Hosts run agents,
providers, Git and terminals; the phone connects directly over HTTPS or a trusted
LAN/VPN. The production app has no seeded hosts or simulated conversations.

## Connect a phone

1. Build this checkout's desktop/server (`pnpm build`) and start Ramu on the host.
2. Open desktop **Settings → Remote access**, enable network access, then **Pair a
   device**. Review [remote access and device privileges](../../SECURITY.md#remote-access). Choose the reachable address in the QR selector. For a headless host,
   use `ramu serve --listen 0.0.0.0:7788 --private-network`, then `ramu pair`.
3. Install a development build once: from EAS with `pnpm --filter @ramu/mobile eas:ios` (or `eas:android`), or locally with `pnpm --filter @ramu/mobile build:ios` (or `build:android`). Then run `pnpm dev:mobile` and open **Hosts → Pair**.
   **Pair a host** opens on **Nearby hosts**: the phone lists hosts that have **Discoverable on this network** on (the camera stays off). Pick one and enter the pairing code from that host. Choose **Scan QR code** to use the camera, or **Enter manually** for the address and ten-character pairing code; both stay one tap away while browsing, when nothing is found and after the Local Network permission is refused. Browsing stops when you leave the screen, change method or background the app. It needs the development build (the `RamuDiscovery` native module); Expo Go and web show discovery as unavailable.
   Review the address and explicitly allow HTTP only on a trusted network.
4. Select a project or Standalone, then send an instruction. Provider installation
   and sign-in belong to the host; the model picker reads that host's catalog.

Use the host's reachable LAN/VPN address on a physical phone, not `localhost`.
The Expo development tunnel exposes the app bundle, **not** your workspace server.
The host must remain awake and reachable. Old hosts without the `mobile-companion`
capability show an update error; rebuild/restart the host rather than reusing mocks.

The React Native/React pins are isolated from desktop React through Metro. Install
SDK-compatible native modules with `pnpm --filter @ramu/mobile exec expo install …`.
`pnpm dev:mobile` starts Metro for the development build on the Mac's LAN address (`scripts/start.mjs`; an iPhone often cannot resolve the `.local` name). The development build is the default because pairing now uses WebRTC, and the native adaptive header, background push and scroll-view bridge need native code that Expo Go does not include. `pnpm --filter @ramu/mobile dev:go` still starts Metro for Expo Go as an opt-in layout preview, without pairing or native features.

## Project actions

A project's menu offers **Manage actions** for the selected host. Inspect the command and its repository source, move visible actions, hide/show commands or restore repository order. These settings are shared with other clients of that host. They never run a command, create a terminal or edit repository files. Hidden actions remain recoverable and are excluded from desktop menus and shortcuts. Offline and older hosts explain unavailable changes. Add or edit command definitions on desktop or in `ramu.json`.

## Files, workspace defaults and usage

**Browse files** on Threads opens a host/project picker without creating a thread. Thread headers and project actions open Explorer for their exact checkout. Direct and transcript links share the existing code/Markdown/image/diff viewer. Directory responses contain at most 2,000 entries per page, with **Load more files** on supporting hosts and a truncation notice on older hosts. A changed directory requires refresh; filename/path search uses the bounded quick-open index and shows at most 200 matches. Native existing-workspace acceptance and file-management context actions remain in the [Explorer plan](../../docs/EXPLORER-PLAN.md).

**Plan usage** appears in Threads and beside the composer's model, opening a shared host/account sheet. Missing readings, notice-only limits, last-known readings and measured percentages are distinct. Percentages mean used; they are account-wide rather than per-thread. The refresh action is specifically for Claude. Cursor/Antigravity allowance explanations are shared with desktop and localized. Transient refresh failures preserve the last reading and allow retry; reconnect refreshes the account data. Native layout, routing projection and other remaining work are in the [usage plan](../../docs/PLAN-USAGE-UX-PLAN.md).

In New thread → Workspace, select an existing workspace and use **Rename workspace** to edit its shared label. Saving keeps thread titles, Git branches, files and checkout IDs intact. The name is checked against the one the editor opened with; concurrent changes require review, and an older host shows an update hint. Offline saves are disabled.

Host Git settings now provide a default checkout mode and fixed branch prefix. A manual draft choice overrides the default; Use default restores inheritance. Sending freezes the chosen mode/prefix in the outbox, and creation retries use the same request ID. On a supporting host, optional branch-name details preserve manual edits and offer Generate name for semantic/custom naming. Further draft and device acceptance remains in the [workspace plan](../../docs/WORKSPACE-DEFAULTS-PLAN.md).

## New-thread model defaults

A registered project's `ramu.json` (or `.ramu/config.json`) can suggest `agent.preferredProvider` and `agent.preferredModel`. New thread shows the source and resolves the choice on that host. An explicit model choice stays with the active draft and survives reopening; **Use project default** resumes inheritance. Unavailable or invalid preferences keep the draft intact and offer a different model or a known **Use host default**. Changes detected during Send require review before anything is queued.

When host defaults have not loaded, reconnect or choose a reviewed model; the app does not label its own fallback as the host's default. Restored manual choices keep their reviewed access/fallback policy offline. Queuing freezes the selected settings, so a later repository edit does not change pending work. Existing threads and restored saved-message content keep their current model choices.

## Navigation

A native tab bar (Liquid Glass on iOS 26) with four places, each with its own stack:

- **Threads**: projects and threads for the selected host (the old Home list).
- **Inbox**: what needs you (threads waiting, recaps that need a decision) across every connected
  host, plus Running, Recaps, Learned (what Ramu learned) and Completed. The tab badge and the app
  icon count what needs you. Recap cards swipe left for Done, Snooze and Dismiss (Snooze offers
  In 3 hours, Tomorrow and Next week), and every action shows an Undo toast; a host that predates
  snooze times snoozes for a day. Opening a summary shows its changes and starts a thread about it.
- **Schedules**: the selected host's schedules with their next and last runs; swipe to
  pause, run now or delete; tap for runs; the editor covers daily, weekly, monthly, interval and one-time rules.
- **Search**: the native search tab; finds threads on every host.

Every tab carries a primary action (start a thread; new schedule on Schedules) and a Settings button in the
navigation bar. With no host paired, or a revoked/offline one, the primary action opens a sheet that
says why and offers Pair or Reconnect. Switch hosts from the host row at the top of Threads and
Schedules. Pair opens the camera immediately; manual address entry sits behind "Enter details manually".
All pop-ups are our one `Sheet`: on Android it is the official Material 3 modal bottom sheet (Jetpack Compose via
`@expo/ui`, opaque, with its own handle, scrim and swipe-to-dismiss; `MaterialSheet.android.tsx`), elsewhere a glass sheet.
Android uses the native stack header (left-aligned titles), the Material 3 bottom bar, opaque Material surfaces
instead of blur, and one shared `Toggle`. Android builds need JDK 21 (JDK 25 breaks the CMake step). A thread opened from any tab pushes above the tab bar.

## Connected features

- Multiple saved hosts connect concurrently while the app is active, with
  independent status, revocation, catalog, usage and thread state. Selecting one
  does not reconnect the others. In-app alerts open their originating host.
- Live thread/tool/helper transcripts, host models, reasoning/access/fallback settings, host file context and skills, queue/
  steer, stop, permissions, ID-based questions, elicitation forms and goal controls (pause, resume, clear and a verify-command editor on hosts that support `agent.goal.verify`).
- Persistent host metadata, drafts, question drafts and offline outbox. Native
  bearer tokens use SecureStore; the web preview uses browser local storage.
- Explicitly offline messages deliver in order after reconnect. Delivery interrupted
  after a request starts is marked **uncertain** and is never automatically retried.
  Check the host transcript before cancelling/editing and sending again. Removing
  an uncertain item does not undo something the host already received.
- Host folder browsing, folder creation, repository cloning and adding projects.
  Browse roots default to the host home and existing project roots; set
  `RAMU_BROWSE_ROOTS` to a platform-delimited allowlist to restrict the browser.
  Symlinks outside allowed roots are rejected. Clone uses host Git credentials;
  failed/slow clones leave the destination available for inspection.
- Document, photo-library and camera uploads (up to 10 MB per file), bounded by the existing server limits.
  Queued attachment IDs belong to their originating host.
- Source Control: actual status, staging, unstaging, commits/AI drafts, branches,
  fetch/pull/push/sync, stashes and expected-HEAD undo. Discard previews identify
  permanent untracked-file deletion and reject changed contents before applying.
- Recorded run diffs, review comments sent to the agent, and host-checked undo
  previews that skip conflicting files.
- Real host PTYs with a bundled xterm renderer, terminal tabs, Ctrl/Alt latch,
  escape/tab/arrows/control keys, clipboard paste confirmation and explicit close.
  Terminals survive screen changes. Reattach recovers the last 256,000 characters
  and merges subsequent output by cursor; no tokens enter the renderer.
- English/Bahasa Indonesia, persistent System/Light/Dark appearance and native
  safe-area/keyboard handling. Transcript rows are virtualized.

The app suspends streams when backgrounded and rehydrates all saved hosts on
return. Agents continue on their hosts. It never promises background SSE delivery.
Full-access devices can run shells and agents. The host can instead issue a viewer pairing for reading threads and answering input requests. Device access expires after 90 days of inactivity by default; active use extends it. Network/device administration stays on the host desktop/CLI. See [remote access](../../SECURITY.md#remote-access).

## Background notifications

The implementation is opt-in under Settings. Each paired device registers its Expo
push token independently with every host. Hosts send generic completion/input/failure
alerts through Expo's gateway, with opaque host/task/session routing IDs instead
of prompt or transcript content. Revocation and invalid-token receipts remove registrations.
Foreground push banners are suppressed so SSE supplies the in-app notification.

Settings → Notifications has one switch per kind of alert, sent to each host with the registration so the host only pushes what is on: a thread needs you, a thread fails, a thread finishes, a scheduled run finishes, fails or could not start (a thread started by a schedule counts here instead of under failed or finished; needing input is still "needs you"), and the **Daily recap**. A scheduled run that fails before its thread exists pushes "A scheduled run could not start." once and a tap opens the Schedules tab. The daily recap is off by default: when on, the host sends one "Your daily recap is ready." a day (no content) and a tap opens Inbox → Recaps. Recaps and learned summaries are otherwise silent and only show in the Inbox. Hosts that predate the switches ignore them and send every alert except the daily recap.

A build owner must supply an Expo project ID and configure APNs/FCM credentials:

```sh
EXPO_PUBLIC_EAS_PROJECT_ID=<project-uuid> pnpm --filter @ramu/mobile build:ios
# Or build:android; RAMU_GOOGLE_SERVICES_FILE can point to google-services.json.
```

EAS development/preview profiles are in `eas.json`. The `production` profile builds store
artifacts (iOS App Store/TestFlight, Android app bundle) with auto-incremented build numbers, and
`pnpm --filter @ramu/mobile eas:release:ios` / `eas:release:android` build and submit them to
TestFlight and the Android internal track (as a draft). Signing keys, the App Store Connect app and the Google Play
service account stay in the owner's EAS account (`eas credentials`, `eas submit`); nothing is committed. Run
these only after the [remote-security prerequisites](../../docs/REMOTE-SECURITY-PLAN.md#plan). If enhanced Expo push security is
configured, set `RAMU_EXPO_PUSH_ACCESS_TOKEN` on the host, never in the phone bundle.
A physical phone and signed development build are required to validate delivery.
Expo Go/web/simulators show a clear setup message. Delivery is best effort; forgotten
phones should also be revoked on the host if it was unreachable when forgotten.
See [Expo push setup](https://docs.expo.dev/push-notifications/push-notifications-setup/).

## Verify

```sh
pnpm check
pnpm --filter @ramu/mobile export:ios
pnpm --filter @ramu/mobile export:android
pnpm --filter @ramu/mobile test # transport, store and model unit tests
pnpm --filter @ramu/server exec vitest run test/mobileCompanion.test.ts test/mobileTerminal.test.ts test/mobileLiveActivity.test.ts
```

`pnpm --filter @ramu/mobile web` provides a phone-sized browser preview. Tests cover
transport chunk boundaries, URL/QR validation, ambiguous sends, resolved input,
browse-root escapes, push revocation/privacy, stale discard previews and PTY recovery.
Physical iOS/Android network, camera, keyboard and background-push checks remain
necessary before distribution. See [PLAN.md](PLAN.md) for the wider release roadmap.

The iOS header uses native Stack navigation and SF Symbol toolbar buttons, including
system Liquid Glass on supported iOS versions. The navigation bar stays transparent
at the top and uses UIKit's hard scroll-edge effect as content moves behind it.
A small pinned `react-native-screens` patch connects the library's native `ScrollViewMarker` to
`UIViewController.setContentScrollView(_:for:)` after the marked view mounts, following the
same UIKit connection used by T3 Code's v5 navigation fork. The OS owns the material,
scroll tracking and transitions; no JS scroll listener or blur overlay is used.
Rebuild the native app after installing dependencies; Expo Go cannot load the patch.
Android uses the native Stack app bar, matching content gutters and floating controls. Android 12+ uses native RenderNode blur; older versions use tonal surfaces. Web keeps the browser fallback header. Composer actions use 44-point targets.
Loopback HTTP addresses (localhost, 127/8 and ::1) do not show the network HTTP warning.

Mobile launcher artwork uses `assets/Ramu.icon` directly on iOS for system Liquid
Glass. Android uses separate full-canvas foreground, background and monochrome
layers; no desktop rim or rounded mask is baked in. Regenerate the flat mobile
assets on macOS with `pnpm --filter @ramu/mobile gen:icons`. SDK 57 opts into
Expo scene support so Xcode 27 builds launch on iOS 27.

## Startup and terminal gestures

The Threads tab uses the native **Threads** navigation title. The wordmark appears during
startup with the same r-and-dot reveal as the desktop; reduced motion skips the
movement. Native launch assets match light/dark appearance without baked-in masks.

Hold a terminal for 650 ms to reveal directional cursor control. Drag beyond the
neutral area to choose an arrow; greater distance increases repeat speed and shows
more chevrons. Blue arrow fill animates with drag distance, draining when you move
closer and growing when you move farther. The thin timing track fills for each
real PTY arrow key. The rounded glass overlay stays beside the hold point,
clamping to the terminal's edges so it does not follow or obscure your finger. Release, cancel,
backgrounding, multitouch, exit or disconnect stops input. Ordinary taps and swipes
remain ordinary terminal interactions. Application-cursor mode uses the proper
SS3 sequences. No terminal credential is exposed to the renderer.

## Live Activities and Dynamic Island

On iOS, Settings → Live Activity controls one activity for the selected host's
ongoing agent work. Native SwiftUI layouts cover the Lock Screen, small banner,
compact/minimal Dynamic Island, and its expanded view. They show running/waiting
counts, attention state and elapsed time, with a deep link to the relevant task.
Prompts, transcripts, project paths and host names are never shown or pushed.
There is no invented percentage of completion. Completed work remains on the
Lock Screen for at most 15 minutes; disabling, forgetting or revoking dismisses it.

Foreground updates use the live connection. Without APNs host setup, background
or disconnected content explicitly becomes **Open to refresh**. With host APNs
setup, direct ActivityKit push updates continue while the phone is suspended;
stale data is marked after ten minutes. Activities expire after eight hours.
Apple may throttle delivery. A user-dismissed activity isn't restarted until the
current group of tasks finishes.

The widget extension uses `dev.ramu.mobile.activities` and app group
`group.dev.ramu.mobile`. A signed distribution/development build must provision
both targets, the app group and push entitlement. Background delivery also needs
an Apple APNs signing key on every participating host:

```sh
RAMU_APNS_KEY_PATH=/private/path/AuthKey.p8
RAMU_APNS_KEY_ID=<ten-character-key-id>
RAMU_APNS_TEAM_ID=<ten-character-team-id>
RAMU_APNS_BUNDLE_ID=dev.ramu.mobile # optional default; match your actual app
```

Set these in the host process environment, never in Expo public variables. The
phone registers each activity's token with its paired host. Debug builds use APNs
sandbox; production builds use production. Tokens are stored privately and paired
ownership is enforced. Unchanged status is coalesced; invalid tokens are removed.
The compact JSON content is below Apple's 4 KB limit. Expo Go cannot load this
extension; rebuild after dependency/configuration changes.

Design and lifecycle follow [Apple Live Activity guidance](https://developer.apple.com/design/human-interface-guidelines/live-activities/)
and [ActivityKit lifecycle documentation](https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities),
using [Expo's native SwiftUI/ActivityKit integration](https://docs.expo.dev/versions/v57.0.0/sdk/widgets/).

## Terminal console layout

The terminal uses the full canvas with a compact bottom dock instead of a title
bar, top tabs and command composer. The dock shows the host, current folder,
connection state and session count; tap it to switch or close sessions. Back,
New and the keyboard toggle remain within thumb reach. Opening is guarded while
a shell is being created. Closing a shell still requires confirmation.

The keyboard button focuses xterm directly. Input goes straight to the real PTY;
there is no second command field. An extra-key rail appears with the keyboard,
with visible Ctrl/Alt latches and a pinned Paste action. The same layout is shared
on iOS and Android; safe areas, keyboard avoidance and native materials remain
platform-aware. The terminal canvas stays dark while controls follow Ramu's theme.

## Thread activity and Inbox answers

A compact measured row above the composer opens pending input, helpers, advisor consultations, goals and the server queue. Connection and input take priority; cached offline requests remain visible with a reconnect explanation. The existing goal/queue controls move into this sheet when the activity row is present. Provider-limit controls keep their existing behavior. Context compaction has its own label, and the phone outbox remains a separate delivery surface.

Helper cards preserve provider/model/effort, timing, recovery, isolation, capability and waiting metadata. Counts distinguish active, completed, failed and stopped tasks; advisors have their own groups. Helpers launched in older turns remain selected while active, while routine settled groups start collapsed. Message and Stop appear only when supported and connected. Output is labelled an excerpt; no fake child thread is created to display it.

Inbox thread rows offer **Answer requests** to expand the same approval/question/form cards used in the transcript. Their host, session, request IDs and saved draft keys are shared, so answering in place requires no thread navigation. Offline rows preserve the request and explain reconnecting. Native device, long-list and accessibility acceptance remain in the activity plan.

New-worktree outbox entries retain their host's naming strategy, instructions and bounded opening message along with checkout mode and prefix. Semantic/custom naming runs on that host during delivery. If it cannot generate a valid name within the deadline, the thread shows “Used default branch name.” New thread → Workspace offers an editable candidate, explicit Generate name and provisional per-repository previews. Generation cancels on dismissal, edits and scope changes; late results cannot replace newer work. Candidates stay in active and explicitly saved drafts; generated candidates expire when their prompt or naming settings change. **Keep these base commits** binds the current preview to an unchanged request when it enters the outbox. Before enqueue, editing the request invalidates that review; leaving or restarting the form requires reviewing again. A confirmed moved-base rejection pauses delivery and offers **Review changed base commits** in the pending message. Approval keeps the original message, naming inputs and request ID; ambiguous outcomes retain their original plan for reconciliation. Older hosts keep ordinary automatic creation and hide unsupported naming controls.

Project menus include **Names for Auto…** to edit aliases and a short description on the owning host. Auto matches aliases against the first message and shares the description with its routing model. Failed saves keep the entered text; offline and view-only clients cannot save. Older hosts explain when an update is needed.

Explorer remembers folder expansion and scroll position for up to 12 host/checkout scopes (80 folders per scope). Navigation metadata stays in the existing device store and is removed when its host is forgotten. Reopening reloads listings from the host; file-reveal links take priority over the remembered offset. Search text and file contents are not persisted by this navigation feature.

Settings → Rules manages the selected host’s shared user instructions: search, create/edit, explicit project/provider scope, Always/Manual, enable/disable, history preview and confirmed deletion. A history revision is copied into the editor for review before Save. Edits retain their starting revision so another client’s changes cannot be overwritten silently. Unsupported hosts and offline/read-only devices retain their existing access boundaries.
