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

An optional `ramu.json` at the registered project's root supplies team defaults. If absent, Ramu checks `.ramu/config.json`. An invalid primary file does not cause fallback to the secondary file. Configuration reads are bounded to 256 KiB and reject symlinks outside the project. Reading configuration runs no commands and creates no threads or worktrees. After the first configuration read, the host shares narrow configuration-directory watches across that project’s clients. Effective configuration changes refresh action lists and new-thread workspace settings on the owning host. Editor atomic renames, fallback-directory creation, project-root replacement and internal configuration symlink targets are supported. Deleted internal targets can be recreated without another client read. Target and ancestor watches rebind after directory replacement; external symlink targets remain outside the watch boundary. Project removal and service shutdown release the watches; reconnect reads reconcile current configuration. Late responses from an older host, project or refresh cannot replace newer choices.

```json
{
  "actions": [
    { "id": "test", "name": "Test", "command": "pnpm test", "keys": "mod+shift+t" }
  ],
  "agent": {
    "preferredProvider": "codex"
  },
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

Repository actions appear in the existing project action menu with their source filename. They run only when a person invokes the action or its shortcut. Editing an action creates a local override with the same ID, in its repository-defined position. Other repository commands and their default order continue following the file, including when an unrelated action editor was opened before a file change. Delete a local override to expose the repository definition again; remove repository actions in the file itself. Action IDs must be unique within the file. Each source supports at most 30 actions.

Desktop **Manage actions** supports drag/keyboard ordering, Hide and Show. It remains reachable beside Add action when every action is hidden. On mobile, the project's menu opens **Manage actions** with source/command details, move-up/down and Hide/Show controls. These edit host-owned preferences shared by that host's connected clients; they do not rewrite `ramu.json`, create a thread or start a command. Hidden actions are absent from ordinary menus and keyboard shortcuts. Showing a repository action uses its latest definition. Hidden local commands survive saves from clients that only know the visible list.

Explicit ordering stores action IDs, keeping current repository commands live and appending newly defined actions. **Use repository order** removes the custom order while retaining local overrides and hidden choices. A reorder from an outdated catalog requires refresh instead of dropping new actions. Opening management on an older host explains that an update is needed; unsupported and offline mutations stay disabled.

Order, visibility and local overrides are saved together in one versioned SQLite state record. Existing local-action arrays remain readable and are retained as an archive when first migrated. Invalid or unknown saved formats block edits rather than silently reset commands. Action mutations notify other clients through the existing workspace event; viewer grants cannot manage actions.

`agent.preferredProvider` and `agent.preferredModel` choose the model for a new thread in that project. The host resolves them against its enabled provider catalog; a model-only preference uses the host's default provider, and a provider-only preference uses that provider's default model. The composer shows the source file. The repository default follows file edits until a person picks a model in the draft; that choice, and any existing thread's model, is never replaced. Switching provider this way clears the previous provider's account and fast tier but keeps the draft's access and fallback settings. An unavailable provider/model or invalid configuration blocks Send, keeps the draft, and offers **Use host default** or another model. Before creation, Send revalidates the effective default. A changed or superseded result requires review instead of creating a thread with stale settings. Older hosts without this support keep the displayed host default and show an update hint. Add `agent.preferredModel` to select an exact model ID from the chosen host's catalog; Ramu does not guess model families or look for a matching ID on another provider.

When Home's **Auto** project selection resolves a destination, that project's repository model default applies with the same precedence as a manual pick: an explicit model chosen in the draft still wins, and an older host keeps the host default. If the destination's default is unavailable or invalid, the thread is not created; the draft stays in Auto and the error names the project, so choosing a model and sending again starts it there. A routed thread always uses the destination's default workspace, never a workspace chosen for the project-free draft.

An explicit picker choice is stored with the reviewed access/fallback settings in the device's host/project draft metadata. Behavior-only edits continue following the repository model. **Use project default** resumes model inheritance while retaining explicit access/fallback choices. Failed desktop persistence keeps the choice editable for the current session with Retry; unreadable metadata requires a fresh model choice. A send acknowledgement clears only the unchanged metadata it sent, after the corresponding active text was consumed; newer text or failed persistence retains the model intent. Desktop active metadata follows the existing 30-day expiry; explicit saved message libraries have their separate retention policy.

Mobile qualifies the same choice by host and composer context. If a host's defaults have not loaded, Ramu does not offer an invented **Use host default**; reconnect or restore/pick a reviewed model. A previously reviewed manual draft retains its access/fallback settings while offline. Once queued, the actual model/settings are frozen in the existing outbox, and later configuration edits do not reroute the queued message. Existing usage fallback policy still applies when the thread runs. Restoring saved message content never silently selects a different provider or model.

Credentials, binary paths, account configuration and agent permissions from repository files are ignored. Invalid repository configuration leaves global defaults active and appears in workspace selection; it never authorizes an automatic command or permission change.

See the [remaining configuration work](ROADMAP.md#configuration-acceptance) and [workspace defaults](UI.md#workspace-defaults-and-branch-names).
