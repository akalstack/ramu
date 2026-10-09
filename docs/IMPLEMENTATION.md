# Ramu desktop alpha

The current application uses Electron, React, Monaco, xterm.js, a local SQLite database, and Git CLI operations. Run `pnpm dev`, or `pnpm build && pnpm start`.

Projects own repositories. Adding a workspace opens its files without creating a task. Sending the first message creates a chat covering the whole workspace. Current checkout is the default; isolated worktrees retain their own bindings.

## Agents

Claude Code uses the Claude Agent SDK. Codex uses the installed `codex app-server` and the user's existing Codex login. Available models and effort levels are discovered from those clients rather than hardcoded. Install/sign in to the corresponding provider before using it.

The composer controls select model, reasoning effort, approval mode, and automatic fallback. Full access is the default for new conversations and disables ordinary tool approvals; it is passed explicitly to the selected provider. Changing settings adds a separator to the persisted conversation. Changing a working conversation stops its old process, then continues the unfinished request with the new settings.

Same-provider changes resume the native conversation. Cross-provider changes create a new provider session inside the same Ramu chat, transferring visible messages and tool evidence. Provider-private reasoning is not transferred. Handoffs cap the transcript at 120,000 characters, preserving the beginning and recent context; tool summaries are abbreviated. The new provider is instructed to inspect the actual files before repeating actions.

A provider usage limit can automatically continue with the other installed provider's default model. Access mode and workspace scope are preserved. Each provider is attempted once per user turn; failures never bounce indefinitely between providers. Fallback can be disabled. Authentication and ordinary tool errors do not trigger automatic fallback. If the other provider is unavailable, the chat remains available for manual recovery.

## Git

Source Control selects a repository and shows its staged, unstaged, and conflicted files. Its bottom Git section shows the latest 30 commits, local branches, upstream state, comparisons, and fetch/pull/push actions. Selecting a commit opens its actual patch. Pull is fast-forward only. Switching branches/pulling checks for unsaved buffers, dirty checkouts, and app-managed agent writers. Publishing a branch establishes upstream on origin (or the sole configured remote); force pushes are not offered.

The AI commit button drafts a message from the staged diff into the editable commit field. It uses the current chat's provider settings, or settings selected under AI message settings. Drafting runs outside the repository with Claude tools disabled or a Codex read-only sandbox. It does not stage files or commit. Diffs over 120,000 characters are refused. Generated drafts are bound to the staged diff fingerprint; changing staged content requires regenerating or clearing the draft. Review and click Commit explicitly.

The repository/branch/checkout/path status strip remains at the bottom. Multi-host controls are not included.

## Validation

- `pnpm typecheck`
- `pnpm test`: temporary Git repositories, a local bare remote, provider doubles, and a fake app-server process covering protocol messages, approvals, native resume, model settings, bidirectional fallback, and read-only commit drafts.
- `pnpm build && node scripts/ui-smoke.mjs`: Electron journey with throwaway repositories/profile, fake providers, UI settings changes, automatic fallback, AI drafting, Git history, manual editing, isolated worktrees, delete protection, and restart restoration.
- `RAMU_REAL_AGENT=1` explicitly enables Claude account usage for the existing optional integration test. It is skipped by default. Codex model discovery and a real read-only Codex reply were also verified during this implementation.

## Shared project workspace and terminals

Current-checkout chats share one project workspace: editor tabs, unsaved buffers, terminal sessions, and Git state remain connected when creating or switching chats. Conversations keep separate histories. All chats appear at one level directly under the project. New chat from inside a chat creates a sibling chat. Isolated tasks carry a worktree marker and keep separate files, terminals, and checkout directories. Old current-checkout tabs are migrated into the project workspace on restore.

Terminals open in a resizable bottom panel without replacing the active editor/chat. Tabs can run across the top or down the right. Horizontal splits show terminals side by side; vertical splits stack them. Hiding the panel preserves running shells; closing a terminal stops that shell. Panel size, layout, and tabs restore after restart, with fresh shells.

Each New chat action creates an independent, flat project-level conversation/task. Its workspace picker offers Current checkout, New isolated worktrees, and existing isolated workspaces. Starting a conversation from an isolated workspace defaults to reusing that workspace; choosing New isolated worktrees creates independent branches/directories after previewing the plan. Conversations sharing a workspace retain separate histories and share editor buffers, Git state, and live terminals.

Worktree workspaces are stored independently of conversations. Existing profiles migrate without Git changes. Deleting a conversation preserves worktrees used by another conversation; optional worktree removal is available only for the last conversation and still refuses dirty worktrees. Retained worktrees remain available in the picker even after all their conversations are deleted. Internal task API/storage names remain compatible with existing profiles.

Workspace UX: file/diff tabs and terminals are shared only within the same checkout or isolated workspace. Conversation histories, model settings, and approvals stay independent. The sidebar switches conversations; the file tab bar contains files and diffs only, with a Show chat control to return to the current conversation. Selecting a file keeps the conversation docked beside it. Project/chat actions use right-click menus and Shift+F10, with arrow-key navigation.

Chat switching remains one click in the sidebar. The header also has a searchable project chat switcher, including checkout/worktree labels, and works with the sidebar hidden. Arrow keys and Enter select results. The command palette finds project-level chats without duplicate session entries.

When code is open, the chat switcher lives at the right edge of the conversation panel’s header. Switching within the same workspace keeps the current editor visible. New chat actions (including the project +) open a full-width composer; existing file buffers and terminal processes stay mounted while their panels are temporarily hidden. Starting the conversation restores the workspace controls.

File and terminal tabs have right-click / Shift+F10 menus for Close, Close Others, Close to the Right, and Close All. File tabs additionally offer Close Saved Tabs. Bulk closing asks once before discarding unsaved buffers and cancels the entire operation if declined. Closing file tabs leaves chat history and terminal sessions intact. These tab-menu edits have not been validated; testing is paused at the user's request.

Selecting a file/diff tab reveals its file in Explorer when that sidebar is open: ancestor folders expand, the file is highlighted, and it scrolls into view. Switching files does not automatically replace the Chats or Source Control sidebar. Opening Explorer later reveals the current or last selected workspace file. Reveal in Explorer on a tab’s context menu explicitly opens the Explorer sidebar, including when hidden. These edits remain unvalidated because testing is paused.
