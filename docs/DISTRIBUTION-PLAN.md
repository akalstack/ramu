# Distribution and trust plan

Review of release readiness, 2026-10-17, made from `README.md`, `docs/RELEASING.md`, `apps/mobile/PLAN.md` and `apps/mobile/VERIFICATION.md`. Nothing here is implemented yet.

This is the largest gap between Ramu and the products it competes with. The features are broad; the delivery is not. Cursor, Zed and T3 Code ship signed, auto-updating builds on every platform they support.

## Findings

Ordered by impact.

1. **Unsigned, un-notarized macOS builds.** CI builds are unsigned, so users meet Gatekeeper warnings. Automatic updates need a signed app and exclude prereleases, so every alpha update is manual.
2. **Platform coverage.** Releases target macOS arm64/x64 and Linux x64. Linux packaged GUI validation is pending, and Windows has no release matrix entry or downloads.
3. **Mobile is built from source only.** There are no store or TestFlight builds. Distribution needs an owned Expo project and APNs/FCM credentials, and push has not run on a device.
4. **Device acceptance is pending.** `apps/mobile/VERIFICATION.md` lists camera pairing, local network, background push, Live Activity and Android visuals as unchecked.
5. **Thin UI regression coverage.** There is one desktop smoke test by design. That is a sound policy, but it leaves UI regressions in large screens (for example `Automation.tsx`, about 779 lines) mostly unguarded.
6. **Stale docs.** `docs/HEADLESS-SERVER.md` claimed mobile was outside the alpha and had no QR pairing. It was fixed on 2026-10-17; check the other docs for the same drift at each release.

## Plan

1. **Sign and notarize macOS.** Add an Apple Developer ID, store the certificate and notarization credentials as CI secrets, and sign and notarize in the release workflow. Check the packaged app with `RAMU_PACKAGED_EXECUTABLE` and `pnpm test:desktop-smoke`. This unlocks step 2.
2. **Auto-update.** Turn on automatic installation for signed releases and publish a stable channel next to prereleases. Document the channels in `docs/RELEASING.md`.
3. **Validate Linux.** Run the packaged GUI on a clean Linux x64 machine, record the result in `docs/RELEASING.md`, and remove the "pending" note from the README when it passes.
4. **Windows decision.** Either add a Windows x64 target with a smoke run in CI, or state that Windows is unsupported. Experimental with no downloads is a limbo that costs trust.
5. **Mobile acceptance and TestFlight.** Work through `VERIFICATION.md` on a physical iPhone and an Android phone, set up the Expo, APNs and FCM credentials, then ship TestFlight and an Android internal track. Do this after `REMOTE-SECURITY-PLAN.md` steps 1–3.
6. **Targeted UI tests.** Add focused unit tests for form and state logic in the largest screens, per the repo's testing rules, instead of a new end-to-end suite.
7. **Docs check in the release checklist.** Add a line to `docs/RELEASING.md`: compare README, `HEADLESS-SERVER.md` and the mobile README against shipped behavior.

## Order

1, 2, 3, 4 are release infrastructure and can run alongside the other plans. 5 depends on the remote security work. 6 and 7 are small and can land any time.
