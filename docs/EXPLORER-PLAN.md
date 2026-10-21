# Remaining Explorer work

Mobile now has a Home/project Browse files action, a visible thread Explorer action, lazy scoped tree, bounded directory API and shared file viewer. Home browsing creates no conversation/worktree, and standalone browsing creates no working folder. Current behavior is in [UI](UI.md#mobile-explorer).

## Delivery

A person opens files from Home or a thread, recognizes the host and checkout, reads the intended file and adds it to an agent message without sending it. Prioritize correct scope, existing-workspace selection and return to the intact draft. File management and additional preview formats are later increments; basic browsing must work without them. Reuse the current tree/viewer and verify the full browse-to-draft flow with duplicate filenames and an unavailable host. Follow the [root product and planning guidance](../AGENTS.md#product-design-and-architecture) for this and later increments.

**Easier for the person:** Attaching a file to a message is a few clicks from where the person is reading, with no path copying.

## Ramu design and architecture

Follow [Architecture](ARCHITECTURE.md) and [UI](UI.md). Extend the existing Explorer rail, scope picker, file viewer, editor and composer insertion flow. Use shared desktop app controls outside `components/ui/` and existing native mobile rows/sheets; keep interaction states and tokens in reusable components. All filesystem/Git operations run on the selected workspace server through the existing named API and validated handlers, using current workspace bindings and keyed locks for mutations. Native reveal/save/share stays on the viewing device and must distinguish a remote path from a downloaded file. Host-qualified queries/events and bounded navigation state must not leak across hosts or introduce a second file browser/store.

## Remaining implementation

- Finish desktop Home/project coherence through the existing Explorer rail. Verify mobile Home current/existing-workspace selection, project/workspace labels and per-repository branch/path details on physical devices, including partial and deleted workspaces.
- Add stable scroll restoration beyond retained screen state and bounded persistence of navigation metadata. Verify selected-file/ancestor reveal, new-thread Browse files and Collapse folders on physical devices, including virtualized large folders and missing paths.
- Extend cancellation and request-generation component coverage to directory/search races, reconnect and live file deletion/rename. Preview tests cover late host responses and missing standalone bindings; device-level stale/deleted file handling still needs acceptance. Validate continuation, changed-directory refresh and selected-path reveal beyond the first page on physical devices; search still uses the existing bounded quick-open index.
- Add capability-aware native copy/reveal and confirmed file management through the existing surfaces. Verify the preview Add to message/New thread with file actions against native persistence, server permissions and actual outbox delivery. Keep previews read-only until each mutation boundary has coverage.
- Measure directory/search/preview payloads on devices. Server checkout watchers are now leased per task (see [UI](UI.md#mobile-explorer)); verify on devices that archiving or deleting a task stops its live updates.
- Finish localization, accessible scope details and physical iOS/Android acceptance, including large text, multiple repositories/worktrees, offline/reconnect and keyboard navigation. Existing Markdown/code/image/diff preview is reused; PDF/video adapters remain unsupported.

## Acceptance and checks

- Shared/unit tests: host-qualified context identity, repository/path keys, deterministic directory ordering, flattening/expansion, search/selection reveal, missing ancestors and stale async results. Two same-named files/projects on different hosts and two worktrees of the same repo must remain distinct.
- Server integration tests in existing workspace/files suites: project browsing with zero threads and no task/session/worktree creation; thread current versus isolated bindings; project-free existing folders without browse-triggered allocation; partial/deleted worktrees; no Git/provider requirement; relative-path/symlink escapes; bounded preview/search/truncation and watcher disposal. Confirm read flows preserve Git branch/index/working files.
- Mobile focused tests: Home pickers and project action, correct thread checkout, legacy file-link wrapper, return/back draft and scroll restoration, offline/permission/unsupported states, scope switch cancellation, search results with duplicate basenames, selected file deletion/rename, line navigation and no send on Add to message. Assert browse actions make no `tasks.create/setup` or `agent.start` calls.
- Management tests: destructive confirmation targets the right host/checkout, collision/conflict and active-writer handling, no mutation while offline, no blind replay after lost acknowledgement, and remote-path copy versus actual download/share semantics.
- Run tests/types scoped to shared/server/mobile/web packages touched. For desktop-facing implementation run `pnpm build` then the single `pnpm test:desktop-smoke`; do not add another desktop end-to-end suite. Mobile-only increments use scoped mobile/shared checks; desktop-facing increments still require build and smoke.
- On physical iOS/Android verify one-handed discoverability from Home and threads, native Back, keyboard/search, safe areas, large text, screen readers, long filenames/deep folders, Markdown/code/image preview and graceful unsupported types. Verify two hosts, multi-repository projects, distinct/shared worktrees, live file changes and reconnect. Measure tree payloads, large-folder rendering, preview memory and event frequency before claiming desktop-equivalent responsiveness.
