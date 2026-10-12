# Editor

Ramu keeps the editor focused on reading, reviewing, and making small edits beside an agent chat. Monaco provides syntax highlighting, find/replace, undo/redo, multiple cursors, bracket matching, folding, word wrap, and diffs. Markdown can be previewed beside the buffer.

Command palette selections and other deliberate file opens create kept-open tabs. Explorer single-clicks and search results explicitly request preview tabs; reopening a kept tab never turns it back into a preview.

Saving writes the current buffer exactly, with no formatting step. Disk conflict detection and unsaved buffer context for agents remain available. AI inline completion, next-edit predictions, project formatters, and language server integration have been removed, including their IPC methods and settings. Old saved settings for these features are ignored when preferences load.

Only Monaco's editor worker is bundled for core editing and diffs. Syntax grammars load on demand; TypeScript, JSON, HTML, and CSS language service workers are not bundled. There is no project-aware type checking, auto-import, symbol rename, or go-to-definition in the editor. Use your external IDE or ask the agent for those tasks.

## Project linting

Ramu still uses linters configured and installed in each repository:

| Tool | Languages | Reads unsaved text |
| --- | --- | --- |
| ESLint | JavaScript / TypeScript | Yes |
| Ruff | Python | Yes |
| Biome | JavaScript / TypeScript, JSON, CSS | No |
| Oxlint | JavaScript / TypeScript | No |

Tools run from the nearest configured folder. Node tools must be installed in the repository; Ruff uses the project's virtual environment or PATH. No tool is downloaded automatically.

Files are linted on open and save. **Lint while editing** additionally checks unsaved text after an 800 ms pause, with at most one buffer lint in flight per file. Saved-file markers are cleared when the buffer changes. Diagnostics are grouped by tool, stale results are dropped, and linting never writes to disk.

## Font smoothing

**Crisper text** in Appearance is enabled by default. The document root uses `-webkit-font-smoothing: antialiased` and `-moz-osx-font-smoothing: grayscale`, inherited by the interface, code editor, and diffs. Turning it off restores the platform's default rendering. Existing explicit choices are preserved. These properties primarily affect macOS text rendering; other engines may ignore them.

This follows [T3 Code's root-level smoothing preference](https://github.com/pingdotgg/t3code/blob/main/apps/web/src/appearanceFonts.ts). It applies before settings load, avoiding an initial change in text weight.

## Verification

`pnpm check` checks types, lint service behavior, settings compatibility, desktop menus, and builds. `pnpm test:e2e` runs an isolated Electron journey. `RAMU_E2E_EDITOR_ONLY=1 pnpm test:e2e` stops after the editor checks: exact buffer saves, simplified settings, font smoothing on/off, project lint markers, find, and conflict diffs.
