# Editor

Ramu uses Monaco for syntax highlighting, find/replace, multiple cursors, folding, word wrap, Markdown preview, and diffs. It has no project language server or AI inline completion.

Explorer single-clicks and search results open preview tabs. Open another preview to replace the tab; double-click or edit to keep it. Deliberate opens from the command palette keep the tab open.

Saving writes the buffer exactly. Ramu checks for disk conflicts and can send unsaved buffers as agent context.

## Drag and drop

Drop desktop files or folders onto an Explorer folder, repository header, or the empty space below its tree to copy them there. Existing entries keep their contents; imported duplicates get a new name. Within a repository, dragging moves entries; hold Option/Alt to copy. Drops between repository trees copy entries.

Drop Explorer files or folders onto the chat input or conversation to add file context (up to 20 files). Desktop files become attachments; desktop folders insert their quoted absolute paths so the agent can inspect them. Mixed file/folder drops work in the same gesture.

## Text rendering

**Settings → Appearance → Crisper text** enables grayscale font smoothing, primarily on macOS. Turn it off to use platform defaults.

## Checks

Run `pnpm check`. On macOS, build and run `RAMU_E2E_EDITOR_ONLY=1 pnpm test:e2e` for editor, save-conflict, and font-smoothing checks. Run `RAMU_E2E_DROP_ONLY=1 pnpm test:e2e` for native Explorer imports and chat drops.
