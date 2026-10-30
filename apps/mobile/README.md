# Ramu mobile

An iOS and Android companion for a Ramu workspace server. The host runs agents, providers, Git and terminals; the phone connects directly over HTTPS or a trusted LAN/VPN. There are no seeded hosts or simulated conversations. There are no store or TestFlight builds yet: build from source.

## Connect a phone

1. Run `pnpm build` and start Ramu on the host.
2. Desktop: **Settings → Remote access**, enable network access, then **Pair a device**, and pick the reachable address in the QR selector. Read [remote access privileges](../../SECURITY.md#remote-access) first. Headless: `ramu serve --listen 0.0.0.0:7788 --private-network`, then `ramu pair` ([headless server](../../docs/HEADLESS-SERVER.md)).
3. Install a development build once, from EAS (`pnpm --filter @ramu/mobile eas:ios` or `eas:android`) or locally (`build:ios`, `build:android`). Then run `pnpm dev:mobile` and open **Hosts → Pair**.
4. **Pair a host** opens on **Nearby hosts** with the camera off. It combines discoverable hosts on the local network with direct checks of saved hosts' addresses (NetBird and Tailscale routes included). In development it also checks the computer serving the bundle on the default API port. Saved hosts must prove their device identity and answer over the app connection before appearing as paired; **Connect to…** updates a verified address without a new code. For a new host, open **Pair a device** on it, then choose it here: the phone asks, both screens show one six-digit number, and you allow it on the host. A host that predates this, or an app build without `expo-crypto`, asks for the host's ten-character code instead. Checks stop when you leave the screen or background the app and expire after two minutes (**Search again**). **Scan QR code** and **Enter manually** are always available; after a scan the camera closes and the details appear for review, with **Pair** in a bottom bar above the keyboard. Review the address and allow plain HTTP only on a trusted network (changing the address clears the consent; loopback addresses show no warning).
5. Select a project or Standalone and send an instruction. Provider installation and sign-in belong to the host, and the model picker reads its catalog.

Use the host's LAN/VPN address on a physical phone, never `localhost`. The Expo development tunnel exposes the app bundle, not your workspace server. The host must stay awake and reachable, and a host without the `mobile-companion` capability asks you to update.

**Routes.** Once paired, the phone learns the host's LAN/VPN addresses on connection and every minute while online. When the current route fails it checks the alternatives concurrently and switches only after a candidate proves the paired host's identity and answers over the app's WebSocket; an identity endpoint alone is not enough. The saved address is verified before each authenticated connection, so a reassigned LAN address never receives the credential. HTTPS pairings never downgrade to HTTP. The VPN must be active on the host while routes are refreshed, and subnet routing gives no multicast discovery. If every saved route is unreachable, use **Settings → Computers → Change address** to pick a saved route or enter one; the phone verifies the host before saving, with no re-pairing.

**Development.** The React Native pins are isolated from desktop React through Metro; add SDK-compatible native modules with `pnpm --filter @ramu/mobile exec expo install …`. `pnpm dev:mobile` starts one Metro server on all interfaces and prints launch links for every private LAN/VPN address (NetBird and Tailscale first), refreshed as interfaces change; it picks a free port if the default is busy. Explicit `REACT_NATIVE_PACKAGER_HOSTNAME`, `EXPO_PACKAGER_PROXY_URL`, `--host`, `--tunnel` and `--localhost` disable the automatic list, and `EXPO_UNSTABLE_BONJOUR=0` disables nearby Expo discovery. A development build is the default because pairing uses WebRTC and the adaptive header, push and scroll bridge need native code; `pnpm --filter @ramu/mobile dev:go` starts Metro for an Expo Go layout preview without pairing or native features. Keep `react-native-reanimated`, `react-native-worklets` and `react-native-gesture-handler` aligned with the Expo SDK, and regenerate native projects after an SDK upgrade. Android prebuild applies a narrow R8 exclusion for the orphan `Dav1dDecoderJni` reference in WebRTC 155.0.1; recheck it when upgrading WebRTC. JDK 21 is recommended for Android.

## Navigation

A native tab bar (Liquid Glass on iOS 26) with four places, each with its own stack:

- **Threads:** pinned work, then one card per project (most recently active first) and standalone threads last. A card shows its newest three threads plus every running, waiting or failed one (**Show N more**). Tap a header to fold it (it then summarizes what is waiting or running); ⋯ or a long press opens the project menu, ✎ starts a thread. Projects without threads keep their card. A status filter (Running, Waiting, Failed, Archived) switches to one flat list. The project menu has New thread, Browse files, Open terminal, Rename, Copy folder path, **Names for Auto…** (aliases and a description for routing, saved on the host), **Manage actions** and Remove.
- **Inbox:** what needs you across every connected host, plus Running, Recaps, Learned and Completed. The tab and app icon badges count what needs you. Recap cards swipe for Done, Snooze (in 3 hours, tomorrow, next week) and Dismiss with an Undo toast. **Answer requests** on a row expands the transcript's own approval, question and form cards, sharing their drafts.
- **Schedules:** the host's schedules with next and last runs; swipe to pause, run now or delete; the editor covers daily, weekly, monthly, interval and one-time rules.
- **Search:** finds threads on every host.

Every tab has a primary action and a Settings button. With no host paired, or a revoked or offline one, the primary action explains why and offers Pair or Reconnect. Switch hosts from the host row on Threads and Schedules. Pop-ups are one `Sheet` component: the Material 3 modal bottom sheet on Android (`MaterialSheet.android.tsx`), a glass sheet elsewhere. Android uses the native stack header, Material 3 bottom bar and one shared `Toggle`; settings and sheet options use the same grouped cards and chevrons as iOS.

## Features

- Several saved hosts connect at once with independent status, revocation, catalog, usage and thread state; alerts open their originating host.
- Live transcripts of threads, tools and helpers; host models, reasoning, access and fallback settings; file context and skills; queue and steer; stop; permissions, questions, elicitation forms; goal controls including the verify-command editor. A compact row above the composer opens pending input, helpers, advisor consultations, goals and the server queue; helper cards keep provider, model, effort, timing and capabilities, and Message and Stop appear only when supported and connected.
- Drafts, question drafts and an offline outbox persist on the device (bearer tokens in SecureStore). Profile saves use a serialized queue and verify each write. Offline messages deliver in order after reconnecting. A delivery interrupted after the request started is **uncertain** and never retried automatically: check the host transcript before cancelling and sending again.
- Host folder browsing, folder creation, cloning and adding projects. Browse roots default to the home folder and project roots (`RAMU_BROWSE_ROOTS` restricts them); symlinks outside them are rejected. Clone uses the host's Git credentials.
- Uploads from files, the photo library and the camera (10 MB each).
- **Source Control:** status, staging, commits and AI drafts, branches, fetch/pull/push/sync, stashes, expected-HEAD undo. Discard previews name permanent deletions and reject changed contents. A commit or stash opens its files and read-only diffs (a stash can be applied, popped or deleted). The commit box follows desktop's gates: none with conflicts or during a rebase or merge, remote actions need a remote, undo is refused for the root or a pushed commit, and an in-progress rebase or merge offers Continue and Abort.
- Recorded run diffs, review comments sent to the agent, and host-checked undo that skips conflicts.
- **Terminals:** real host PTYs with an xterm renderer, tabs, Ctrl/Alt latches, an extra-key rail with Paste, and confirmed close. Terminals survive screen changes; reattach recovers the last 256,000 characters and merges output by cursor. The canvas fills the screen above a compact dock (host, folder, state, session count). Hold for 650 ms to reveal directional cursor control: drag past the neutral area to pick an arrow, farther to repeat faster; release, cancel, backgrounding, multitouch or disconnect stops input.
- **Files:** Browse files and thread Explorer share one viewer for code, Markdown, images and diffs ([UI](../../docs/UI.md#mobile-surfaces)). Explorer remembers folder expansion and scroll for 12 host/checkout scopes (80 folders each) on the device.
- **Plan usage:** a ring in the Threads header opens a usage view grouped by provider and account. Account details remember whether to show IDs and times. Missing readings, notice-only limits, last-known and measured percentages stay distinct; percentages mean used and are account-wide. Refresh is Claude-specific, a transient failure keeps the last reading, and reconnecting refreshes.
- **Workspaces:** New thread → Workspace picks an existing workspace and **Rename workspace** edits its shared label (checked against the name you opened; offline disabled). Host Git settings set the default checkout mode and branch prefix; a manual choice overrides, **Use default** restores. Sending freezes the mode, prefix and naming inputs in the outbox, and retries reuse the request ID. Semantic or custom naming runs on the host at delivery and falls back to "Used default branch name." **Generate name** and per-repository previews never create a thread; **Keep these base commits** binds a preview to an unchanged request, and a moved base pauses delivery with **Review changed base commits**. Older hosts keep ordinary creation and hide unsupported controls.
- **Default model:** `agent.preferredProvider` and `agent.preferredModel` from `ramu.json` are resolved on the host and shown with their source; a manual choice stays with the draft, **Use project default** resumes inheritance, and a change detected at Send needs review. If host defaults have not loaded, reconnect or choose a reviewed model. Queuing freezes the settings ([Configuration](../../docs/CONFIGURATION.md#default-model)).
- **Rules:** Settings → Rules manages the host's shared instructions: search, create and edit with explicit project and provider scope, Always or Manual, enable, history preview and confirmed deletion. Edits keep their starting revision so another client's change is never overwritten.
- **Browser and computer viewers:** the thread's Browser viewer shows the host tab the agent controls, with latest-frame buffering (up to 30 fps) and a screenshot fallback on older hosts. A new browser or computer preview docks above the composer with separate open and dismiss controls. Touch uses one native surface aligned to the frame, and a resize cancels gestures started on the old geometry. **Open on this phone** loads the page natively instead of streaming it. See [UI](../../docs/UI.md#integrated-browser).
- Settings → Threads has one phone-local Steer/Queue control and one model-change warning; host choices stay the defaults until overridden.
- English and Bahasa Indonesia, System/Light/Dark appearance, safe-area and keyboard handling, virtualized transcripts.

The app suspends streams when backgrounded and rehydrates every saved host on return; agents keep running on their hosts and the app never promises background event delivery. Full-access devices can run shells and agents; the host can instead issue a viewer pairing. Device access expires after 90 days of inactivity (activity extends it). Network and device administration stay on the host.

## Notifications

Opt-in under Settings. Each paired device registers its Expo push token with every host. Hosts send generic completion, input and failure alerts through Expo's gateway with opaque routing IDs, never prompt or transcript content. Revocation and invalid-token receipts remove registrations. Foreground banners are suppressed (the event stream supplies the in-app notification), and taps wait for saved hosts to load, then open the destination once.

Settings → Notifications has a switch per kind, sent with the registration so the host pushes only what is on: needs you, failed, finished, scheduled run finished, failed or could not start (such a thread counts there, not under failed or finished), and **Daily recap**. Recaps are otherwise silent. The daily recap is off by default; when on, the host sends "Your daily recap is ready." once a day with no content and a tap opens Inbox → Recaps. A scheduled run that cannot start pushes "A scheduled run could not start." once and a tap opens Schedules. Hosts that predate the switches send every alert except the daily recap.

A build owner supplies an Expo project ID and APNs/FCM credentials:

```sh
EXPO_PUBLIC_EAS_PROJECT_ID=<project-uuid> pnpm --filter @ramu/mobile build:ios
# Or build:android; RAMU_GOOGLE_SERVICES_FILE can point to google-services.json.
```

`eas.json` has development and preview profiles. `production` builds store artifacts with auto-incremented build numbers, and `eas:release:ios` / `eas:release:android` build and submit them to TestFlight and the Android internal track (as a draft). Signing keys, the App Store Connect app and the Google Play service account stay in the owner's EAS account (`eas credentials`, `eas submit`); nothing is committed. If enhanced Expo push security is configured, set `RAMU_EXPO_PUSH_ACCESS_TOKEN` on the host, never in the phone bundle. Delivery needs a physical phone and a signed build; Expo Go, web and simulators show a setup message. Delivery is best effort, so revoke a forgotten phone on the host. See [Expo push setup](https://docs.expo.dev/push-notifications/push-notifications-setup/).

## Live Activities and Dynamic Island

On iOS, Settings → Live Activity controls one activity for the selected host's ongoing work. Native SwiftUI layouts cover the Lock Screen, banner and compact, minimal and expanded Dynamic Island, showing running and waiting counts, attention state and elapsed time with a deep link to the task. Prompts, transcripts, project paths and host names are never shown or pushed, and there is no invented completion percentage. Completed work stays on the Lock Screen for at most 15 minutes; disabling, forgetting or revoking dismisses it.

Foreground updates use the live connection. Without host APNs setup, background content becomes **Open to refresh**. With it, ActivityKit push updates continue while the phone is suspended; data is marked stale after ten minutes and activities expire after eight hours. Apple may throttle delivery, and a dismissed activity is not restarted until the current group of tasks finishes.

The widget extension uses `dev.ramu.mobile.activities` and app group `group.dev.ramu.mobile`. A signed build must provision both targets, the app group and the push entitlement. Background delivery needs an APNs signing key on every participating host, set in the host process environment (never in Expo public variables):

```sh
RAMU_APNS_KEY_PATH=/private/path/AuthKey.p8
RAMU_APNS_KEY_ID=<ten-character-key-id>
RAMU_APNS_TEAM_ID=<ten-character-team-id>
RAMU_APNS_BUNDLE_ID=dev.ramu.mobile # optional; match your app
```

The phone registers each activity's token with its paired host; debug builds use APNs sandbox and production builds use production. Tokens are stored privately and ownership is enforced, unchanged status is coalesced, invalid tokens are removed, and the payload stays under Apple's 4 KB limit. Expo Go cannot load the extension; rebuild after dependency or configuration changes. Design follows Apple's [Live Activity guidance](https://developer.apple.com/design/human-interface-guidelines/live-activities/) and [ActivityKit lifecycle](https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities), using [Expo's SwiftUI/ActivityKit integration](https://docs.expo.dev/versions/v58.0.0/sdk/widgets/).

## Native appearance

The iOS header uses native Stack navigation and SF Symbol toolbar buttons (Liquid Glass where supported), transparent at the top with UIKit's hard scroll-edge effect as content scrolls under it. A small pinned `react-native-screens` patch connects the native `ScrollViewMarker` to `UIViewController.setContentScrollView(_:for:)` after the marked view mounts, as T3 Code's v5 navigation fork does; the OS owns material, scroll tracking and transitions, with no JS listener or blur overlay. Rebuild native code after installing dependencies; Expo Go cannot load the patch. Android uses the native Stack app bar, matching gutters and floating controls, with RenderNode blur on Android 12+ and tonal surfaces before. Composer actions use 44-point targets.

Launcher artwork uses `assets/Ramu.icon` on iOS (system Liquid Glass); Android has separate full-canvas foreground, background and monochrome layers. Regenerate the flat assets on macOS with `pnpm --filter @ramu/mobile gen:icons`. SDK 58 includes Expo scene support so Xcode 27 builds launch on iOS 27. The wordmark plays the desktop's r-and-dot reveal at startup (skipped under reduced motion), and launch assets follow light and dark appearance.

## Verify

```sh
pnpm check
pnpm --filter @ramu/mobile export:ios
pnpm --filter @ramu/mobile export:android
pnpm --filter @ramu/mobile test
pnpm --filter @ramu/server exec vitest run test/mobileCompanion.test.ts test/mobileTerminal.test.ts test/mobileLiveActivity.test.ts
```

`pnpm --filter @ramu/mobile web` gives a phone-sized browser preview. Tests cover transport chunking, URL and QR validation, ambiguous sends, resolved input, browse-root escapes, push revocation and privacy, stale discard previews and PTY recovery. Physical-device checks are in [VERIFICATION.md](VERIFICATION.md) and the [roadmap](../../docs/ROADMAP.md).
