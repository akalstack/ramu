# Outstanding mobile acceptance

This checklist contains only checks still requiring device, account or live-provider evidence. Existing unit/integration tests and prior simulator/browser checks do not establish physical-device acceptance. Setup and current capabilities are in [README](README.md); unfinished implementation is in [PLAN](PLAN.md).

Use disposable host profiles and simulated providers where possible. Paid live-provider calls remain opt-in. Remove a check when it passes and put any lasting setup requirements in README or the release guide.

## Devices, accounts and distribution

- [ ] Own the Expo project ID, bundle/application identifiers and signing/distribution accounts. Configure APNs/FCM credentials and produce signed device builds.
- [ ] Run the acceptance flows on a physical iPhone and Android phone. Native scroll integration and Live Activities require development/native builds; Expo Go cannot validate them.
- [ ] Publish and install TestFlight and Android internal-track builds after the applicable remote-security gates.

## Viewer access and role recovery

- [ ] Pair an iPhone and Android phone as viewers and verify the first hydrated screen, background/reconnect, and switching between an owner host and a viewer host. Keep a composer, helper, side-question or rename draft open while access changes; preserve its text and restore controls only after full access is confirmed.
- [ ] Read thread/schedule history and answer approval, question and elicitation requests as a viewer. Verify the answer reaches only its originating host/session. Confirm message, helper, goal, queue, project, schedule and terminal mutations are unavailable, and host-browser access explains that it requires full access. For an owner-granted computer screen, verify watch-only frames and unavailable input/takeover controls.
- [ ] Open a native menu or destructive confirmation with full access, change the role, then select the retained action. Queue a message offline and reconnect as a viewer; keep its text visible without sending and verify local cancel/edit recovery. Repeat role changes during pending reads and delivery.
- [ ] Keep device-local preferences, copy/quote and host connection management usable. Check VoiceOver/TalkBack explanations and focus when controls become read-only. Repeat the corresponding menus, bulk actions, rules/environment editors and provider/browser settings on a packaged desktop with two paired hosts.

## SDK 58 native upgrade

- [ ] Rebuild the development clients with SDK 58 / React Native 0.88 and install on both platforms. Verify scene startup, native tabs/icons, scroll-header integration, camera, sharing, notifications, widgets and WebView terminal/interactive content. Bundle exports do not validate native compilation.
- [ ] Exercise computer-use WebRTC against a real host after rebuilding. Expo Doctor still reports react-native-webrtc as untested on the New Architecture; the local ramu-discovery and ramu-speech modules have no React Native Directory metadata. Verify their discovery, permission and dictation flows in the rebuilt clients.

## Interactive cards

- [ ] Open a thread containing multiple interactive documents. Verify automatic rendering, compact actions, three-frame eviction and explicit Reload after renderer failure. Scroll offscreen, switch screens and background/foreground the app; confirm stopped views restore their latest declared controls without duplicate execution or lost drafts.
- [ ] Switch Preview/Code, select each project file, copy source text and inspect a binary asset. Source must stay inert. Expand/close with a scenario edited; verify safe areas, focus and state on iOS/Android, including large text and screen readers.
- [ ] Use Content actions to save/restore scenarios, choose values, browse revisions, reset, share runnable HTML and bundled source, and stage a follow-up without sending. Repeat offline with cached documents and with two hosts. Measure memory and scrolling with three live WebViews.

## Hosts and lifecycle

- [ ] Pair by camera/QR and manual entry on real local networks; verify camera and local-network permissions, denied permissions, direct HTTPS and private-network routes.
- [ ] Connect two hosts, stream from both, switch views, and open notifications without mixing state or reconnecting the unaffected host.
- [ ] Exercise sleep, network loss, background/foreground and service restart. Recover transcript, pending input, drafts and terminal output without duplicates.
- [ ] Revoke one device/host during a stream; show the pairing recovery state, stop retries and leave other hosts working. Forgetting a host clears its local state.

## Input, terminal and accessibility

- [ ] Check software-keyboard animation, avoidance, IME/composition, external keyboards, paste and rotation on both platforms.
- [ ] Exercise terminal touch feel, scrollback, arrow holds/repeats, modifier keys, reconnect/release cancellation and shell/vim/less/tmux behavior. Check gesture alternatives with accessibility enabled.
- [ ] Verify long conversations, large diffs and terminal performance on devices.
- [ ] Check large text, screen readers, focus/labels, safe areas, contrast, reduced motion and English/Indonesian layouts.
- [ ] Exercise approvals, questions, elicitation, attachments, host folder/repository actions, Git/undo and timezone-aware schedules against the correct host. Check stale previews and ambiguous mutation recovery in disposable repositories.

## Push, Live Activity and limits

- [ ] Deliver background push from two hosts to a suspended phone, route taps to the right thread/page, deduplicate foreground alerts and unregister revoked registrations.
- [ ] Verify real APNs delivery and Dynamic Island/Lock Screen rendering on a provisioned iPhone. Simulator activity creation is not evidence of final physical rendering.
- [ ] Check Android notification permission/channel behavior and the native UI visually on a device.
- [ ] Check the limit tray with large text and the Auto-resume sheet on Android.
- [ ] Against a real limited host, exercise Try again → Still limited → reset/resume, plus auto-resume off and queued messages.
