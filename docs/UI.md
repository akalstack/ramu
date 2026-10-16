# UI development

The renderer uses shadcn/ui with Base UI, Tailwind 4, and shared theme tokens. `components.json` defines paths and the `@` alias.

Add components with `pnpm ui:add <component>`. Review generated changes before replacing customized components. Base UI triggers use `render`, not `asChild`; dialogs use `onOpenChange(open, details)`, `initialFocus`, and `finalFocus`.

`ui.css` maps colors and typography to Ramu's tokens. `styles.css` contains shared desktop sizing. Tailwind preflight is omitted because Monaco and xterm manage their own styles. Reuse shared components for menus, dialogs, list rows, and empty states. Respect reduced-motion preferences.

## Workspace and terminals

Thread and workspace panes share a resizable split. Bottom terminals span both panes. Terminals in the workspace share the file tab strip; selecting a terminal group shows its shells in place of the file. Resize handles support dragging and arrow keys, Home, and End.

Terminal tabs contain groups of panes. Splitting keeps the shell in its group; moving a pane to a tab preserves it. Hidden groups keep running. Layout and grouping persist with workspace state.

Editors, terminals, and attachments use native context menus. Keep clipboard and save-dialog operations in the main process.

## Command palette

The palette (`apps/web/src/palette/`) is a set of sources, each drawn as its own group. No prefix searches files, projects, threads and text inside project files; `>` runs commands only; `#` searches file contents only. Results stay in their group (never one flat ranking), show the first few with **Show more**, and render through `VirtualList`.

To add a source, write a `PaletteSource` (`palette/sources.ts`) and add it to the list in `Palette.tsx`:

- `id`, `label` (translated), `priority` (group order), `modes` (`all`, `commands`, `content`).
- `query(text, { signal, limit, mode })` returns a batch (synchronous), a Promise, or an AsyncIterable of batches. Each result carries its label, optional highlight offsets, detail, snippet and a `run` that opens it.
- `minLength`, `debounceMs`, `limit`, `initialShow`. Keep cheap sources at `debounceMs: 0`; anything that waits on the server needs a debounce and a minimum length, and should honour `signal`. A new keystroke aborts the old query and its late result is dropped. Set `scope` (for example the task id) so a running query survives rebuilds of the source list but not a project switch.

Content search reuses `files.search` (ripgrep, ignore files, binary and size limits, `SEARCH_RESULT_LIMIT`). The server has no cancellation, so a superseded search finishes in the background and is ignored. Tests for the pure parts are in `apps/web/test/palette*.test.ts`.

## Branding

See [branding assets](../assets/branding/README.md) and [provider logos](../apps/web/src/assets/providers/README.md) for source assets and attribution.

For packaging and updates, use the [release guide](RELEASING.md).
