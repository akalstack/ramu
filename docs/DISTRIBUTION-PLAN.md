# Remaining distribution work

Audited on 2026-10-18. Focused schedule-form tests and the release docs-check checklist are complete and have been removed from this plan. Current release instructions are in [Releasing](RELEASING.md).

## Delivery

A person installs a supported packaged build, opens a thread and can obtain a verified update without configuring development tools. Deliver and validate each supported platform independently; signing, transport and native-device prerequisites remain mandatory for the affected release. Use existing installation/update messages with a specific recovery action. Broader platform availability is not a reason to add a second installer service or delay an otherwise validated platform. Follow the [root product and planning guidance](../AGENTS.md#product-design-and-architecture) for this and later increments.

**Easier for the person:** Install and update need no tooling knowledge, and failures name the single action that recovers them.

## Ramu architecture boundary

Follow [Architecture](ARCHITECTURE.md) and the existing [release workflow](RELEASING.md). Extend current Forge/CI/update and Expo/native packaging paths; desktop remains a thin shell around the same independently runnable server. Keep signing secrets in release infrastructure and device-native dependencies in their owning packages. Packaging must not introduce a separate backend, change RPC authorization or enable host administration. Any setup/update UI uses existing Settings/dialogs and app-composed controls under [UI](UI.md), without changing registry primitives. Reuse the single smoke script for packaged startup validation.

| Work | Dependency and completion condition |
| --- | --- |
| Sign and notarize macOS | Obtain an Apple Developer ID and CI credentials. Forge already reads `RAMU_SIGN_IDENTITY`, `APPLE_API_KEY` (a `.p8` path), `APPLE_API_KEY_ID` and `APPLE_API_ISSUER`; the release workflow still needs certificate/key provisioning and environment wiring. Verify signing/notarization and run the desktop smoke test against the packaged app. |
| Enable signed auto-updates | Depends on signed releases. `APP_AUTO_UPDATE` remains `false` in `packages/shared/src/updates.ts`. Enable installation after signing works, publish a stable channel alongside prereleases and document the channels. |
| Validate Linux | Run the packaged GUI on a clean Linux x64 desktop, record the result in [Releasing](RELEASING.md), and update the README support claim. CI packaging alone does not establish GUI acceptance. |
| Decide Windows support | Owner decision: declare the alpha unsupported, or add a Windows x64 CI build and packaged startup smoke test before offering downloads. The Forge makers exist, but the release workflow does not build Windows. Recommendation: keep it unsupported until macOS signing is established. |
| Distribute mobile builds | Requires owned Expo/signing accounts, APNs/FCM credentials, provisioned devices and the [mobile acceptance checklist](../apps/mobile/VERIFICATION.md). Publish TestFlight and Android internal-track builds after the applicable [remote-security prerequisites](REMOTE-SECURITY-PLAN.md#plan). |

Remove each row when its completion condition is met. Delete this plan when no rows remain.
