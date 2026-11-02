# Configuration files

## Host settings

The execution host stores global preferences in `settings.json` in its application data directory, next to `ramu.db`. Desktop and headless servers use the same layout. Model sets live in the file's `models` field. Threads, events and schedules stay in SQLite; drafts and UI state stay in device storage.

 Writes use a verified temporary file and atomic replacement. External edits reload the host's services and notify clients. Invalid JSON, invalid values or a file over 2 MiB leave the last valid settings active (built-in defaults at startup); a save from Settings refuses to overwrite an invalid file, so fix it first.

The file uses the same flat names as the settings API:

```json
{
  "language": "en",
  "accent": "teal",
  "defaultCheckoutMode": "worktree",
  "worktreeBranchNaming": "fixed",
  "worktreeBranchPrefix": "task/"
}
```

Omitted fields use defaults, and unknown fields survive writes. The file can hold local provider binary and account configuration, so keep it private and out of repositories. Provider credentials stay in their own account stores.

## Repository configuration

An optional `ramu.json` at a project's root supplies team defaults; if it is absent Ramu reads `.ramu/config.json` (an invalid primary file does not fall back). Reads are limited to 256 KiB, reject symlinks that leave the project, and run no commands. The host watches the configuration and refreshes action lists and new-thread workspace settings when it changes.

```json
{
  "actions": [{ "id": "test", "name": "Test", "command": "pnpm test", "keys": "mod+shift+t" }],
  "agent": { "preferredProvider": "codex" },
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

Credentials, binary paths, account configuration and agent permissions in repository files are ignored. Invalid configuration leaves global defaults active, is reported in workspace selection, and never authorizes a command or permission change.

### Workspace and commit

Workspace fields override the host defaults; an explicit draft mode, branch name, prefix or existing workspace still wins. `branchNaming` is `fixed` (alias `summary-slug`), `semantic` or `custom`. `commitStyle` is `conventional`, `repository` or `custom`. See [workspace defaults](UI.md#workspace-defaults-and-branch-names).

### Actions

Repository actions appear in the project action menu with their source file and run only when a person invokes them or their shortcut. IDs must be unique within a file; each source allows 30 actions.

- Editing an action creates a local override with the same ID; delete the override to see the repository definition again. Remove repository actions in the file.
- **Manage actions** (desktop; the project menu on mobile) reorders, hides and shows actions. These edits are host preferences shared by that host's clients and never rewrite `ramu.json`. Hidden actions are absent from menus and shortcuts. **Use repository order** clears a custom order and keeps overrides and hidden choices.
- Order, visibility and overrides are saved together in one versioned SQLite record. An unknown saved format blocks edits rather than resetting commands. Viewer grants cannot manage actions; a reorder from an outdated list asks for a refresh.

### Default model

`agent.preferredProvider` and `agent.preferredModel` choose the model for new threads in the project. The host resolves them against its enabled catalog: a model alone uses the host's default provider, a provider alone uses that provider's default model, and Ramu never guesses families or matches an ID on another provider. The composer shows the source file.

- The repository default applies until a person picks a model in the draft; that choice, and any existing thread's model, is never replaced. Switching provider clears the previous account and fast tier but keeps the draft's access and fallback settings.
- An unavailable or invalid default blocks Send, keeps the draft, and offers **Use host default** or another model. Send revalidates before creating a thread; a changed result asks for review. **Use project default** resumes inheritance.
- Home's **Auto** routing applies the destination project's default the same way. If it is unavailable the thread is not created, the draft stays in Auto, and the error names the project. A routed thread always uses the destination's default workspace.
- Explicit choices are kept with the draft per host and project for 30 days. On mobile, a queued message freezes its model and settings in the outbox, and offline drafts without loaded host defaults need a reviewed choice.
