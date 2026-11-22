# Ramu mobile

The iOS and Android app for a Ramu host. The host runs your agents, providers, Git and terminals, and the phone connects to it directly over HTTPS or a LAN or VPN you trust. Get it on [Google Play](https://play.google.com/store/apps/details?id=com.akalstack.ramu) or the [App Store](https://apps.apple.com/app/id6836786013), or build it from source (see [Development](#development)).

## Connect a phone

1. Start Ramu on the host (`pnpm build`, then the desktop app or `ramu serve`). Its setup shows a pairing QR code; later, **Settings → Remote access → Pair a device** shows one. Headless: `ramu serve --listen 0.0.0.0:7788 --private-network`, then `ramu pair`. Read [remote access](../../docs/security-model.md#remote-access) first.
2. Install the app from a store. From source, install a development build once (`pnpm --filter @ramu/mobile eas:ios`, `eas:android`, or locally `build:ios`, `build:android`) and run `pnpm dev:mobile` first.
3. Open it. A phone with no host starts on **Connect to your computer**:
   - **Scan QR code** pairs the moment it reads the host's code. The phone's own camera works too: the code opens getramu.dev, which opens the app (or its store page first). The host's address and code stay after `#` in that link, so the site never receives them.
   - **Find a computer nearby** lists hosts on the same network. Allow the phone on the host when both screens show the same six-digit number.
   - **Sign in with your Ramu account** adds the hosts that let your account's devices in, from anywhere.
   - **Enter address and code** types them by hand.

   **Look around first** skips it. The **Pair a host** chip brings it back.

A code over plain HTTP, or a link opened from another app, opens the form to review before pairing. If pairing fails, the screen says why and what to do next, such as asking the host for a new code.

Use the host's LAN or VPN address, never `localhost`. The host must stay awake and reachable. Once paired, the phone learns the host's other addresses and switches to one that works. It checks that it's the same host before sending any credential.

## What you can do

- **Threads:** one card per project, standalone threads last. Swipe a thread to mark it done or archive it, with **Undo**.
- **New thread:** pick a project, **Auto**, **Standalone**, or **New project** (**Start something new** on a host with no projects), where the agent asks what to build, creates the project and moves the thread into it. See [Home](../../docs/guide/inbox.md#home).
- **Chat:** live transcripts, models and access, queue and steer, stop, approvals, questions and forms, goals and helpers. Ability rows show the image or answer with **Make another** and **Use another provider**, and **Settings → Models** shows each ability's choice read-only.
- **Inbox:** the Brief of what needs you across every host, plus Running, Recaps, Learned and Completed. The tab and app icon badges count what needs you.
- **Schedules:** see, run, pause and edit schedules, on any host.
- **Artifacts:** every artifact on your hosts, opened full screen without its thread, with the same values as the desktop. Add records offline and they sync when the host is back. **Add to Home Screen or share** shares a `ramu://artifact/…` link that opens it in Ramu. An artifact with a widget, or any dashboard, can show it on the home screen. A flowchart's **Edit labels** changes the words on its boxes and arrows. A doc's **Edit text** opens its headings, paragraphs, list items, tasks and quotes as formatted fields (or its Markdown). A deck's or design's **Edit text** changes a design's frame words, or its slides' titles, text (both columns of a two-column slide), quote attribution, notes and order, and saves a version marked Edited by you. **Kind** filters the list to one kind once there is more than one. **Play as video** plays a motion as the host's MP4 in the phone's own player. A deck shows one slide at a time. Swipe sideways or use the arrows above it. A desktop presenting the same deck follows the phone's slide. See [Artifacts](../../docs/guide/artifacts.md).
- **Search:** threads on every host.
- **Source Control:** status, staging, commits with AI drafts, branches, sync, stashes and undo. The branch's pull request shows its checks, where a connected platform reports its preview, and review state.
- **Deploy:** **Deploy** in a project's menu shows the platform its stack names, the latest deploy's checks as the Git host reports them, the live address watch with a switch to turn it off or on, and whether a production database address is saved. Plugins, the live address and the database address are set on a computer. See [Deploying an app](../../docs/guide/deploy.md).
- **Files:** browse, view, edit and move files, and add folders and clone projects on the host.
- **Terminals:** real host terminals with an extra-key rail. Hold and drag for arrow keys, and pinch to change the text size (remembered on the phone).
- **Browser and computer:** the Browser and Computer pills open full-screen viewers you can control by touch.
- **Hosts:** several hosts connect at once. Each has a switch that turns its connection off and on, keeping its pairing.
- **Offline:** drafts and an outbox stay on the phone and send in order when the host is back. A send that may or may not have arrived is marked **uncertain** and never retried by itself.

On an iPad or an Android tablet, a thread, settings, forms and their bottom buttons keep to one centered reading column. The tab lists sit under their large titles at full width, as do code, diffs and conflicts. iPad shows the tabs as a sidebar. On a window at least 900 points wide (an iPad or Android tablet in landscape, a 13-inch iPad either way) an open thread sits beside the list it was opened from, the thread list or the Inbox, and a pull request beside the Pull requests list. Picking another item there swaps it in place, and the open one stays marked. Narrower windows show one screen at a time. Screens rotate and follow Split View and resizable windows.

A viewer pairing can read and answer requests but change nothing. A device's access lapses after 90 days without use.

## Notifications

Opt in under **Settings → Notifications**, with a switch per kind: needs you, failed (including a deployed app that stopped answering), finished, scheduled runs, a daily recap and artifacts. Pushes never carry prompts or transcript text. An artifact's notification carries the words that artifact sends, and only from an artifact you allowed to notify.

On iOS, **Settings → Live Activity** shows running and waiting counts on the Lock Screen and in the Dynamic Island.

`google-services.json` for the official app is committed. A fork builds against its own projects with `EXPO_PUBLIC_EAS_PROJECT_ID=<id>` and `RAMU_GOOGLE_SERVICES_FILE=<path>`. Background Live Activity updates need an APNs key on each host (`RAMU_APNS_KEY_PATH`, `RAMU_APNS_KEY_ID`, `RAMU_APNS_TEAM_ID`). Delivery needs a physical phone and a signed build. See [Expo push setup](https://docs.expo.dev/push-notifications/push-notifications-setup/).

## Development

- `pnpm dev:mobile` starts Metro on every interface and prints a launch link per LAN or VPN address. `pnpm --filter @ramu/mobile dev:go` previews the layout in Expo Go, without pairing or native features.
- Add native modules with `pnpm --filter @ramu/mobile exec expo install …`, and rebuild the development client after native changes.
- Keep `react-native-reanimated`, `react-native-worklets` and `react-native-gesture-handler` aligned with the Expo SDK.
- Android needs JDK 21, and prebuild gives Gradle a 6 GB heap because the development client's dex merge runs out of memory in less. WebRTC 155.0.1 needs a narrow R8 exclusion, applied at prebuild. Recheck it when upgrading WebRTC.
- iOS uses a small `react-native-screens` patch for the native scroll-edge header.

```sh
pnpm --filter @ramu/mobile test
pnpm --filter @ramu/mobile typecheck
pnpm --filter @ramu/mobile web   # phone-sized browser preview
```
