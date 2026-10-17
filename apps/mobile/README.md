# Ramu mobile

A live iOS/Android companion for a Ramu workspace server. Hosts run agents,
providers, Git and terminals; the phone connects directly over HTTPS or a trusted
LAN/VPN. The production app has no seeded hosts or simulated conversations.

## Connect a phone

1. Build this checkout's desktop/server (`pnpm build`) and start Ramu on the host.
2. Open desktop **Settings → Remote access**, enable network access, then **Pair a
   device**. Choose the reachable address in the QR selector. For a headless host,
   use `ramu serve --listen 0.0.0.0:7788 --private-network`, then `ramu pair`.
3. Build once with `pnpm --filter @ramu/mobile build:ios` (or `build:android`), then run `pnpm dev:mobile` (Expo Go; use `pnpm --filter @ramu/mobile dev:build` for a development build) and open **Hosts → Pair**.
   Scan the desktop's QR offer, or enter its address and ten-character pairing code.
   Review the address and explicitly allow HTTP only on a trusted network.
4. Select a project or Standalone, then send an instruction. Provider installation
   and sign-in belong to the host; the model picker reads that host's catalog.

Use the host's reachable LAN/VPN address on a physical phone, not `localhost`.
The Expo development tunnel exposes the app bundle, **not** your workspace server.
The host must remain awake and reachable. Old hosts without the `mobile-companion`
capability show an update error; rebuild/restart the host rather than reusing mocks.

The React Native/React pins are isolated from desktop React through Metro. Install
SDK-compatible native modules with `pnpm --filter @ramu/mobile exec expo install …`.
`pnpm dev:mobile` starts Metro for Expo Go on the Mac's LAN address (`scripts/start.mjs`; an iPhone often cannot resolve the `.local` name). Use a development build (`dev:build`) for the native adaptive header and background push; Expo Go's bundled navigation library does not include our native scroll-view bridge.

## Navigation

A native tab bar (Liquid Glass on iOS 26) with four places, each with its own stack:

- **Threads**: projects and threads for the selected host (the old Home list).
- **Inbox**: what needs you (threads waiting, recaps that need a decision) across every connected
  host, plus Running, Recaps, Learned (what Ramu learned) and Completed. The tab badge and the app
  icon count what needs you. Opening a summary shows its changes and starts a thread about it.
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
  steer, stop, permissions, ID-based questions, elicitation forms and goal controls.
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
Paired devices retain the host's existing broad remote privileges, including shell
access. Network/device administration stays on the host desktop/CLI.

## Background notifications

The implementation is opt-in under Settings. Each paired device registers its Expo
push token independently with every host. Hosts send generic completion/input/failure
alerts through Expo's gateway, with opaque host/task/session routing IDs instead
of prompt or transcript content. Revocation and invalid-token receipts remove registrations.
Foreground push banners are suppressed so SSE supplies the in-app notification.

A build owner must supply an Expo project ID and configure APNs/FCM credentials:

```sh
EXPO_PUBLIC_EAS_PROJECT_ID=<project-uuid> pnpm --filter @ramu/mobile build:ios
# Or build:android; RAMU_GOOGLE_SERVICES_FILE can point to google-services.json.
```

EAS development/preview profiles are in `eas.json`. If enhanced Expo push security is
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
pnpm test:mobile # two disposable hosts and simulated providers; no paid calls
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

Home uses the native **Workspaces** navigation title. The wordmark appears during
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
