# Configuration files

The execution host stores global preferences in `settings.json` in its application data directory, alongside `ramu.db`. Desktop and headless servers use the same profile. Model sets live in the file's `models` field. Operational state, threads, events and schedules remain in SQLite. Device-local drafts and UI state keep their existing device storage.

On upgrade, the host exports existing SQLite preferences and model sets once. It retains the old rows as an archive; subsequent starts read the JSON file. Writes use a verified temporary file and atomic replacement. External edits reload the host's services and notify connected clients. Invalid JSON, invalid preference values and files larger than 2 MiB leave the last valid settings active. On startup with an invalid file, built-in defaults remain active. Correct the file before saving through Settings: a save refuses to overwrite invalid manual edits.

The file uses the same flat preference names as the settings API, for example:

```json
{
  "language": "en",
  "accent": "teal",
  "defaultCheckoutMode": "worktree",
  "worktreeBranchNaming": "fixed",
  "worktreeBranchPrefix": "task/"
}
```

Omitted fields use built-in defaults. Existing unknown fields survive Ramu writes for compatibility. The file can include local provider binary/account configuration; keep it private and do not commit it to a repository. Provider credentials remain in their existing account stores.

## Repository configuration

An optional `ramu.json` at the registered project's root supplies team defaults. If absent, Ramu checks `.ramu/config.json`. An invalid primary file does not cause fallback to the secondary file. Configuration reads are bounded to 256 KiB and reject symlinks outside the project. Reading configuration runs no commands and creates no threads or worktrees. After the first configuration read, the host shares narrow root/`.ramu` watches across that project’s clients. Effective configuration changes refresh action lists and new-thread workspace settings on the owning host. Editor atomic renames, fallback-directory creation and normal deletion are supported. Project removal and service shutdown release the watches; reconnect reads reconcile current configuration. Late responses from an older host, project or refresh cannot replace newer choices.

```json
{
  "actions": [
    { "id": "test", "name": "Test", "command": "pnpm test", "keys": "mod+shift+t" }
  ],
  "workspace": {
    "defaultCheckoutMode": "worktree",
    "branchPrefix": "feat/",
    "branchNaming": "fixed",
    "branchInstructions": "Include the issue number when available."
  },
  "commit": {
    "commitStyle": "conventional",
    "commitInstructions": "Keep the header under 50 characters."
  }
}
```

Workspace fields override the host's corresponding defaults. An explicit draft mode, branch name, prefix or existing workspace still wins. Branch naming accepts `fixed`, `semantic` or `custom`; `summary-slug` is accepted as an alias for `fixed`. Commit style accepts `conventional`, `repository` or `custom`.

Repository actions appear in the existing project action menu with their source filename. They run only when a person invokes the action or its shortcut. Editing an action creates a local override with the same ID. Other repository actions continue following the file. Delete a local override to expose the repository definition again; remove repository actions in the file itself. Action IDs must be unique within the file. Each source supports at most 30 actions.

Credentials, binary paths, account configuration and agent permissions from repository files are ignored. Agent provider/model defaults from repository configuration are not yet supported. Invalid repository configuration leaves global defaults active and appears in workspace selection; it never authorizes an automatic command or permission change.

See the [remaining configuration work](CONFIG-FILES-PLAN.md) and [workspace defaults](UI.md#workspace-defaults-and-branch-names).
