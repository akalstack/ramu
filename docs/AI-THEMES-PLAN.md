# Remaining theme work

Current appearance, manual/AI editing, trials and sharing are documented in [Themes](THEMES.md). Finish consistent control styling and native acceptance so a person can try a look during an ordinary task, read every request and recover without losing work.

## Existing services to extend

Follow [Architecture](ARCHITECTURE.md), [UI](UI.md) and the [planning guidance](../AGENTS.md#planning-docs). Extend the shared theme schema/validator, device-owned theme stores, `theme.generate`, proposal cards and existing editor/preview. Keep generation behind provider adapters and application behind native Keep/Revert; do not add another theme service or let generated content apply a theme.

Compose desktop controls outside upstream-owned `components/ui/`; reuse mobile controls and tokens. Preserve refs, menu triggers, form submission, disabled propagation, focus, touch targets and accessibility. Theme changes must not alter host permissions, workspace state, navigation or unrelated device preferences.

## Remaining delivery

- Audit specialized controls in `styles.css`, feature wrappers and mobile gesture surfaces for conflicting color/state overrides. Review semantics before replacing raw controls. Migrate repeated styling into shared app variants and remove superseded constants/selectors. Keep only unfinished inventory items and justified exceptions; expand existing color-literal/shared-button guards as scopes migrate.
- Audit production preview coverage for menus, forms, SCM, permission/queue/status cards and specialized controls in both appearances and a custom palette. Verify hover/pressed, focus, disabled, loading and selected/expanded states, including semantic status and chart distinctions. Preserve width/status announcements while loading.
- Reconcile the original editor requirements with current controls: role search/grouping, role selection from the dedicated preview, group reset, derived-role explanations, targeted readability repair and optional recipe/attribution metadata. Implement only demonstrated workflow gaps; do not treat existing editing, generation or sharing as unstarted phases.
- Verify device storage, startup fallback and cross-window selection with upgraded profiles, invalid/missing themes and failed writes. A failed Keep must not leave a missing active theme; stale generation results must not replace the latest draft. Existing font, size, accent and accessibility choices must survive migration.
- Complete native file/share-sheet import/export and any demonstrated platform gaps through the same validator and preview. Verify duplicate IDs/digests, changed versions, unsupported schemas, bounded input, escaped metadata and inert recipe text. Exact sharing must preserve token values without AI or silent repairs.

## Acceptance

Representative task: choose an appearance, read a thread and code changes, edit a color, ask AI for a refinement, undo it, try and revert, then keep and share the result with a second installation. The recipient previews before keeping; neither device changes the other's appearance. Include an offline manual-edit/revert path and an unavailable/limited provider without losing the draft.

- On packaged desktop and physical iOS/Android, check system appearance changes, startup/splash, native headers/sheets, code/diffs, ANSI terminal colors and every critical request/stop/send control. Verify large text, reduced motion, keyboard/focus and screen readers. OS-owned materials need supported appearance inputs rather than identical pixels.
- Verify app restart/close during trials, multi-window updates, cancellation, failed persistence, malformed imports and stale AI responses. Recovery/reset must stay readable independently of custom colors. Imports and proposals cannot execute instructions, edit source or bypass Keep.
- Verify interactive content retains scenario/control state through theme updates, visibility changes and frame disposal. Use the production preview and isolated document boundary described in [UI](UI.md).
- Preserve focused schema/digest/migration/contrast, manual editing/locked-role, generation repair/cancellation and storage/import regression coverage. Add tests for gaps found, then run affected package tests/types. Desktop implementation requires `pnpm build` followed by the existing `pnpm test:desktop-smoke`.
- Verify English/Indonesian copy, native sharing and appearance/accessibility on each platform before closing the plan. Automated contrast and synthetic checks do not establish native readability or user preference.

## Later options

Galleries, marketplaces, hosted links, automatic cross-device sync, external theme formats, OS file associations, custom CSS/layout/font/wallpaper packs and executable theme plugins are outside this delivery. An optional paired-device transfer must still require recipient Preview/Keep; pairing never implies appearance synchronization.
