# Test devices and live views

Let agents run and check a mobile app on a simulator or emulator, and let a person keep an eye on any agent's screen while doing something else. Remove work as it lands, document shipped behavior in the feature guides, and delete this plan when implementation and acceptance are finished.

## The need

An agent can build a mobile app but cannot see it run. The person boots a simulator, installs the build, taps through it, and describes what went wrong. Watching agent work has a similar cost: Browser and Computer live in one thread, in a pane or a modal. Reading another thread or working in another app means losing sight of them, or missing the moment the agent stalls.

**Easier for the person:** asking "check this on an iPhone" needs no setup steps, and the agent boots a device, installs the build and shows the result. One small live view stays visible beside anything else, follows what that thread's agent is doing, and always has Stop within reach.

T3 Code's floating preview and device preview, and Orca's emulator pane and CLI, are references for the need only. Ramu keeps its own navigation, control and permission rules. T3 Code's [reported preview problems](https://github.com/pingdotgg/t3code/issues/28587) are a list of what to avoid: controls that hide themselves, a grabber that does nothing, full-resolution frames over a slow link, and old streams competing with new ones.

## Names

| Name | Means |
| --- | --- |
| **Test device** (new) | An iOS Simulator or Android emulator running on a host, for agents and people to test an app on. |
| **Live view** (new) | A small floating view of one thread's Browser, Computer or Test device. |
| **Float** (new) | The action that opens a live view. |

Pills and headers show the device's own name (**iPhone 17 · iOS 26**), so **Test device** appears mainly in Settings and tools. "Device" alone already means a paired phone or desktop in Ramu, "Emulator" is wrong for iOS, and "Phone" already means Ramu's phone app and would not cover tablets.

## Decisions

- **One control model.** Test devices use computer use's sessions, grants, observations, **Take control**, viewers and evidence by implementing `ComputerBackend`. A person learns nothing new, and every safeguard already built applies.
- **The host owns the device.** Test devices run on the host beside the project, and any desktop or phone views them through the existing authenticated connection. A device never needs Xcode or an SDK.
- **No raw shell.** Agents get bounded tools, never `simctl`, `adb` or a helper's exec option. App files come from a relative path inside the run's workspace.
- **Helpers are managed and private.** Pinned versions install outside the app bundle, as `ocu` does, listen only on loopback with a token, and stop with their device.
- **A live view never opens by itself.** Agent activity must not cover the person's work, as the phone's browser rule already says. A person chooses **Float**.
- **A live view adds no authority.** It follows the same control, approval and viewer-role rules. It watches; taking control still happens through the existing control.
- **Stop is always visible.** Stop and Close never auto-hide, including when the connection drops.
- **Cost follows viewers.** A closed view stops its stream. Each view has one stream, a reopened view replaces the old one, and frames fit the view instead of the device's native resolution.
- **Simulators and emulators only.** Physical phones hold personal data and would need separate consent, and computer use already covers macOS apps. Windows is unsupported.
- **Platform readiness only.** Hosts report which platforms are ready, with no wider capability detection.

## Delivery

Each stage is useful alone. Stage 1 ships first because it needs no new runtime.

### Stage 3: System picture-in-picture on the phone

- **Keep watching:** an action on the live view, and optional on leaving the app, continues it in iOS or Android picture-in-picture over other apps. It is watch-only, and tapping it returns to the thread.
- **Browser video:** Host Chromium sends image frames, which system picture-in-picture cannot show. It gains the video path used by computer use when a viewer asks for it.
- **Quality:** **Auto**, with lower resolution and frame rate on a weak link. Image frames remain the fallback, newest frame only, as today.

## Services to extend

- **Stage 1:** `apps/web/src/views/BrowserView.tsx` and `HostBrowserView.tsx`, `browserPane.ts`, `apps/web/src/chat/ComputerActivity.tsx` and `useComputerVideo.ts`, `electronGuest.ts` and window creation in `apps/desktop/src/main/index.ts`. On the phone, `BrowserViewer.tsx`, `ComputerActivity.tsx` and `useComputerVideo.ts`. Composition and actions use the app-owned components. Check whether a second window can share the main process's host connection before building it, and that moving a guest view keeps its page and control state.
- **Stage 2:** `ComputerBackend` and `ComputerTarget` in `packages/shared/src/computerBridge.ts`, `apps/server/src/computer/` (`router.ts`, `session.ts`, `service.ts`, `tools.ts`, `evidence.ts`), and a new `apps/server/src/testDevice/` for lifecycle and helpers, following `ocu.ts` for installation.
- **Check before building:**
  - **iOS:** [serve-sim](https://github.com/EvanBacon/serve-sim) (Apache-2.0, Apple Silicon only) is the candidate for capture and touch. Its accessibility support is not documented, so confirm where the tree comes from, and whether its H.264 output fits `packetizeH264` and `RtcViewers`.
  - **Android:** `adb` and `emulator` for lifecycle, `uiautomator` for the tree, and [scrcpy](https://github.com/Genymobile/scrcpy) (Apache-2.0) as the candidate for video and input. Confirm its server runs without its desktop client against an emulator.
  - **Computer use defaults:** it is off by default and has macOS-specific setup, so confirm test devices can share its sessions without needing its switch or macOS permissions.
- **Stage 3:** `apps/server/src/computer/rtc.ts` and `video.ts`, Host Chromium's feed in `apps/server/src/browser/browserFrames.ts`, and `useComputerVideo.ts` on the phone. Confirm that `react-native-webrtc` at the pinned version supports picture-in-picture on both platforms, and which iOS capabilities it requires, before committing to it. This needs a development build and cannot run in Expo Go.

Validate every input with `zod` and bound paths, logs and gestures. Keep new methods off `HOST_METHODS`, and off the viewer allowlist unless they only watch. Every string goes through `t()` with an Indonesian translation, and controls have keyboard and screen-reader labels. Update [UI](UI.md), [Architecture](ARCHITECTURE.md), [Security](../SECURITY.md) and the mobile verification list as each stage lands.

## Acceptance

### Stage 3

- Picture-in-picture shows Browser, Computer and Test device on physical iOS and Android devices, and ends cleanly on revoke or disconnect.
- A failed video connection falls back to the in-app live view, with Stop reachable.
