# Remaining configuration-file work

Current storage, migration, repository actions and workspace/commit defaults are documented in [Configuration files](CONFIGURATION.md). Follow [Architecture](ARCHITECTURE.md), [UI](UI.md) and the [root planning guidance](../AGENTS.md#planning-docs). Extend the existing host-owned settings store, project loader, named API and Settings/action/composer surfaces.

## Smallest remaining delivery

A person can see which repository supplies a default, correct invalid configuration and choose a provider/model for a new thread without granting repository content additional authority. Preserve explicit draft/session choices and intact drafts on unavailable providers or invalid configuration.

## Remaining implementation and acceptance

- Add repository `agent.preferredProvider` and `agent.preferredModel` defaults through the actual eligible provider catalog and existing new-thread selection on desktop/mobile. Define provenance and draft precedence with [automatic project selection](ASSISTANT-WORKFLOW-PLAN.md#1-automatic-project-selection-default). Repository configuration must never escalate permissions or provide credentials/binary paths. Unsupported and unavailable choices need an actionable fallback with the draft preserved.
- Finish action management behavior for repository-defined ordering and disabling/hiding an inherited action. Current repository actions are read-only definitions with explicit local edit overrides; their source is shown, and deleting their definitions requires editing the file. Preserve future repository changes when editing unrelated local actions.
- Verify watcher recovery for replaced project roots and internal symlink targets. Normal file edits, editor atomic renames, fallback-directory creation, project removal and service disposal have focused filesystem tests; desktop/mobile client tests cover refresh ordering and stale responses while preserving explicit workspace choices. Complete real-host reconnect and native acceptance separately.
- Verify Settings and source/error indicators on desktop and physical iOS/Android, including keyboard shortcuts, screen readers, large text, same-named projects on different hosts and remote offline recovery. Verify external global settings edits update every connected client and background service in a running packaged app.
- Extend migration/corruption acceptance to real upgraded profiles and abrupt process termination. Existing automated tests exercise real SQLite migration/archive retention, editor atomic renames, invalid files, combined validation, failed replacement and abandoned temporary writes; these do not establish power-loss behavior on every supported filesystem.
- For each remaining implementation, add focused behavior tests and relevant typechecks. Run `pnpm build` followed by the single `pnpm test:desktop-smoke` for desktop-facing changes. Retain device and packaged-app evidence separately from simulated tests.

Remove finished items and delete this plan when none remain.
