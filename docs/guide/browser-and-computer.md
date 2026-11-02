# Browser, computer use and test devices

Agents can work in a browser, on your computer's screen or apps, and on iOS Simulators and Android emulators. You watch, take control and stop them at any time.

## Browser

**Settings → Browser** chooses the agent's browser: Ramu's integrated browser (default) or the provider's own tools.

- In Full access the agent opens tabs, reads pages and clicks, types and scrolls. Other modes ask once per turn.
- **Take control** pauses the agent so you can sign in or click; **Give control** hands it back.
- **Profiles:** **Default** keeps sign-ins on this host; **Temporary** is cleared after each run. **Import…** copies sign-in cookies from Chrome, Edge or Firefox into a new profile.
- **Engine:** **Automatic** uses the desktop app's own browser when Ramu is open on the host, and the host's Chromium otherwise (as on a headless server).
- **Downloads** need your approval first and are never opened automatically. **Uploads** take files from inside the workspace.

On the phone, the Browser pill opens a full-screen viewer. **Open on this phone** loads the page in a private browser on the phone instead.

## Computer use

**Settings → Computer use** is off by default. Once on, each thread still needs a screen or app grant, and paired devices need the host's **Computer use** permission.

- The agent calls `computer_open`, optionally naming one app. Main threads open automatically once computer use is on; helpers ask.
- On desktop, the header's **Computer** button (⌘⌥M) opens the viewer. While you control the screen, your clicks and keys go to it; Escape returns the keyboard to Ramu.
- On the phone, tap, hold, drag and pinch work like a remote desktop, with a keyboard button for text.
- **Stop the agent** and **Stop computer use** are always one tap away.

macOS needs the Open Computer Use tool: **Install & set up** installs it and asks for Accessibility and Screen Recording.

## Test devices

**Settings → Computer use → Test devices** (off by default) lets agents check an app on an iOS Simulator or Android emulator on the host. It shows what each platform is missing and how to fix it. Xcode, the Android SDK and the optional iOS tap helper `idb` are your install.

The agent boots a device, installs a build from the workspace (`.app` or `.apk`), launches it and reads its logs, with no shell. The device then works like computer use: observe, tap, type, watch and take control. One thread holds a device at a time, at most two run per host, and an idle device shuts down after 15 minutes.

## Float

**Float** on the desktop's Browser and Computer trays keeps a small live view of the thread in a corner while you work elsewhere in Ramu. It always shows the thread's state with **Stop the agent**, **Open** and Close. **Keep on top of other apps** moves it into a small window above every app, hidden from screen sharing by default. Turn Float off in **Settings → Threads → Float on desktop**.

The phone has no Float: Browser, Computer and test devices show as pills that open the full-screen viewer.
