# Browser, computer use and test devices

Agents can work in a browser, on your computer's screen or apps, and on iOS Simulators and Android emulators. You watch, take control and stop them at any time.

## Browser

**Settings → Browser** chooses the agent's browser: Ramu's integrated browser (default) or the provider's own tools.

- In Full access the agent opens tabs, reads pages and clicks, types and scrolls. Other modes ask once per turn.
- To check a responsive layout, the agent can lay a tab it controls out at a phone, tablet or desktop size. The size ends when you take control, and the page returns to its normal layout.
- To check a page in both themes, the agent can switch a tab it controls to light or dark mode, the same setting as **Display → Appearance** in the phone's browser viewer; **System** follows the computer again.
- **Take control** pauses the agent so you can sign in or click; **Give control** hands it back.
- **Profiles:** **Default** keeps sign-ins on this host; **Temporary** is cleared after each run. **Import…** copies sign-in cookies from Chrome, Edge or Firefox into a new profile.
- **Engine:** **Automatic** uses the desktop app's own browser when Ramu is open on the host, and the host's Chromium otherwise (as on a headless server).
- **Downloads** need your approval first and are never opened automatically. **Uploads** take files from inside the workspace.

On the phone, the Browser pill opens a full-screen viewer. **Open on this phone** loads the page in a private browser on the phone instead.

## Computer use

**Settings → Computer** is off by default. Once on, each thread still needs a screen or app grant, and paired devices need the host's **Computer use** permission. The Computer tray lists your paired devices and whether each can watch and control; **Allow** grants that permission there, and Remote access takes it back or blocks it.

- The agent calls `computer_open`, optionally naming one app. Main threads open automatically once computer use is on; helpers ask.
- On desktop, the header's **Computer** button (⌘⌥M) opens the viewer. While you control the screen, your clicks and keys go to it; Escape returns the keyboard to Ramu.
- On the phone, tap, hold, drag and pinch work like a remote desktop, with a keyboard button for text.
- **Stop the agent** and **Stop computer use** are always one tap away.
- Several threads can watch the same screen, but only one acts on the main display at a time, since it has one pointer and keyboard. Apps work in the background, so threads can act in different apps at once; one app takes one thread at a time. A thread that finds the display or app busy waits and tries again, and the other thread's claim lapses when its run ends or after 45 seconds without an action. Your own input always wins.

macOS needs the Open Computer Use tool: **Install & set up** installs it and asks for Accessibility and Screen Recording.

## Test devices

**Settings → Test devices** lets agents check an app on an iOS Simulator or Android emulator on the host. Each thread gets a fresh device of its own that no other thread touches, keeps it across turns, and gives it back when it stops, is archived or is deleted, or after 30 minutes nobody used or watched it; the device is then deleted, so the next thread starts clean. Your own simulators and emulators are never used.

Devices come from [Simlock](https://github.com/callstackincubator/simlock), which Ramu runs on the host with [agent-device](https://www.npmjs.com/package/agent-device). **Set up test devices** installs pinned releases of both in `~/.ramu/tools` with Ramu's own Node, and starts Simlock with its home in `~/.ramu/simlock`: no Homebrew and nothing system-wide. **Copy command** gives you the same install for your own terminal, and **Set up** works from a paired phone too, running on the host. Xcode and the Android SDK are your install; Android's tools use Android Studio's own Java when you have no other.

The page opens with **Let agents use test devices** (off by default) and a status line such as "Ready on iOS and Android · 2 in use · 1 waiting" or "Needs setup: Xcode". **Setup** lists each platform as **Ready** or with each missing item and its fix, from Simlock's own check plus a platform with nothing for a device to run (Xcode without its iOS Simulator runtime, an Android SDK without a system image), with **Get Xcode** or **Get Android Studio** where one helps, and **Copy command** for a step that needs an administrator (Ramu never runs `sudo`); a platform the host cannot run (iOS off an Apple silicon Mac) says so in one line. **In use** lists the threads holding a device, with **Watch** (opens Float on that thread's screen) and **Stop**, and the threads waiting for one with their place in line and **Stop waiting**. **Defaults** picks the iPhone and Android model a thread gets when it names none, from the models that can run here. **Advanced** has **Keep a spare device ready** (the next thread gets its device in about half the time, about 20 seconds instead of 40 for an iPhone on an M-series Mac, but a spare stays booted and holds memory, so it is off by default), **Devices at once** (**Automatic** follows the host's memory) and **Slim iOS Simulators** (quicker and lighter, without some system apps such as Safari). These are settings like any other: Settings search finds them, and an agent can change the defaults when you ask. When the host is full, a thread waits in line instead of failing: the thread shows a card with its place and **Stop waiting**, and gets a device as soon as another thread lets go. **Resources** counts each device's memory and CPU under the thread holding it.

The agent asks for a platform, and a model and system from `test_device_list` when one matters (each model lists the systems it pairs with). It installs a build from the workspace (`.app` or `.apk`), launches it, opens links, reads its logs and turns an iPhone with `test_device_rotate`, with no shell. The device then works like computer use: `computer_observe` returns a screenshot and the screen's elements on both platforms, each with a ref, what it says and its centre, so the agent taps "Sign up" by its ref rather than by guessing a point; it types, scrolls, and uses Enter, Back and Home. If Simlock restarts a crashed device, the thread is told to launch the app again.

Watching a device in the viewer, Float or on the phone plays its screen as live video (about 40 frames a second on an iPhone simulator, 30 on an Android emulator), and shows screenshots until the picture first changes. With **Take control**, your touches, drags, scrolls, Home, Back and Enter go straight to the device, landing in about a tenth of a second.

## Float

**Float** on the desktop's Browser and Computer trays keeps a small live view of the thread while you work elsewhere in Ramu. Drag it by its title to put it anywhere in the window (or focus the title and use the arrow keys); it keeps that place. It shows the thread's state, **Open** and Close, a chip for each screen or tab it can show, and **Stop the agent** and **Stop computer use** under ⋯. **Keep on top of other apps** moves it into a small window above every app, hidden from screen sharing by default. Turn Float off in **Settings → Threads → Float on desktop**.

The phone has no Float: Browser, Computer and test devices show as pills that open the full-screen viewer.
