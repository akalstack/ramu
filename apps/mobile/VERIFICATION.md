# Outstanding mobile acceptance

This checklist contains only checks still requiring device, account or live-provider evidence. Existing unit/integration tests and prior simulator/browser checks do not establish physical-device acceptance. Setup and current capabilities are in [README](README.md); unfinished implementation is in [PLAN](PLAN.md).

Use disposable host profiles and simulated providers where possible. Paid live-provider calls remain opt-in. Remove a check when it passes and put any lasting setup requirements in README or the release guide.

## Devices, accounts and distribution

- [ ] Own the Expo project ID, bundle/application identifiers and signing/distribution accounts. Configure APNs/FCM credentials and produce signed device builds.
- [ ] Run the acceptance flows on a physical iPhone and Android phone. Native scroll integration and Live Activities require development/native builds; Expo Go cannot validate them.
- [ ] Publish and install TestFlight and Android internal-track builds after the applicable remote-security gates.

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
