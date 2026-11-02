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

### Stage 1: Live view for Browser and Computer

- **Float:** on the Browser and Computer pills, panes and viewers. The view is pinned to its thread, so it stays while the person opens other threads.
- **Follows the work:** it shows the surface the agent last used, and a person can pin one with a small switcher. Only surfaces the thread has are listed.
- **Always shown:** thread title, host, state, **Stop the agent**, **Open** and Close. When the agent needs the person, the state says so in text and **Open** goes to the exact thread. **Stop computer use** appears while computer use is active.
- **Desktop:** one small Electron window that remembers its size and corner per device, with **Keep on top** on by default so it stays above other apps. It is a window rather than a panel inside the app because the desktop browser is a native view that hides under menus (`browserOverlay.ts`). A desktop browser page moves into this window, and its pane shows **Showing in live view** with **Bring back**. Host Chromium and computer video need no move.
- **Phone:** a small view inside the app that drags to any corner, stays across screens, and expands on tap. Stop stays visible on the view itself.
- **Ending:** when the agent finishes, the view keeps its last frame and state until closed. A revoked grant or lost permission clears the picture immediately. A disconnect shows **Reconnecting** with Close still available.
- **Privacy:** a viewer-role device sees only what it may already see. A setting hides live views from the desktop's screen sharing where the system supports it.

### Stage 2: Test devices

- **Settings → Test devices (host):** a switch, off by default, with a readiness check for each platform: Xcode and Apple Silicon for iOS, the Android SDK and hardware acceleration for Android. Each missing item states its fix, and **Install & set up** handles only Ramu's own helpers. Xcode and the Android SDK stay the person's install.
- **Agent tools:** `test_device_list`, `test_device_open`, `test_device_install`, `test_device_launch` and `test_device_logs`, plus the existing observe and action tools for tapping, typing and gestures. Rotate, hardware buttons, deep links and permissions join them where a platform supports them. The first opening follows computer use's approval, and access rules match it.
- **Finding the right build:** `test_device_install` takes a path. Project commands remain how an app is built, so Ramu needs no knowledge of Xcode schemes or Gradle.
- **Seeing the app:** an accessibility tree when the platform provides one, otherwise a screenshot with coordinates. Logs are bounded, filtered to the launched app and stripped of known secrets.
- **Ownership:** one thread holds a device at a time, and another thread is told which one holds it. A host runs at most 2 by default. A device idle for 15 minutes with no viewer shuts down, and **Stop** is always available. Running devices appear in Resources as the thread's work, with **Still running** after the thread ends.
- **Pill and viewer:** the thread gains a device pill beside Browser and Computer, opening the existing viewer in a device-shaped frame. Clicks and drags map to touches, the phone uses direct touch, and **Take control** works as it does for computer use. **Float** works from Stage 1 with no extra design.
- **Across hosts:** a host reports which platforms are ready, for the Continue on another host menu ([Agents and routing](AGENT-ROUTING.md#continue-on-another-host)).

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

### Stage 1

- **Representative task:** with an agent working in Browser, a person floats it, reads another thread and works in another app, notices it needs them, and stops or opens it from the live view without searching for the thread.
- Agent activity never opens a live view, and closing it stops its stream.
- A desktop browser page keeps its state and control through floating and **Bring back**, and control rules are unchanged while it floats.
- Stop and Close remain visible and working during a disconnect.
- After a revoked grant, no picture of that target remains on screen.
- A viewer-role device cannot control anything from a live view.

### Stage 2

- **Representative task:** a person asks an agent to check a screen in this project's Expo app on an iPhone Simulator and an Android emulator. The agent boots, installs, launches, finds a real layout bug from what it sees, fixes it and shows the result, with no manual steps beyond the first approval.
- Repeat from a phone against a remote Mac host, watching in a live view, with **Take control** used mid-run.
- A missing SDK, a helper failure and a full device limit each report a fix and never hang.
- Agents cannot reach a shell, leave the workspace with an install path, or reach a helper's port from another machine.
- Two threads cannot control one device, and idle shutdown, thread stop and app quit leave no orphan processes.
- A slow network stays usable, and reopening a view leaves one stream.

### Stage 3

- Picture-in-picture shows Browser, Computer and Test device on physical iOS and Android devices, and ends cleanly on revoke or disconnect.
- A failed video connection falls back to the in-app live view, with Stop reachable.
