# Test devices on Simlock, and a regrouped Settings

## The need

A person asks an agent to check their app on an iPhone or Android screen while other threads keep working. Today that breaks down in four places:

- **A busy device is a dead end.** One thread holds a device and at most two run per host, so a second thread gets "Another thread is using that test device" or "2 test devices are already running" and the person has to stop something by hand.
- **Threads share state.** Ramu boots the person's own simulators, so one thread's install, sign-in or erased data is what the next thread starts from, and failures look random.
- **iOS taps cost a setup step.** Tapping and typing on a simulator needs idb: Homebrew's `idb-companion` plus a Python venv. It is the one install on the page most people stop at.
- **Watching is a slideshow.** The viewer and Float poll a PNG screenshot every 500 ms, and a crashed simulator ends the thread's device with no recovery.

Settings make the same work harder to find. Test devices sit at the bottom of **Computer & devices**, under computer use's permissions, so a person looking for "simulator" scrolls past a page about their Mac. The menu has 21 pages in three groups, and the groups do not match how people look for things: **Workspace** mixes how Ramu looks (Appearance, Shortcuts) with tools agents use (Browser, Computer, Git, Deploy) and a list that is not a setting (Archived threads); **Agents** holds 11 pages; **Ask before using another provider** is under Permissions while the rest of fallback is under Models; environment variables have their own page apart from the MCP servers and skills that use them; and moving settings to another computer is under Remote access.

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

### 1. Simlock as the engine

- **Setup:** **Settings → Computer & devices → Test devices** replaces **Install idb** with one **Set up test devices** button: it installs the pinned `simlock` into `~/.ramu/tools/simlock-<version>` with Ramu's Node, runs `simlock doctor`, and shows each finding in the existing missing-item rows with its fix. **Copy command** keeps the same install for a terminal. Ramu writes the daemon's settings it relies on (HTTP on loopback, `capabilities.input.enabled`, `capabilities.stream`) with `simlock config set`, and creates one agent token for its server with `simlock/admin`, kept in `credentials/`.
- **Leases:** `TestDevices` talks to the daemon through `simlock/client` with principal `ramu:<thread id>`, so a thread holds one lease and a helper agent shares its parent's. `test_device_list` reads the catalog (models and OS versions that can be leased) instead of `simctl list`; `test_device_open` takes a platform and an optional model and OS. Ramu renews every third of the TTL and releases when the thread ends, stops or is archived. If the Ramu server dies, the lease ends one TTL later, so there is no ledger.
- **Queue:** while a lease waits, the thread's device pill shows **Waiting for a device · 2nd in line** with **Stop waiting**; the tool returns once the device is ready. `TEST_DEVICE_LIMIT` and the "already running" error go away: capacity is Simlock's, from the machine's RAM.
- **Commands:** install, launch, open URL and logs run through `client.exec` with `simctl` or `adb`, which refuses verbs that would break a lease. Workspace path checks stay as they are.
- **Captures and input:** `computer_observe` captures with `simctl io <udid> screenshot` (or `adb exec-out screencap`, plus the uiautomator tree) through `client.exec`. Taps, swipes, scrolls and keys go over the lease's input socket in serve-sim's format; text goes through the socket's HID keys, and text it cannot type goes in through the device's clipboard and a paste. idb and `idb.ts` are deleted.
- **Crashes:** `onLeaseLost` and Simlock's reboot notice reach the thread as a system note ("The simulator restarted; launch the app again"), so the agent relaunches instead of failing.

### 2. Live screens

- The desktop viewer, Float and the phone's full-screen viewer decode the lease stream (`/v1/leases/<id>/stream`) through the server, which adds the token so clients never hold it. The desktop decodes with WebCodecs; the phone uses the same canvas in its WebView. Take control sends touches over the input socket.
- Screenshots stay as the fallback where decoding is unavailable, and as the agent's observation.

### 3. Starting points

- **Save as starting point** on a thread's device makes a Simlock baseline (an app signed in, test data loaded). `test_device_open` takes an optional starting point, and the project remembers the last one used, so the next thread starts signed in without the person repeating the setup.
- **Use my own simulator** stays possible: setting `drivers.ios.deviceSet` to `default` puts Simlock's simulators in Xcode's own list, so Xcode builds can target them by UDID. Ramu never leases the person's own devices; a baseline is how their state reaches an agent.

### 4. Settings: groups, pages and the Test devices page

The menu goes from three groups of uneven size to four groups of four to six pages, each named for what the person is trying to do. Pages keep their ids and content unless listed; old ids are dropped, with no aliases.

| Group | Pages |
| --- | --- |
| **Personal** | Appearance · Threads · Editor & Terminal · Keyboard shortcuts |
| **Agents** | Providers · Models · Agent setup · Plugins · Goals & delegation · Memory & learning |
| **Agent tools** | Browser · Computer · **Test devices** · Git · Deploy |
| **Access & host** | Permissions · Identities · Remote access · Account · Background & updates |

What moves:

- **Split:** **Computer & devices** becomes **Computer** (agent access, app control, locked use, keep awake) and **Test devices**, a page of its own (`devices`), so each is found by its own name in the menu and in search.
- **Merge:** **Environment variables** joins **Agent setup** as a group beside MCP servers and skills, the things that read them; **Provider fallback** (the limit choice and **Ask before using another provider**) moves from Permissions to Models next to the other fallback rows; **Settings transfer** moves from Remote access to Account, beside the settings backup.
- **Out of Settings:** **Archived threads** is a list, not a setting: it becomes an **Archived** view at the foot of the sidebar's thread list and a command in the command menu, and Settings search still finds it and opens that view.
- The phone uses the same four groups from `SETTINGS_MENU_GROUPS`; its phone-only pages (such as Paired computers) stay in a **This phone** group at the top.

How every page reads, using the components that exist (`SettingsRow`, `SettingsLabel`, `SettingsGroupTitle`):

- **Status first.** A page that has a state opens with one summary row and its one next action: "Ready on iOS and Android · 2 in use · 1 waiting", "Needs setup: Xcode", "Off". Explanations move into each row's help.
- **Setup as a checklist.** What a feature needs is a list of items, each **Ready** or with its own fix button (**Set up**, **Open Xcode**, **Copy command**, **Install iOS 18.4 · 8 GB**), instead of paragraphs of instructions. The page re-checks when Ramu regains focus, so the person never presses refresh after installing something.
- **Defaults show as defaults.** A changed row shows a small dot and its own **Reset**; each page keeps one **Reset defaults** at the foot.
- **Advanced stays folded.** Rows few people change (capacity, slim simulators, idle shutdown, a custom tool path) sit under a closed **Advanced** disclosure.

The **Test devices** page, in order:

1. **Status row** with the switch **Let agents use test devices**, the summary, and **Set up test devices** while anything is missing.
2. **Setup checklist:** Simlock, Xcode, an iOS runtime, the Android SDK, a system image, each from `simlock doctor` with its fix. A platform that cannot run on this host (iOS on Linux) shows one line saying so, not a failed check.
3. **In use:** one row per lease and per waiting request: the device and OS, the thread (opens it), how long it has been held or its place in line, **Watch** (opens the viewer) and **Stop** (releases it; the agent is told).
4. **Defaults:** the iPhone and Android model and OS a thread gets when it names none, chosen from Simlock's catalog with installed ones first.
5. **Starting points:** each saved baseline with its platform, size and the projects that use it, with **Rename** and **Delete**. Empty, it says how to make one from a thread's device.
6. **Advanced:** how many devices may run (automatic from this host's memory, or a number), slim simulators, and the keep-warm choice.

On the phone the page is the same list; **Set up** runs on the host and the checklist updates as it goes.

## Services to extend

- `apps/server/src/testDevice/testDevices.ts`: the `ComputerBackend` and the agent tools stay; lifecycle, capture and input move onto `simlock/client` and the input socket.
- `packages/shared/src/testDevices.ts`: readiness, the device shape (a lease instead of a UDID, a queue position) and the guide text.
- `apps/web/src/settings/TestDeviceSettings.tsx` and `apps/mobile/src/components/ComputerUseSettings.tsx`: setup and doctor rows.
- The computer viewer and Float (web and mobile) for the stream; `apps/server/src/background/resources.ts` for the Resources figures of Simlock's devices.
- `packages/shared/src/settingsMenu.ts` (groups and ids), the search entries in `apps/web/src/settings/SettingsPage.tsx`, the page switch in `apps/web/src/settings/SettingsPanel.tsx`, `apps/mobile/src/runtime/settingsModel.ts`, and the sidebar's thread lists (`apps/web/src/sidebar/projects/threadLists.ts`) for **Archived**.
- `docs/guide/browser-and-computer.md` **Test devices** once it ships, and every guide that names a Settings path that moves.

## Acceptance

- Three threads on one Mac each ask for an iPhone at once: each gets its own simulator, or waits with its place shown and gets one when another thread ends. No thread sees another's app.
- A thread's simulator is killed from Activity Monitor: the device comes back under the same lease, and the agent relaunches the app.
- Quitting Ramu mid-lease, then reopening it: the old lease is gone within one TTL and no simulator is left booted.
- A fresh Mac with Xcode reaches a tapping agent with one setup button and no Homebrew.
- On the phone and on the desktop, the viewer shows the screen live while the agent taps; Take control works.
- A starting point saved from one thread opens signed in on the next.
- An Android emulator on a Linux host runs the same checks.
- Searching Settings for "simulator", "emulator", "environment", "fallback" or "archived" opens the right page or view in one step, on the desktop and the phone.
- Someone new to Ramu, asked to "let the agent test on an iPhone", finds **Test devices** from the menu without search and reaches a ready device with one button.

Representative task: "check the sign-up screen on iPhone and Android" while a second thread fixes another bug on an iPhone. Today the person installs idb, then stops one thread to free a device. With this they press nothing after setup.

## Later options

- **A device fleet:** a Simlock gateway (a Mac mini serving a team), added as a host type with a URL and a token, as T3 Code does.
- **Physical phones** enrolled in Simlock, leased the same way.
- **iOS element tree:** when agent-device can drive a lease Ramu took, add its snapshot to `computer_observe` on iOS as uiautomator's tree is on Android.
