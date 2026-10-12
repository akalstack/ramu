# Remaining work

Source audit: 2026-10-11. Compared the planning documents with the current code. This is a backlog, not a claim that every integration has been tested against a live provider. The original [PLAN.md](PLAN.md) describes an older task/tab model; current navigation is Project → Chats.

## Suggested order

| Priority | Work | Current gap and evidence |
| --- | --- | --- |
| 1 | Native provider commands and notices | The slash menu contains Ramu commands and discovered skills. Claude `supportedCommands()` / `commands_changed` are not connected. Retry, notification, permission-denied and prompt-suggestion events have no dedicated handling. |
| 2 | Isolation completeness | `isolation.ts` snapshots tracked changes using `git stash create`; untracked files are omitted. Conflicting child patches are preserved and reported, with no merge/apply recovery UI. Isolated helpers reject follow-up messages. |
| 3 | Codex protocol typing and native controls | Consumed messages use `Wire = Record<string, any>`. Generate protocol types from the installed CLI and narrow sub-agent states/activity fields. Test direct native-helper messaging/stopping before replacing the current relay through the main agent. |
| 4 | Explicit compaction and native continuation | Automatic compaction events already appear in chat, and Aside already uses a Codex fork. Manual compact, native fork for Continue in new chat, and Codex native review mode are not exposed. Continue currently transfers visible conversation context. |

Claude file checkpoints are intentionally not enabled. The chosen design uses Ramu's own engine consistently for all providers and fallback chains. Undo now lives under chat Edit, combines the selected run and later captures, and preserves chat history. Native Codex conversation rollback does not restore files; partial native file tracking would split this behavior across providers. Messages sharing a capture through steering still need the first message of that run as their file restore point.

## Other product work from the original plan

- **GitHub PR workflow:** no app-level create/link/publish PR workflow or multi-repository PR dependency tracking. Git commit, sync, history, stashes, pull modes, and merge/rebase Continue/Abort are already present.
- **Checks tied to a revision:** agents can run tests, but there is no dedicated configured-check runner with persisted results and invalidation when the tested content changes.
- **Git conflict resolution UI:** conflicted files can be opened, edited, staged and continued. A dedicated base/ours/theirs merge editor remains a separate improvement. The editor's unsaved-buffer conflict comparison is already implemented.
- **Broader language support:** TypeScript/JavaScript language servers are present; Python/Go/Rust have formatter/linter support but no language-server adapters. Real rustfmt verification remains outstanding in the tooling notes.
- **Provider recovery validation:** native helper history now reloads across historical provider sessions after fallback. Installed live-provider transcript compatibility and explicit native-helper continuation remain; recovery reads history and lets the main agent reconcile unfinished work.
- **Focused interaction validation:** IMPLEMENTATION.md still marks bulk tab menus and Reveal in Explorer as unvalidated. The smoke scripts do not contain explicit assertions for those interactions; the general smoke pass does not establish those cases.
- **ui-smoke is stale:** `scripts/ui-smoke.mjs` has not matched the Source Control UI since before the last commit (the repository dropdown became collapsible sections). The duplicate-tab check (pins with double-click because preview tabs are on by default) and repository selection (`scmRepo`) are updated; the run now stops at `src/server.ts` in the api section (~line 197), where the change rows are labelled differently. Update the remaining Source Control steps to the current panel. `automation-smoke`, `workspace-layout-smoke`, `i18n-smoke` and `tool-status-smoke` pass.
- **Release readiness:** signing/notarization is not configured in CI; Windows needs background transport support and validation; Linux has no packaged GUI smoke test. Real provider authentication and packaged macOS login startup need installation-level validation. No automatic update channel is configured.
- **Hardening and product validation:** accessibility/performance checks for large repositories and long chats, pilot users, and the real two-repository demo remain release work rather than missing core navigation.

## Already done; remove from old backlog lists

Codex MCP form/link input requests with typed validation, drafts and explicit decline/cancel, Codex live command output, patch snapshots and turn diffs, Claude main/helper text streaming with completed-block deduplication, saved helper recovery across historical provider sessions, default-on questions while independent work continues (related groups, independent replies, dependency waits, late answers, pending-question list, durable drafts and obsolete/dismissed states), automatic unfinished-chat continuation after restart with a default-on setting, sub-agent cards/panels/messages/stop, background checkout ownership, sidebar working status, cross-provider helpers, usage/context gauges, pre-emptive fallback and chains, Codex opt-in spawn hook and message-boundary refresh, quote/asides with provider forks, thinking rows, project-free chats, schedules/recaps, recorded change comments and Undo, chat search, and direct new-chat navigation are implemented.

Known Codex behavior: without the opt-in hook, routing changes apply at the next message boundary and native per-type rules cannot inspect calls. Already-running native agents cannot be moved. These are current constraints, not unfinished hook integration.

## Documentation cleanup

- AGENTS-NEXT.md contains completed implementation notes followed by the original “Planned” specifications. Read those specifications as historical design, not an open checklist.
- IMPLEMENTATION.md still describes one-step fallback and fast-forward-only pull; current routing supports chains and Git supports merge/rebase pull choices.
- EDITOR-TOOLING.md says format on save is off by default; current `DEFAULT_APP_PREFERENCES` enables it.
- UI-AND-RELEASES.md's logo paragraph predates the current flat branding.
- PLAN.md's outer task tabs and Agents rail are historical; the current hierarchy is Project → Chats, with shared workspace files and terminals.
- Window bar: project actions (saved per project via `projects.actions` / `projects.setActions`, run in a titled terminal at the chat's workspace; shortcuts join the command list) sit before the panel toggles. "Open in editor" and a header "Commit & push" button were tried and removed: file editing and Source Control already cover them. Commit & Push is a command instead (⌘⌥P, `commitShortcut.ts`) with VS Code's smart-commit rule: staged changes only, or every change when nothing is staged (what T3 Code always does).
- Search chats (sidebar search icon, ⌘K) is a palette-style dialog: titles match as you type, and `agent.searchMessages` searches user and agent message text across chats; opening a message match pre-fills Find in conversation.
- shadcn components: `src/renderer/src/components/ui/` is owned by the shadcn CLI (`npx shadcn@latest add <name> --overwrite`) and stays exactly as the registry ships it. Ramu behaviour lives in composed components beside it (`components/app-toaster.tsx`, `overlay-scroll-area.tsx`, `step-slider.tsx`, `anchored-tooltip.tsx`) or in `styles.css` keyed on `data-slot` (positioner z-index above dialogs, explicit lucide icon sizes, borderless Empty). Toasts use shadcn's Base UI Toast via `notify` (Sonner is gone); toasts are `role=dialog`, so dialog checks must exclude `[data-slot=toast]`.
- There is no activity rail. The sidebar's top rows are New chat and Schedules, the wordmark is Home, and Settings sits at the sidebar's foot. Surfaces are told apart by shade, not outlines: controls use `--fill`, floating surfaces keep a faint `--edge`, and corners come from the one radius scale in `styles.css` (`--radius-xs/s/row/m/l/xl/full`).

Recommended next implementation: native provider commands and notices, followed by isolation completeness. These improve existing daily workflows before adding more provider-specific features.
