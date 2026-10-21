# Remaining model selection work

Current generated sets and selection controls are documented in [UI](UI.md#new-thread-model-defaults). Follow [Architecture](ARCHITECTURE.md), [UI](UI.md) and the [root product and planning guidance](../AGENTS.md#product-design-and-architecture). Extend `ModelPreferences`, the existing host-owned catalog/settings API and desktop/mobile controls; preserve drafts and explicit settings.

## Remaining delivery

A person with a desktop and two phones can choose a selection flow for all devices, all mobile devices or one phone, see where the effective choice comes from, and clear an override. Deliver the shared preference transport and scope controls through the [mobile settings preferences plan](MOBILE-SETTINGS-PLAN.md). The current setting belongs to one execution host and affects clients using that host; it is not an account-wide or mobile-only preference.

**Easier for the person:** One choice can cover every device, with a one-click clear for the exceptions, so the person does not reconfigure each phone.

Keep provider availability and execution configuration on the selected host. Reuse device storage for phone identity and local overrides. Define a suitable profile/account or pairing mechanism for a shared baseline before promising cross-device propagation. If unavailable, show that prerequisite explicitly. Do not copy provider credentials or workspace state into device preferences.

Version the shared preference contract, preserve older-host compatibility and discard stale host/device responses. Offline phone overrides remain usable; shared saves need visible pending/error states and safe retry. Reuse the existing Settings patch concurrency checks rather than replacing whole model sets to change a presentation preference.

## Remaining acceptance and recovery

- Validate the complete representative task on desktop, iOS and Android: begin with enabled-provider defaults, move through steps, choose Model then effort and switch back without replacing the selected provider/model/effort, draft or execution policy. Include models without a separate effort control, catalog refresh/reconnect and disabled providers.
- Verify the no-available-model case through actual onboarding, Settings and composers. Before any usable catalog arrives, legacy placeholders remain unavailable choices; they must never authorize a launch or imply that Codex is installed.
- Confirm that a removed explicit default is visibly unavailable and can be corrected without silently changing reviewed drafts or running threads. Older unmarked sets whose generation cannot be proven remain user-owned; verify the explicit Restore model sets recovery path rather than guessing whether they were edited.
- With a desktop and two phones, verify global changes, mobile-only changes, one-phone overrides, clearing overrides and visible inheritance after the shared transport exists. Include offline saves, reconnect/restart, failed persistence, concurrent changes and older hosts.
- Verify localization, keyboard/focus, screen readers and narrow/large-text layouts on physical devices. In particular, changing the host's flow while a mobile model sheet is mounted must refresh its presentation without choosing a model or sending work.
- Extend focused tests around remaining behavior and real package boundaries. Desktop-facing implementation requires `pnpm build` followed by the single `pnpm test:desktop-smoke`.

Later: task-specific ranking after evidence that the deterministic provider grouping and catalog-supported steps are inadequate. Do not claim a universally best model without representative task evidence.
