# Test devices on Simlock and clearer Settings pages

## The need

A person asks an agent to check their app on an iPhone or Android screen while other threads keep working. Today that breaks down in four places:

- **A busy device is a dead end.** One thread holds a device and at most two run per host, so a second thread gets "Another thread is using that test device" or "2 test devices are already running" and the person has to stop something by hand.
- **Threads share state.** Ramu boots the person's own simulators, so one thread's install, sign-in or erased data is what the next thread starts from, and failures look random.
- **iOS taps cost a setup step.** Tapping and typing on a simulator needs idb: Homebrew's `idb-companion` plus a Python venv. It is the one install on the page most people stop at.
- **Watching is a slideshow.** The viewer and Float poll a PNG screenshot every 500 ms, and a crashed simulator ends the thread's device with no recovery.

Settings pages still make the person read to find what changed: a row someone set looks the same as a default, and rows few people touch sit beside the ones everyone needs.

## Is Simlock the right base

[Simlock](https://incubator.callstack.com/simlock) (Callstack, MIT, npm `simlock` 0.6.0, first release 2026-08-21, Node 22.13 or later) is a device daemon built for parallel agents. Each request gets a **lease**: a booted, checked simulator or emulator nobody else touches, created when none is free and the machine has room (sized from CPU and RAM), queued fairly when it does not, renewed by its holder and freed one TTL after a holder dies. It deletes each device after its lease, keeps a warm pool of recently used models, reboots a crashed device under the same lease, shuts idle devices down and deletes them later, and never touches a device it did not create. It also offers baselines (a saved device a lease starts from), slim simulators, enrolled physical phones, an H.264 screen stream and a serve-sim input socket per lease, a Node client (`simlock/client`, `simlock/admin`) over a local socket, and a gateway that joins several Macs and Linux machines behind one URL.

That covers all four problems above, and it replaces code Ramu would otherwise keep growing (capacity, queueing, cleanup, crash recovery). Yes, use it, with three conditions:

1. **Pin it.** It is three months old and has shipped six minor versions. Ramu installs one pinned version into `~/.ramu/tools` with its own Node, as it does idb today, and moves the pin only after the checks below pass.
2. **One engine, not two.** Simlock replaces Ramu's own simctl and adb lifecycle; it does not sit beside it. Keeping both doubles every bug.
3. **Ramu keeps its tools.** Agents still get typed tools with checked arguments and no shell. Simlock is an implementation detail of `apps/server/src/testDevice/`, not something agents call.

## How T3 Code uses it, and what Ramu does better

T3 Code (`/Volumes/Drive/Projects/t3code`, `apps/server/src/device/SimlockDeviceHost.ts`, `docs/internals/devices.md`) adds Simlock only as an alpha **remote gateway host**, off by default, next to its local path (expo-device-hub streams, agent-device drives). It takes leases through the gateway's agent-device front, because agent-device cannot adopt a lease it did not take. A Simlock device there has no screenshot or MJPEG route, so its panel offers only input, and device settings are unavailable.

Ramu does this differently:

| | T3 Code | Ramu |
| --- | --- | --- |
| Where Simlock runs | A gateway the person runs and adds with a URL and a token | On every Ramu host, local, with nothing to configure: each host is a Simlock worker |
| Local devices | A separate stack (expo-device-hub and agent-device) | The same Simlock path, so local and remote hosts behave the same |
| Busy device | Waits up to 5 minutes inside `device_open` | The thread shows its place in the queue, and the person can wait or stop a thread holding a device from the same row |
| Agent driving | Agents run the agent-device CLI through a shell shim | Typed `test_device_*` and computer tools, no shell |
| Screens | Input only on Simlock devices | Live H.264 stream in the viewer, Float and the phone, plus captures for `computer_observe` |
| Device state | A fresh device every open | A fresh device per thread, kept for that thread's whole run, and **Save as starting point** to make a baseline from it |

## Delivery

Simlock is the engine on every host, as [Test devices](../guide/browser-and-computer.md#test-devices) describes: setup, a lease per thread through Simlock's agent-device front (with a token of its own per thread and an operator token held in memory), the queue, the element tree and taps by element, rotation, defaults, crash notes, and the Test devices page on the desktop and the phone. What remains:

### 1. Live screens

Measured on an M-series Mac (macOS 27, Xcode 27.2, iOS 27 and Android 36) with Simlock 0.6.0 and agent-device 0.21.36, against a page animating the whole screen:

| | iOS (serve-sim capture) | Android (scrcpy) | Polling today |
| --- | --- | --- | --- |
| Frames per second | 41 (median gap 20 ms, p95 36 ms) | 29 (median 25 ms, p95 107 ms; the emulator's own rendering) | about 2 |
| Size, bitrate | 734×1600, 2.3 Mbps | 712×1600, 2.3 Mbps | a full PNG every 500 ms |
| Change to frame | under 0.2 s | under 0.2 s | up to 0.5 s |

idb's `video-stream` reached 30 fps (p95 66 ms) at full size, and Simlock's defaults (720 px, a 30 fps cap) only 24 fps, so Ramu writes `capabilities.stream.maxDimension` 1600, `fps` 60 and `bitrateKbps` 4000.

- The desktop viewer, Float and the phone's full-screen viewer decode the lease stream through the server: `TestDevices.stream(taskId)` already returns Simlock's response (frames of a 4-byte length, a tag and the payload: description, keyframe, delta, alive, ended) read with the operator token, so clients never hold it. The desktop decodes with WebCodecs; the phone uses the same canvas in its WebView. Take control sends touches over the lease's input socket (`/v1/leases/<id>/input`, serve-sim's format), as the holder.
- Screenshots stay as the fallback where decoding is unavailable, and as the agent's observation.

### 2. The thread while it waits

- The thread's device pill shows **Waiting for a device · number 2 in line** (`TestDevices.placeOf`) with **Stop waiting**, as the Test devices page already does.

### 3. The rest of the Test devices page

- **Defaults** become portable settings with entries in `packages/shared/src/settingsCatalog.ts`, so "make the default iPhone a 16 Pro" works through `settings_change`; today they are host state.
- **Setup checklist** items get their own fix button where Ramu can act (**Open Xcode**, **Install iOS 27 · 8 GB** through `simlock component install`), not only the fix in words.
- **Advanced** adds how many devices may run (automatic from this host's memory, or a number) and slim simulators, beside **Keep a spare device ready**.
- **Resources** shows each Simlock device's memory and CPU under the thread holding it, as emulators Ramu started did before.

### 4. Settings conventions

- **Defaults show as defaults.** A changed row shows the same small dot as a row an agent changed (`AgentChangeMark`) and its own **Reset**; each page keeps one **Reset defaults** at the foot.
- **Advanced stays folded** on every page: rows few people change sit under a closed **Advanced** disclosure.

## Services to extend

- `apps/server/src/testDevice/testDevices.ts` (`stream`, `placeOf`), the computer viewer and Float on the web and the phone, and the thread's device pill.
- `packages/shared/src/settingsCatalog.ts` for the defaults; `apps/server/src/background/resources.ts` for Simlock's devices.

## Acceptance

- Three threads on one Mac each ask for an iPhone at once: each gets its own simulator, or waits with its place shown and gets one when another thread ends. No thread sees another's app.
- A thread's simulator is killed from Activity Monitor: the device comes back under the same lease, and the agent relaunches the app.
- Quitting Ramu mid-lease, then reopening it: the old lease is gone within one TTL and no simulator is left booted.
- A fresh Mac with Xcode reaches a tapping agent with one setup button and no Homebrew.
- On the phone and on the desktop, the viewer shows the screen live while the agent taps; Take control works.
- An Android emulator on a Linux host runs the same checks.
- On an iPhone simulator, "tap Sign up" with the button below the fold: `computer_observe` lists the button by its label, and the agent scrolls and taps it by ref without a coordinate guess.
- Searching Settings for "simulator", "emulator", "environment", "fallback" or "archived" opens the right page or view in one step, on the desktop and the phone.
- Someone new to Ramu, asked to "let the agent test on an iPhone", finds **Test devices** from the menu without search and reaches a ready device with one button.

Representative task: "check the sign-up screen on iPhone and Android" while a second thread fixes another bug on an iPhone. Today the person installs idb, then stops one thread to free a device. With this they press nothing after setup.

## Later options

- **A device fleet:** a Simlock gateway (a Mac mini serving a team), added as a host type with a URL and a token, as T3 Code does.
- **Physical phones** enrolled in Simlock, leased the same way.
