# Remaining configuration-file work

Current storage, migration, repository actions and workspace/commit defaults are documented in [Configuration files](CONFIGURATION.md). Follow [Architecture](ARCHITECTURE.md), [UI](UI.md) and the [root planning guidance](../AGENTS.md#planning-docs). Extend the existing host-owned settings store, project loader, named API and Settings/action/composer surfaces.

## Remaining delivery

A person can see which repository supplies a default, correct invalid configuration and choose a provider/model for a new thread without granting repository content additional authority. Preserve explicit draft/session choices and intact drafts on unavailable providers or invalid configuration.

**Easier for the person:** New threads start with the right provider and model, and invalid configuration points to its own fix instead of a silent failure.

## Remaining implementation and acceptance

- Align repository model defaults with [automatic project selection](ASSISTANT-WORKFLOW-PLAN.md#1-automatic-project-selection-default) once it lands, so an inferred project applies its defaults with the same draft precedence.
- Complete desktop startup and watcher validation for repository model defaults in a supported environment. The restricted 2026-10-19 run built successfully, but Electron launch aborted with `SIGABRT`/`kill EPERM`, and an isolated `fs.watch` probe reported `EMFILE`. Re-run the existing desktop smoke and settings-watcher checks before treating this delivery as release-validated.
- Verify Settings, repository model-default recovery and source/error indicators on desktop and physical iOS/Android, including keyboard shortcuts, screen readers, large text, same-named projects on different hosts and remote offline recovery. Verify external global settings edits update every connected client and background service in a running packaged app.
- Extend migration/corruption acceptance to real upgraded profiles and abrupt process termination. Existing automated tests exercise real SQLite migration/archive retention, editor atomic renames, invalid files, combined validation, failed replacement and abandoned temporary writes; these do not establish power-loss behavior on every supported filesystem.
- For each remaining implementation, add focused behavior tests and relevant typechecks. Run `pnpm build` followed by the single `pnpm test:desktop-smoke` for desktop-facing changes. Retain device and packaged-app evidence separately from simulated tests.

Remove finished items and delete this plan when none remain.
