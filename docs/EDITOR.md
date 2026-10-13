# Editor

Ramu uses Monaco for syntax highlighting, find/replace, multiple cursors, folding, word wrap, Markdown preview, and diffs. It has no project language server or AI inline completion.

Explorer single-clicks and search results open preview tabs. Open another preview to replace the tab; double-click or edit to keep it. Deliberate opens from the command palette keep the tab open.

Saving writes the buffer exactly. Ramu checks for disk conflicts and can send unsaved buffers as agent context.

## Linting

Linters must be installed and configured in the repository. Ramu does not download them.

| Tool | Languages | Checks unsaved text |
| --- | --- | --- |
| ESLint | JavaScript / TypeScript | Yes |
| Ruff | Python | Yes |
| Biome | JavaScript / TypeScript, JSON, CSS | No |
| Oxlint | JavaScript / TypeScript | No |

Tools run from the nearest configured folder. Ruff uses the project's virtual environment or PATH.

Files are checked on open and save. **Lint while editing** checks supported unsaved buffers after a pause. Linting does not write files.

## Text rendering

**Settings → Appearance → Crisper text** enables grayscale font smoothing, primarily on macOS. Turn it off to use platform defaults.

## Checks

Run `pnpm check`. On macOS, build and run `RAMU_E2E_EDITOR_ONLY=1 pnpm test:e2e` for editor, lint, save-conflict, and font-smoothing checks.
