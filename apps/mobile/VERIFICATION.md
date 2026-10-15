# Mobile companion verification

Verified 15 October 2026 in this workspace, using disposable profiles and simulated
providers (no paid model calls).

- `pnpm check`: all recursive typechecks, enabled package tests, release-script
  tests and desktop/server builds passed. Live-provider tests remain opt-in.
- `pnpm --filter @ramu/mobile export:ios` and `export:android`: passed.
- `pnpm test:mobile`: two authenticated hosts, independent SSE/hydration,
  permission replies, ID-based questions, sequenced snapshots, stale discard
  rejection, staging/diffs/commit/expected-HEAD undo, real PTY output/recovery,
  and independent revocation passed.
- `pnpm test:e2e remote-access`: desktop network enablement, pairing,
  revocation, hidden hosts, workspace switching, token protection and forget passed.
- Collaborative browser at phone size: manual pairing to a real disposable host,
  new Standalone chat, permission approval and multi-question submission passed.
  Host messages persisted after refresh. Loopback HTTP warning is absent.
- Expo Go SDK 57 on the booted iOS 27 simulator: Home, Pair and Settings render
  native navigation headers and system SF Symbol/Liquid Glass buttons correctly.
  Shared content spacing and the fallback browser layout were visually inspected.
  Earlier soft-edge screenshots are superseded by the adaptive-header revision.
  The pinned native scroll-view bridge requires a development build; Expo Go
  does not validate that bridge.
  Native screenshots are under `output/playwright/mobile/` (ignored artifacts).
- Expo native config introspection: camera/photo/local-network permissions,
  notification plugin, platform transport configuration and rotation are present.

Still needs external/device validation before distribution: owned Expo project ID,
APNs/FCM credentials and signed builds for physical-device background push; physical
Android/iOS local-network, camera, keyboard/IME and terminal TUI acceptance. No relay
is deployed. Remote network/device administration retains the existing host-only
policy. Advanced terminal customization and desktop input polish remain roadmap work.

## Native UI and Live Activity follow-up

- Full `pnpm check` passed again: 537 server tests, 39 desktop tests, mobile's
  16 tests, other workspace tests/typechecks, release-script tests and both builds.
  A subsequent mobile run passes 17 tests, including the WKWebView touch-scroll guard.
  This includes APNs JWT signature validation, registration ownership, privacy,
  status transitions, stale dates, revocation, expiry and retry handling.
  The run exposed a steering shutdown race; a regression test now verifies
  pending/late callbacks cannot access a closed database.
- iOS development app and ExpoWidgetsTarget extension built with Xcode 27, then
  rebuilt with simulator signing. The signed build creates a real ActivityKit
  activity on iOS 27 simulators. All eight layouts evaluate successfully using
  the extension's actual bundled widget runtime and serialized Ramu layout.
  Dynamic Island/Lock Screen physical rendering and APNs delivery still need a
  provisioned phone. Simulator screenshots did not show a visible Island, so
  they are not evidence of its final appearance.
- Android native `assembleDebug` passed for arm64-v8a, including native toolbar,
  blur, terminal and splash dependencies. Its APK is in the generated Android
  build output. No Android device/emulator was attached for visual acceptance.
  The installed Android Studio JDK 25 required native-access permission for its
  Prefab subprocess; JDK 21 avoids that toolchain warning.
- Both final platform exports passed after removing all temporary review routes
  and ActivityKit fixtures. Native app launch shows the Workspaces navigation
  title and system glass action. The earlier native hard-edge long-list check
  exercised the native scroll marker and UIKit background at top/scrolled states.
- Real browser terminal startup, held mouse drag, three-chevron speed, blue gauge,
  actual emitted arrow input and no repeats after release were checked at 390×844.
  The check found and fixed a missing newline before FitAddon's UMD bundle that
  had commented out its initialization. Engine/driver tests cover short swipes,
  holding, hysteresis, gauge timing, application cursor mode, release, multitouch,
  background/disconnect cancellation and fresh-hold requirements after reconnect.
- Mobile full-bleed launcher layers, native Icon Composer iOS source and the
  desktop-derived startup animation are included. Reduced motion is supported.
  Physical touch feel, keyboard/IME, accessibility and reduced-motion acceptance
  remain part of device validation.

Native directories and screenshots are generated/ignored. Rebuild the native app
with this checkout; Expo Go cannot validate the patched scroll bridge or activities.
APNs host variables and signing/app-group requirements are documented in README.

## Cursor gauge refinement

- Blue arrow fill uses an 80 ms retargetable animation of drag strength. Moving
  closer drains it; moving farther fills it. Arrow fill follows each direction's
  axis. A separate thin track preserves key-repeat timing without resetting the
  strength indicator on every key.
- The 112-point glass panel uses Ramu's rounded corners, theme colors and lighter
  two-point icon strokes. Placement stays beside the hold origin, prefers above,
  flips at edges and clamps to the terminal bounds.
- Mobile typecheck and all 18 mobile tests pass. The new placement test covers
  edge positions, out-of-range origins and small viewports. A 390×844 browser
  gesture verified grow/drain/refill, real arrow bytes and no input after release.
  Screenshots: `gesture-strength-high.png` and `gesture-strength-low.png` under
  the ignored `output/playwright/mobile/` directory. The temporary route was removed.

## Terminal console redesign

- Removed the terminal title bar, top tabs, separate command field and always-visible
  close row. Added a shared bottom console with computer/folder/status, session
  picker, Back, New and direct terminal keyboard focus. Close remains confirmed
  in the session sheet. The extra-key rail shows while the keyboard is open;
  Paste stays pinned and modifiers expose their pressed state to accessibility.
- At 390×844, the real TerminalView/TerminalDock components were checked in a
  temporary browser fixture: keyboard toggle focuses xterm, typing reaches the
  input callback, Ctrl renders selected, Paste remains visible and hiding the
  keyboard collapses the rail. Both collapsed and expanded screenshots are in
  `output/playwright/mobile/terminal-console-*.png`. The fixture was removed.
- Mobile typecheck and all 18 tests pass. iOS/Android/web exports pass. Physical
  iOS/Android software-keyboard animation and IME acceptance remain device checks.
