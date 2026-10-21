# Mobile settings preferences

## Human need and delivery

People may want larger text, a different appearance, quieter notifications or simpler model controls on a phone while keeping familiar desktop preferences. Add reusable scope controls to suitable existing Settings rows, beginning with appearance, language, text size and model selection. Extend the same mechanism to the selected preferences below. This is shared settings work, not a model-picker-only feature.

**Easier for the person:** A preference is set once for the right scope, and the person sees where a value comes from without opening each device.

## Copy and interaction

Use **Apply to** as the scope label, with these choices:

- **All devices** — Use this setting on desktop and mobile.
- **All mobile devices** — Use this setting on phones and tablets.
- **This phone** — Use this setting only on this phone.

On a tablet, use **This tablet**; use **This device** when the device type is unknown. Scope choices describe where the preference applies, not the host a phone happens to be connected to. Explain once near the control: **Devices with their own setting keep it.**

Resolve each preference from the device override, then the mobile override, then the all-device baseline. Display its source as **Using all-device setting**, **Using mobile setting** or **Set on this phone**. Offer **Use inherited setting** to remove a narrower override; preview the inherited value before saving. Changing the broader baseline preserves narrower overrides. Show the intended scope before saving, preserve unsaved changes on failure and support safe retry. Unsupported scopes should explain their availability rather than appear to save successfully.

## Preferences to support

- **Appearance and reading:** appearance mode (System/Light/Dark), accent, interface language, interface text size and reduced motion. Keep System relative to each device's OS, use platform-appropriate text sizes instead of copying desktop pixels, and honor stronger OS accessibility requirements. Coordinate theme work with the [appearance plan](AI-THEMES-PLAN.md).
- **Model controls:** Steps versus Model then effort, preferred default set/step or model/effort, and favorite models. Reuse the [model selection plan](MODEL-SELECTION-PLAN.md); validate model identities against the selected execution host without rewriting the saved preference when a model is unavailable.
- **Composer behavior:** queue versus steer while an agent is busy, and the model-change warning. Apply defaults to future actions and retain existing drafts and explicit thread choices.
- **Notifications:** whether to notify about agent completion, input requests and failures. Scope the user's preference separately from OS permission and device registration; a save never grants permission on another device. Keep delivery deduplication and existing foreground/background behavior.

Use the same resolver and scope control for these fields, with per-field capability checks. Reuse existing settings rows, device storage/state and typed contracts. Keep advanced scope details optional, while always showing the effective source.

Keep hardware/platform behavior local where sharing adds no value: haptics, biometric/app lock, push registration and OS notification permission. Desktop-only editor/terminal layout and font settings stay with their existing device scope. Provider enablement, credentials, binaries, execution permissions, fallback routing, memory, workspace/Git defaults and background jobs retain their host/project scope; the mobile settings scope picker does not change them.

## Storage, migration and recovery

Keep shared preference synchronization separate from execution-host settings. Establish which existing profile/account or pairing mechanism carries the all-device baseline and mobile overrides before promising cross-device propagation. If there is no suitable transport, make that a delivery prerequisite and expose availability honestly. Device identity and overrides remain in device storage; do not synchronize credentials or workspace state.

Preserve existing desktop and phone choices during migration rather than replacing them with a new shared baseline. Version each supported field's contract, handle unsupported settings on older clients and avoid last-write-wins replacement of unrelated fields. Offline local overrides work immediately; shared edits retain visible pending/error states with conflict-safe retry. Switching hosts must not switch a phone's display preferences. Display changes cannot mutate execution settings or send a message.

## Acceptance

Use a desktop and two phones to change appearance, text size, notification preference and model controls independently at every supported scope. Verify effective-source copy, existing narrower overrides, clearing an override, unsupported scopes and localization. Confirm a mobile-only change leaves desktop behavior intact and a this-phone change leaves the second phone intact.

Cover offline edits, concurrent field changes, failed persistence, reconnect/restart, host switching, old-client compatibility and migration of different existing device choices. Test per-field precedence through the same resolver, platform-relative System/text sizing and the distinction between notification preference and OS permission. Verify screen readers, focus, large text and narrow layouts in existing settings surfaces. Run affected package tests/typechecks; desktop-facing implementation also requires the existing build and desktop smoke check.
