# Editor

Ramu's editor is Monaco: syntax highlighting, find and replace, multiple cursors, folding and diffs. It has no language server or inline AI completion.

- **Preview tabs:** a single click opens a preview tab that the next one replaces. Double-click or edit to keep it.
- **Saving** writes exactly what's in the buffer and checks for changes on disk first. Unsaved buffers can go to the agent as context.
- **Markdown** opens in a rich editor with a toolbar. **Source** shows the same file in Monaco, and **Preview** shows it read-only.
- **Mermaid diagrams** draw in place wherever Markdown shows them: chat replies, Markdown previews, and `.mmd` or `.mermaid` files, which open on the diagram with **Source** one click away. Diagrams follow the light or dark theme. A reply still being written keeps its last good drawing. **Expand diagram** opens it full size, where you can zoom and pan.
- **Drag and drop:** drop files from Finder or the desktop onto an Explorer folder to copy them in, on this computer or a remote host, or onto the message box to add them as context (up to 20). Inside one project a drag moves (hold Option to copy). From another project it copies. Hovering a closed folder while dragging opens it.
- **Copy and paste between places:** copy or cut in the Explorer, then paste into another folder, another project, or a project on another host. Files copied in Finder paste into the Explorer too, and files copied from a project on this computer paste into Finder. Whichever copy is newest wins. A cut between projects on one host moves the items; between hosts it copies and leaves the originals.
- **Between computers** the app reads files from one host and writes them to the other in chunks, gzipped when that makes them smaller (already-compressed formats such as images, video and archives go as they are), and keeps executable bits and links. A toast shows progress with **Cancel**. Nothing lands until the whole copy arrives, and items never overwrite what is there (`name copy.txt`). `.git` folders are skipped. One copy can carry up to 50,000 items and 20 GB.
- **Download to this computer** (right-click on a remote host) saves the items to your Downloads folder and shows them in Finder.
- **Crisper text** (Settings → Appearance) turns on grayscale font smoothing on macOS.
