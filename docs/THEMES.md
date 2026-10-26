# Appearance and custom themes

Settings → Appearance keeps appearance and theme selection on the device. Desktop offers Match device / Light / Dark and preserves Dark for existing profiles; mobile offers System / Light / Dark. Selection does not require a provider. Custom themes change colors while retaining Ramu's layout, controls and accessibility preferences.

## Edit and try

**Customize colors** edits both appearances of the same theme draft. The editor supports exact colors, per-role reset, Undo/Redo and a preview of the selected appearance. Manually changed roles stay locked during AI refinement until released. Readability checks reject invalid foreground/background pairs and indistinguishable success, warning and error colors.

A trial is temporary and is not persisted. **Keep theme** validates, saves and selects the theme; **Revert**, closing the editor or restarting restores the saved selection. The recovery controls use a fixed readable palette. Desktop trials affect the current window. Kept desktop themes use device storage shared by host windows; they are not execution-host preferences.

The [production-component preview](UI.md) includes thread/request states, code/diffs, terminal output and interactive content. Custom colors map to app chrome, terminal and Monaco workbench surfaces; syntax token colors retain the editor's GitHub palette. Interactive documents receive appearance updates without resetting their controls.

## Generate or refine

The editor calls `theme.generate` through the execution host's default maintenance model, using the current draft and feedback. Validation failures feed a bounded repair loop; invalid results remain unkeepable. **Another direction** tries up to three directions per wish; **Compare 3** requests three candidates, each consuming provider usage. Up to three image references use ordinary host attachments and are not stored in the theme. Undo returns to previous candidates.

An agent can offer a validated draft with `propose_theme`. **Preview theme** opens the same trial and Keep/Revert flow. On a phone it opens Appearance with a phone-local trial. The tool cannot save or apply a theme permanently.

## Share

Export a kept theme as `<id>.ramu-theme.json` or copy its JSON. File and pasted-JSON imports go through validation and preview before Keep. A digest detects changed data, not author identity; an edited file is flagged and a changed copy of an installed ID becomes a separate theme. **Copy recipe** copies a short Markdown creation prompt rather than the conversation.

Theme data uses the shared versioned schema and explicit colors. Imports are data, not instructions or executable CSS. Device preferences, provider credentials and reference attachments do not belong in theme exports. Selecting or sharing a saved theme needs no model call.

Remaining audit and acceptance are in the [theme plan](ROADMAP.md).
