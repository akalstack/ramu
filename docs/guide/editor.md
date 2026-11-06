# Editor

Ramu's editor is Monaco: syntax highlighting, find and replace, multiple cursors, folding and diffs. It has no language server or inline AI completion.

- **Preview tabs:** single-clicks open a preview tab that the next one replaces; double-click or edit to keep it.
- **Saving** writes exactly what's in the buffer and checks for changes on disk first. Unsaved buffers can go to the agent as context.
- **Markdown** opens in a rich editor with a toolbar. **Source** shows the same file in Monaco; **Locked** is read-only.
- **Mermaid diagrams** draw in place wherever Markdown shows them: chat replies, Markdown previews, and `.mmd` or `.mermaid` files, which open on the diagram with **Source** one click away. Diagrams follow the light or dark theme. A reply still being written keeps its last good drawing. **Expand diagram** opens it full size, where you can zoom and pan.
- **Drag and drop:** drop files onto an Explorer folder to copy them in, or onto the message box to add them as context (up to 20).
- **Crisper text** (Settings → Appearance) turns on grayscale font smoothing on macOS.
