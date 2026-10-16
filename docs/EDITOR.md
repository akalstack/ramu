# Editor

Ramu uses Monaco for syntax highlighting, find/replace, multiple cursors, folding, word wrap, and diffs. It has no project language server or AI inline completion.

Explorer single-clicks and search results open preview tabs. Open another preview to replace the tab; double-click or edit to keep it. Deliberate opens from the command palette keep the tab open.

Saving writes the buffer exactly. Ramu checks for disk conflicts and can send unsaved buffers as agent context.

## Markdown

Markdown opens in a rich text editor. Formatting stays visible as you type, with a toolbar for headings, bold, italic, links, lists, checkboxes, tables, and code. **Locked** switches to reading, and **Source** opens the same buffer in Monaco. There is no split view.

Cmd/Ctrl+S saves. Undo, unsaved agent context, and disk conflict handling share the source buffer. Opening a file or switching modes does not rewrite it. Rich text edits serialize back to Markdown and can normalize its formatting. Frontmatter is retained, and embedded HTML blocks remain editable as source.

## Drag and drop

Drop desktop files or folders onto an Explorer folder, repository header, or the empty space below its tree to copy them there. Existing entries keep their contents; imported duplicates get a new name. Within a repository, dragging moves entries; hold Option/Alt to copy. Drops between repository trees copy entries.

Drop Explorer files or folders onto the thread input or conversation to add file context (up to 20 files). Desktop files become attachments; desktop folders insert their quoted absolute paths so the agent can inspect them. Mixed file/folder drops work in the same gesture.

## Text rendering

**Settings → Appearance → Crisper text** enables grayscale font smoothing, primarily on macOS. Turn it off to use platform defaults.

## Checks

Run `pnpm check`. Add focused unit or integration tests for editor and save-conflict behavior. On macOS, build and run `pnpm test:desktop-smoke` for startup validation; manually verify font smoothing, native Explorer imports and thread drops when changing them.
