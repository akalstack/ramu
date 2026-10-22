# Remaining model selection work

Current generated sets and selection controls are documented in [UI](UI.md#new-thread-model-defaults). Follow [Architecture](ARCHITECTURE.md), [UI](UI.md) and the [root product and planning guidance](../AGENTS.md#product-design-and-architecture). Extend `ModelPreferences`, the existing host-owned catalog/settings API and desktop/mobile controls; preserve drafts and explicit settings.

## Remaining delivery

The selection flow resolves through the shared scopes: the host setting (all devices), a mobile layer stored on the paired host (`preferences.layers.*`, host-paired phones share it) and a phone-local override, with visible source, **Use inherited setting** and pending/error state (see [UI](UI.md#new-thread-model-defaults)). What remains is:

- Cross-host sharing: the mobile layer lives on each paired host, so a phone paired to two hosts can hold different shared values. A profile or account transport that follows the person across hosts is not designed; extend the same layers only after a concrete mechanism exists, and keep showing the host prerequisite until then.
- Clearing a shared override deletes it without a tombstone, so a much older offline write from another phone could reapply it. Add tombstones if this appears in acceptance.
- Extending the same transport to the other fields in the [mobile settings plan](MOBILE-SETTINGS-PLAN.md).

**Easier for the person:** One choice can cover every device, with a one-click clear for the exceptions, so the person does not reconfigure each phone.

## Remaining acceptance and recovery

- Validate the complete representative task on desktop, iOS and Android: begin with enabled-provider defaults, move through steps, choose Model then effort and switch back without replacing the selected provider/model/effort, draft or execution policy. Include models without a separate effort control, catalog refresh/reconnect and disabled providers.
- Verify the no-available-model case through actual onboarding, Settings and composers. Before any usable catalog arrives, legacy placeholders remain unavailable choices; they must never authorize a launch or imply that Codex is installed.
- Confirm that a removed explicit default is visibly unavailable and can be corrected without silently changing reviewed drafts or running threads. Older unmarked sets whose generation cannot be proven remain user-owned; verify the explicit Restore model sets recovery path rather than guessing whether they were edited.
- With a desktop and two phones, verify global changes, mobile-only changes, one-phone overrides, clearing overrides and visible inheritance after the shared transport exists. Include offline saves, reconnect/restart, failed persistence, concurrent changes and older hosts.
- Verify localization, keyboard/focus, screen readers and narrow/large-text layouts on physical devices. In particular, changing the host's flow while a mobile model sheet is mounted must refresh its presentation without choosing a model or sending work.
- Extend focused tests around remaining behavior and real package boundaries. Desktop-facing implementation requires `pnpm build` followed by the single `pnpm test:desktop-smoke`.

Later: task-specific ranking after evidence that the deterministic provider grouping and catalog-supported steps are inadequate. Do not claim a universally best model without representative task evidence.
