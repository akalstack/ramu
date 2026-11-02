# Ramu mobile

The iOS and Android app for a Ramu host. The host runs your agents, providers, Git and terminals; the phone connects to it directly over HTTPS or a LAN or VPN you trust. There are no store builds yet, so build it from source.

## Connect a phone

1. Start Ramu on the host (`pnpm build`, then the desktop app or `ramu serve`).
2. On the host: **Settings → Remote access**, turn on network access, then **Pair a device**. Headless: `ramu serve --listen 0.0.0.0:7788 --private-network`, then `ramu pair`. Read [remote access](../../SECURITY.md#remote-access) first.
3. Install a development build once (`pnpm --filter @ramu/mobile eas:ios`, `eas:android`, or locally `build:ios`, `build:android`), run `pnpm dev:mobile`, and open **Hosts → Pair**.
4. Choose the host under **Nearby hosts** and allow it on the host when both screens show the same six-digit number, or scan its QR code, or enter the address and code.

Use the host's LAN or VPN address, never `localhost`. The host must stay awake and reachable. Once paired, the phone learns the host's other addresses and switches to one that works, checking it's the same host before sending any credential.

## What you can do

- **Threads:** one card per project, standalone threads last. Swipe a thread to mark it done or archive it, with **Undo**.
- **Chat:** live transcripts, models and access, queue and steer, stop, approvals, questions and forms, goals and teammates.
- **Inbox:** the Brief of what needs you across every host, plus Running, Recaps, Learned and Completed. The tab and app icon badges count what needs you.
- **Schedules:** see, run, pause and edit schedules, on any host.
- **Search:** threads on every host.
- **Source Control:** status, staging, commits with AI drafts, branches, sync, stashes and undo.
- **Files:** browse, view, edit and move files; add folders and clone projects on the host.
- **Terminals:** real host terminals with an extra-key rail; hold and drag for arrow keys.
- **Browser and computer:** the Browser and Computer pills open full-screen viewers you can control by touch.
- **Hosts:** several hosts connect at once. Each has a switch that turns its connection off and on, keeping its pairing.
- **Offline:** drafts and an outbox stay on the phone and send in order when the host is back. A send that may or may not have arrived is marked **uncertain** and never retried by itself.

A viewer pairing can read and answer requests but change nothing. A device's access lapses after 90 days without use.

## Notifications

Opt in under **Settings → Notifications**, with a switch per kind: needs you, failed, finished, scheduled runs and a daily recap. Pushes never carry prompts or transcript text.

On iOS, **Settings → Live Activity** shows running and waiting counts on the Lock Screen and in the Dynamic Island.

A build owner supplies an Expo project ID and APNs/FCM credentials (`EXPO_PUBLIC_EAS_PROJECT_ID=<id> pnpm --filter @ramu/mobile build:ios`). Background Live Activity updates need an APNs key on each host (`RAMU_APNS_KEY_PATH`, `RAMU_APNS_KEY_ID`, `RAMU_APNS_TEAM_ID`). Delivery needs a physical phone and a signed build. See [Expo push setup](https://docs.expo.dev/push-notifications/push-notifications-setup/).

## Development

- `pnpm dev:mobile` starts Metro on every interface and prints a launch link per LAN or VPN address. `pnpm --filter @ramu/mobile dev:go` previews the layout in Expo Go, without pairing or native features.
- Add native modules with `pnpm --filter @ramu/mobile exec expo install …`, and rebuild the development client after native changes.
- Keep `react-native-reanimated`, `react-native-worklets` and `react-native-gesture-handler` aligned with the Expo SDK.
- Android needs JDK 21. WebRTC 155.0.1 needs a narrow R8 exclusion, applied at prebuild; recheck it when upgrading WebRTC.
- iOS uses a small `react-native-screens` patch for the native scroll-edge header.

```sh
pnpm --filter @ramu/mobile test
pnpm --filter @ramu/mobile typecheck
pnpm --filter @ramu/mobile web   # phone-sized browser preview
```

Checks that need a physical phone are in [VERIFICATION.md](VERIFICATION.md).
