# Model selection preferences

## Human need and smallest delivery

People should be able to use the providers enabled in Ramu without building a model set first, and choose a selection flow that fits their desktop or phone. Deliver a useful generated default set plus an explicit Settings choice between the existing step selection and simple **Model → Effort** selection. Both flows configure the same thread settings and retain drafts, access policy and fallback behavior.

## Dynamic default set

Choose defaults from the active combination of Claude, Codex, Antigravity and Cursor selected in Ramu. Extend the host-owned provider catalog, `recommendedSets` and model-preference migration rather than adding a second routing system. Start with one generated set whose models and real effort names are available from enabled providers. Preserve user-edited sets and explicit default choices.

Define and review the preferred model/effort order for each active combination, with deterministic fallback when a provider is disabled, unavailable or has an incomplete catalog. Do not claim a universally best model without task evidence. Explain an unavailable selection and offer a clear correction rather than silently replacing a reviewed draft or running thread.

## Selection flow and mobile preferences

Add a choice in existing Settings between **Steps** (the current model-set/step selection) and **Model then effort** (choose a model, then one of its actual supported efforts). Show the effective choice in desktop and phone settings. A model with no independent effort options needs only model selection. Switching flows preserves the selected provider/model/effort, the composer and existing custom sets; it does not send a message or start work.

Selection flow and default model choices participate in the shared [mobile settings preferences plan](MOBILE-SETTINGS-PLAN.md). That plan also covers appearance, language, reading, composer and notification preferences; its scope controls are not limited to model selection.

## Existing services and boundaries

Extend `ModelPreferences`, `recommendedSets`/`migrateModelDefaults`, the model picker/bar, existing Settings and mobile model controls. Keep provider availability and execution configuration on the selected host behind the typed API. Reuse device storage/state for phone identity and local overrides. Keep shared preference synchronization separate from execution-host settings: define the existing profile/account or pairing mechanism that can carry the global/mobile baseline before promising cross-device propagation. If no suitable shared preference transport exists, include it as an explicit prerequisite and show its availability; a host preference must not masquerade as a global preference. Do not copy provider credentials or workspace state into device preferences.

Migrate existing selection behavior without losing custom sets, selected defaults or per-device drafts. Version the shared preference contract, preserve older-host compatibility and discard stale host/device responses. Offline phone overrides remain usable; shared saves need visible pending/error states and safe retry.

## Acceptance

- Cover all single-provider and mixed combinations, no available provider, incomplete catalogs, catalog refresh/reconnect and changes to the active combination. A generated set cannot select disabled providers or unavailable models.
- Validate a representative task by starting with generated defaults, moving through steps, switching to model/effort selection and back, and retaining the draft and execution policy.
- Test explicit effort choices, real provider defaults, models without separate effort options and preservation of edited sets/defaults during migration.
- With a desktop and two phones, verify global changes, mobile-only changes, one-phone overrides, clearing overrides and visible inheritance. Include offline saves, reconnect/restart, failed persistence, concurrent changes and older hosts.
- Verify localization, keyboard/focus behavior, screen readers and narrow/large-text phone layouts. Extend existing shared/server/web/mobile tests around observable behavior. Desktop-facing implementation requires `pnpm build` followed by `pnpm test:desktop-smoke`.

Later: task-specific ranking after evidence that the initial ordering needs it.
