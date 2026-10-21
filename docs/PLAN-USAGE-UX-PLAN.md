# Remaining plan usage work

The shared presentation model, mobile Threads summary/header target, shared host/account detail sheet, settings reuse and thread Usage chip are implemented. Desktop detail preserves all allowance windows and distinguishes notice-only holds. See [UI](UI.md#plan-usage-detail).

## Delivery

A person can tell whether the next message can run, inspect the correct account when needed and choose the existing limit action. Keep the ordinary composer to its current compact usage target; allowance windows and account diagnostics belong in the shared detail sheet. Deliver authoritative account/routing identity and truthful unknown states before adding more summaries. Validate that an old reading or unavailable account does not send the person to the wrong login or imply that a held thread is ready. Follow the [root product and planning guidance](../AGENTS.md#product-design-and-architecture) for this and later increments.

**Easier for the person:** The person learns before sending whether the message can run and which action unblocks it, instead of discovering it after a failure.

## Ramu design and architecture

Follow [Architecture](ARCHITECTURE.md) and [UI](UI.md). Extend the current usage chip, shared account sheet and the fallback controls in Settings → Models, using composed desktop controls outside `components/ui/` and existing native mobile components/tokens. Derive next-message identity from the existing server routing/usage collaborators through validated named methods; do not predict it independently in a client or add another polling/fallback engine. Preserve host/account-qualified queries and event invalidation, old-host capability handling and the separation between device visibility preferences and host routing policy.

## Remaining implementation

- Window labels and scope explanations are covered by shared English/Indonesian tests, and desktop and mobile both localize reset text. Routing and presentation share provider-aware model-scope applicability; validate additional provider model identities with live evidence.
- Validate account detail event refresh and old-host handling against real paired hosts. Physical network-loss and upgrade acceptance remain.
- Verify on native devices that the icon-only header action and per-provider window counts fit at large text, and that the Access & Fallback link preserves the selected host and localized offline wording.
- Extend focused native component tests to effective next-message account identity; run physical iOS/Android accessibility and composer/keyboard acceptance. The host's `agent.nextRoute` projection feeds the desktop and mobile thread labels (older hosts keep the local estimate/selection) and is covered by a server test; native component tests of the mobile label and device acceptance remain.

## Acceptance and verification

- Focused shared tests: five-hour/weekly/model-specific bottlenecks, account matching and unknown account, same provider across hosts, disabled providers, unknown/stale/reset-past data, notice-derived holds, invalid percentages and deterministic ties. No cross-host sum or silent replacement of missing data with zero.
- Focused mobile tests: summary host selection, thread's effective account, routing unknown, sheet dismissal/host change, refresh failure/unsupported method, offline data and visibility preference. Reuse existing limit-tray tests for actual holds rather than reimplement its behavior.
- Run shared/mobile tests and types for those changes. When desktop rendering changes, also run web tests/types, `pnpm build`, then the single `pnpm test:desktop-smoke`; never add another desktop end-to-end suite.
- On iOS/Android verify the summary is discoverable, sheet uses the right host, keyboard/composer and activity row fit at large text, touch targets meet platform expectations, VoiceOver/TalkBack explains used/window/reset and context separately, and limit notices remain visible with passive usage hidden.
