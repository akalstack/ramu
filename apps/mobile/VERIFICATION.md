# Outstanding mobile acceptance

Only checks that still need a physical phone, an account or a live provider. Tests, simulators and the web preview do not close them. Use disposable host profiles; paid provider calls are opt-in. Remove a check when it passes and move any lasting setup into the [README](README.md); unfinished work is in the [roadmap](../../docs/roadmap.md).

## Builds and distribution

- [ ] Configure APNs; publish TestFlight and Android internal builds.
- [ ] Rebuild the development clients (SDK 58, React Native 0.88, now with `expo-crypto`) on both platforms. Check startup, native tabs, the scroll header, camera, sharing, notifications, widgets, WebViews, computer-use WebRTC, discovery and dictation. The larger splash mark appears only in a rebuilt app.

## Pairing and hosts

- [ ] Pair by Nearby hosts (both screens show one number; **Allow**, **Deny** and the two-minute expiry work), by QR and by typed code, on a LAN and a VPN. Repeat from a second desktop and with `ramu pair` on a headless host.
- [ ] Pairing screens: camera and local-network permissions (granted and denied), HTTP consent reset after an address edit, Pair above the keyboard on small screens and in landscape, large text and screen readers, external pairing links.
- [ ] Two hosts streaming at once: switching, notifications and revoking one never disturbs the other; forgetting a host clears its state.
- [ ] Sleep, network loss, background and service restart recover the transcript, drafts, pending input and terminal output without duplicates.

## Permissions and viewer role

- [ ] With the host's default permissions off, the browser and computer viewers offer **Request access** and Settings → Hosts lists the four permissions. Allowing this time, for an hour, for a day or always takes effect without reconnecting; "This time" ends at disconnect; **Never** shows "Declined by the host". Repeat from a second desktop and with `ramu devices` on a headless host.
- [ ] As a viewer: read history and answer approvals and questions (only on their own host); every mutation is unavailable with an explanation; an owner-shared screen is watch-only. Change the role while drafts, menus and confirmations are open and while messages are queued offline; text is kept and nothing sends on the old role.

## Browser and computer use

- [ ] Browser: tapping a field raises the matching keyboard and typing lands; taking control moves between the phone and a desktop both ways with "Another of your devices has control" on the other; **Open on this phone** loads public pages and a `--host 0.0.0.0` dev server natively, explains a loopback-only one, keeps no sign-ins after closing, and returns to the same host tab.
- [ ] Computer use: typed text arrives as typed (not "a"); tapping a text field in a Mac app raises the keyboard where the app reports focus; gestures (tap, double tap, hold, drag, pinch) and the keyboard button work.

## Interface and input

- [ ] Activity pills (computer, browser, terminal, working, approval, offline with **Reconnect**), plan usage with provider icons, and Android settings cards against iOS, with large text, screen readers and both languages.
- [ ] Keyboard: animation and avoidance, IME, external keyboards, paste, rotation; Send stays reachable and drafts survive in threads and side questions.
- [ ] Terminal: touch scrolling, held arrows, modifier keys, reconnect, and shell, vim, less and tmux.
- [ ] Long conversations, large diffs and terminals perform well; safe areas, contrast, reduced motion and focus are right.
- [ ] Approvals, questions, attachments, folders, Git and undo, and schedules act on the correct host.
- [ ] Interactive cards: rendering, reload after a renderer failure, saved scenarios, sharing, offline use and memory with three live WebViews.

## Deployments

- [ ] With a project linked to Vercel and one linked to Netlify: **Deployments** in the project menu lists the latest deployments with their state and **Open**, the live address, the uptime watch (including an open incident) and usage figures; **Roll back** on an earlier production deployment asks with the address, and the live site changes; a viewer pairing does not offer **Deployments**. The branch's pull request card shows **Preview building…**, then **Preview at …**, which opens the preview.

## Push, Live Activities and limits

- [ ] Background push from two hosts to a suspended phone opens the right thread once, including from a stopped app; revoked registrations stop.
- [ ] Real APNs delivery and Dynamic Island and Lock Screen rendering on a provisioned iPhone; Android notification permission and channels.
- [ ] Against a really limited host: Try again → Still limited → reset and resume, auto-resume off, queued messages, and the limit tray with large text.

## Artifacts

- [ ] The Artifacts tab lists a host's artifacts; one opens full screen, shows values entered on the desktop, and its grant sheet allows or refuses each capability.
- [ ] A page with records and AI: typing "coffee 35k yesterday" and photographing a receipt both become records through the host's model; the photo picker opens the camera and library on iOS and Android.
- [ ] Records added in airplane mode show as queued and sync in order when the phone reconnects; a refused one is listed.
- [ ] A page run shows its steps, **Stop** ends it, and a deletion waits for **Allow**.
- [ ] An artifact's notification arrives as a push and opens the artifact; the **Artifacts** alert switch turns them off.
- [ ] **Add to Home Screen or share** produces a `ramu://artifact/…` link that opens the artifact in Ramu, and says when the host is offline.
- [ ] **Edit** on a page selects the tapped element and the request reaches a thread; **Fix this** after an error loads the fixed version.
- [ ] A page with a widget shown from **Show in the home screen widget** appears on the iOS and Android home screen with its number or list, and updates after a record is added.
- [ ] A page run lasting more than a few seconds shows a Live Activity on iOS that ends with the run.
- [ ] A deck opens on its first slide alone; swiping sideways and the arrows move through it on iOS and Android, and taps still follow its links.
- [ ] **Kind** filters the Artifacts tab to docs, decks, dashboards, designs or motions once a host has more than one kind.
- [ ] **Edit text** on a doc, a Mermaid diagram, a deck (including both columns and a quote's attribution) and a design saves a new version marked "Edited by you on" the phone's name, and the desktop shows it.
- [ ] A deck's PowerPoint, a doc's Word file, a diagram's PNG and a motion's MP4 reach the share sheet and open in the phone's apps.
- [ ] A live dashboard opened offline shows the "As of" of its last read; a watched figure's change arrives as a notification.
- [ ] **Start from a template** makes a new artifact from a starter and from one of your own templates.
