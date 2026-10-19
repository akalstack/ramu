# Configuration files and project-level settings (ramu.json)

Proposal, 2026-10-19. All implementation and acceptance below remain unfinished.
Enable transparent, version-controllable configuration in Ramu through plain JSON files: a user-level `settings.json` in the application data directory for global preferences, and an optional repository-level `ramu.json` (or `.ramu/config.json`) for team-shared project actions, workspace defaults, commit styles, and agent rules. Follow [Architecture](ARCHITECTURE.md), [UI](UI.md), and [Working in this repository](../AGENTS.md). Move shipped behavior into feature guides, remove completed items, and delete this plan when finished.

## Smallest usable delivery

A developer opens a repository containing a `ramu.json` defining project actions (such as `test` and `build`) and branch naming rules. Ramu immediately presents those actions in the window bar and applies the repository branch prefix when opening a worktree, without requiring manual configuration in SQLite or Settings. Concurrently, user preferences in Ramu migrate cleanly from the SQLite `app_state` table into `userData/settings.json`, allowing the developer to view, edit, or back up their global settings in a text editor with immediate live reflection in the UI.

Deliver this flow in two bounded phases:
1. **Global `settings.json`**: Move `AppPreferences` and `model-preferences` storage from the internal `app_state` SQLite table to `userData/settings.json`, using atomic writes, schema validation, and automatic backwards-compatible migration.
2. **Project `ramu.json`**: Support an optional `ramu.json` (or `.ramu/config.json`) in the project root to configure project actions, branch conventions, and commit instructions, cleanly layered on top of global preferences.

Validate both with automated unit/integration tests and the desktop startup smoke test.

## T3 Code reference

T3 Code bifurcates runtime operational state and user configuration:
- **JSON files in `userData/` for configuration:**
  - `settings.json`: Orchestration preferences, provider instances, model favorites, project script overrides, and background activity profiles.
  - `client-settings.json`: Client and renderer display options (fonts, zoom, diff layouts, confirmation dialogs).
  - `keybindings.json`: Custom keyboard shortcuts.
  - `desktop-settings.json`: Window bounds and display state.
- **SQLite (`statev2.sqlite`) for relational and event data:**
  - Threads, projection trees, checkpoint diff blobs, runs, turn items, and scheduled tasks.

Ramu currently stores both operational data (tasks, sessions, events, bindings) and user preferences (`app-preferences`, `model-preferences`, `project-actions:*`) inside `ramu.db` using the generic `app_state` key-value table. Moving user preferences and project configurations to JSON matches industry standards, unlocks version control/dotfile workflows, and simplifies team configuration while preserving SQLite for high-throughput operational state.

## Existing Ramu pieces to extend

- **`apps/server/src/ipc/context.ts`**:
  `loadPreferences()` and `savePreferences()` currently call `workspace.getAppState('app-preferences')` and `workspace.setAppState('app-preferences')`. Introduce a dedicated `SettingsStore` that reads and writes `userData/settings.json` while maintaining existing subscription broadcasts (`settings:changed`).
- **`apps/server/src/workspace/workspace.ts`**:
  Project actions (`project-actions:${projectId}`) and workspace settings are currently loaded exclusively from `app_state`. Extend project initialization to check for `ramu.json` or `.ramu/config.json` in `project.root` and merge repository-defined actions and preferences.
- **`packages/shared/src/types/settings.ts` & `packages/shared/src/settingsCompatibility.ts`**:
  Define `AppPreferences`, `ModelPreferences`, and Zod validation schemas (`appPreferences`, `modelPreferences`). Reuse these schemas directly to validate on-disk JSON configurations.
- **`apps/server/src/ipc/handlers/settings.ts` & `apps/server/src/ipc/handlers/workspace.ts`**:
  Maintain IPC handlers (`settings.app.get`, `settings.app.patch`, `workspace.actions.get`) so renderer and mobile clients remain fully decoupled from the underlying storage mechanism.

## Configuration file specification

### 1. Global User Settings (`userData/settings.json`)

Stored in the platform application data directory (`userData/settings.json`). Formatted with 2-space indentation.

```json
{
  "$schema": "https://ramu.dev/schemas/settings.json",
  "language": "system",
  "accent": "violet",
  "fontFamily": "system",
  "fontSize": 14,
  "defaultAccess": "ask",
  "defaultAutoFallback": true,
  "favoriteModels": [
    "codex:gpt-6.1-sol",
    "claudeAgent:claude-sonnet-5-5"
  ],
  "providerBinaries": {
    "codex": { "binaryPath": "codex" },
    "antigravity": { "binaryPath": "antigravity" }
  },
  "workspaceDefaults": {
    "defaultCheckoutMode": "worktree",
    "worktreeBranchPrefix": "task/",
    "worktreeBranchNaming": "summary-slug"
  },
  "models": {
    "defaultBarMode": "model",
    "defaultSetId": "standard",
    "defaultStepId": "default-codex",
    "sets": []
  }
}
```

### 2. Project Configuration (`ramu.json` or `.ramu/config.json`)

Located at the repository root of a project. Can be checked into Git for team consistency.

```json
{
  "$schema": "https://ramu.dev/schemas/ramu.json",
  "name": "my-service",
  "actions": [
    {
      "id": "test",
      "name": "Test",
      "command": "pnpm test",
      "keys": "mod+shift+t"
    },
    {
      "id": "build",
      "name": "Build",
      "command": "pnpm build"
    }
  ],
  "workspace": {
    "defaultCheckoutMode": "worktree",
    "branchPrefix": "feat/",
    "branchNaming": "summary-slug",
    "branchInstructions": "Use Jira ticket numbers when present in task title."
  },
  "commit": {
    "commitStyle": "conventional",
    "commitInstructions": "Keep header under 50 characters."
  },
  "agent": {
    "preferredProvider": "codex",
    "preferredModel": "gpt-6.1-sol",
    "defaultAccess": "edits"
  }
}
```

### Precedence hierarchy

Settings resolve hierarchically from broadest to most specific:
1. Built-in hardcoded defaults (`DEFAULT_APP_PREFERENCES`).
2. Global user settings (`userData/settings.json`).
3. Repository project settings (`<project-root>/ramu.json` or `<project-root>/.ramu/config.json`).
4. Active composer draft and session overrides chosen explicitly by the user.

## Persistence, concurrency, and security

- **Atomic file writes**:
  Writing `settings.json` must always write to a temporary file in the same directory (`settings.json.tmp.<id>`) and call `fs.renameSync` to ensure POSIX atomicity. An abrupt process termination or power loss must never leave a half-written or empty JSON file.
- **Safe migration from SQLite**:
  On startup, if `settings.json` does not exist but `app_state` contains `'app-preferences'`, export the current row into `settings.json`, verify its checksum, and retain the legacy SQLite row as an archive. Never delete user data without a verified write.
- **External change detection**:
  Use `fs.watch` with debounce on `settings.json`. When modified externally:
  1. Read and validate against `appPreferences` Zod schema.
  2. If valid, update memory cache and broadcast `settings:changed` to all windows.
  3. If invalid, log diagnostic warning, retain existing in-memory settings, and avoid overwriting the user's manual edits.
- **Untrusted repository security**:
  `ramu.json` originates from git repositories which may come from untrusted sources.
  - Project `actions` (shell commands) must **never** execute automatically upon opening a project or checkout. Actions run solely on explicit human invocation (clicking the button or pressing its configured shortcut).
  - Sensitive configurations (API keys, account credentials, auth tokens, system binary paths) are prohibited in `ramu.json` and will be discarded if present.

## Remaining implementation

1. **`SettingsStore` service**:
   - Create `apps/server/src/settings/settingsStore.ts`.
   - Implement read, write, debounce, atomic write, schema validation, and file-watching.
   - Wire migration logic from SQLite `app_state` on first boot.
2. **Context integration**:
   - Connect `SettingsStore` into `apps/server/src/ipc/context.ts` replacing direct `workspace.getAppState('app-preferences')`.
   - Connect model settings (`model-preferences`) to `SettingsStore` or a dedicated `models.json`.
3. **`ProjectConfigLoader` service**:
   - Create `apps/server/src/workspace/projectConfig.ts` to discover `ramu.json` or `.ramu/config.json` in project root.
   - Implement Zod schema `projectConfigSchema`.
   - Merge repository actions and branch defaults in `workspace.ts` and IPC handlers.
4. **UI indicators**:
   - In Settings and Project Action menus, indicate when a value is defined by repository `ramu.json` (e.g., small "repo" badge) to clarify why a setting may differ from the global default.

## Acceptance and checks

- **Migration test**:
  - Seed SQLite database with pre-migration `app-preferences`.
  - Start server and assert `settings.json` is generated with identical values.
  - Verify subsequent boots read `settings.json` without re-running migration.
- **Atomic write & corruption recovery test**:
  - Simulate interrupted writes and invalid JSON syntax.
  - Verify server falls back gracefully to default preferences without crashing.
- **Project config layering test**:
  - Test project with `ramu.json` overriding branch prefixes and actions.
  - Verify global defaults apply for omitted fields.
  - Verify actions run only on explicit trigger.
- **Build and smoke test**:
  - Run `pnpm --filter @ramu/server test` and `pnpm --filter @ramu/shared test`.
  - Run `pnpm build` followed by `pnpm test:desktop-smoke`.
