Ramu — Product and Build Plan

Working product name: Ramu  
Date: 9 October 2026  
Status: original product direction; desktop alpha implementation is in progress. See [implementation notes](IMPLEMENTATION.md) for current behavior and verification.

## 1. Product promise

**Your project. Every repo. One workspace.**

Ramu is a desktop coding workspace where developers can use agents, inspect and edit code, and manage Git without repeatedly reconstructing their context in another editor. A project can contain several independent repositories. Each task brings the relevant repositories, agent conversations, files, terminals, and reviews together.

The first audience is full-stack developers working across frontend and backend repositories who already use coding agents and regularly return to a familiar editor to understand or finish the work.

Ramu is pronounced RAH-moo. Its brand story draws on the Indonesian idea of blending ingredients: familiar editing, agents, and project management brought together. The user selected this working name despite existing unrelated apps using Ramu. Name selection is not trademark or domain clearance.

Launch sentence: **I kept opening VS Code to check my coding agent's work. So I built Ramu to do both in one workspace.**

## 2. Decisions carried into this plan

| Decision | Proposed behavior |
| --- | --- |
| Project model | One project groups one or more independent Git repositories |
| Default execution | Use the user's current checkout and existing branch |
| Optional execution | Create isolated worktrees when explicitly selected |
| Navigation | Projects list and Explorer share the same left sidebar |
| Tabbing | Task tabs outside; file, diff, agent, and terminal tabs inside |
| Editing | Familiar manual editor with keyboard shortcuts and split views |
| Git | Repository-aware review, staging, commit, branch actions, and conflicts |
| Foundation | Custom application shell with existing editor/terminal components |
| First release | Local desktop workflow, one tested OS, one structured agent provider |
| Distribution | Proposed open-source core with user-configured provider access |

Build the experience around project and task context. Do not implement a full IDE from scratch. Reuse mature components, but keep Ramu's navigation and task model under its own control.

## 3. Positioning and validation

The inspirations are T3 Code's agent control surface, Orca's workspace approach, Codex-style project/session navigation, and VS Code's editing and source-control familiarity.

The proposed advantage is the complete review-and-edit loop across multiple repositories, with current-checkout operation as the normal path. Grouping repositories or embedding an editor alone is not a defensible claim of uniqueness.

Before public positioning, run the same task in the relevant competitors: modify a frontend and backend, review an agent change, fix code manually, switch tasks, return, and publish related changes. Record exact friction rather than infer missing features from a website. Advertised capabilities are not hands-on verification.

Interview 8–12 developers. Ask them to show a recent agent-assisted task and each occasion they opened another editor. Prioritize repeated reasons: code navigation, manual editing, Git confidence, terminal access, missing language support, or loss of task context.

Product hypothesis: a dependable editor and Git workflow inside a project-oriented agent app will reduce tool switching for supported tasks. Measure this; do not promise virality or complete VS Code replacement.

## 4. Workspace and task model

| Entity | Responsibility |
| --- | --- |
| Project | Name, repository roots, reference folders, shared settings |
| Repository | Canonical Git root, remotes, discovered metadata |
| Task | Title, acceptance criteria, repository selection, layout and lifecycle |
| Repository binding | Task + repository + mode + actual working directory |
| Agent session | Provider, task, explicit directory/scope, transcript and process state |
| View | File, diff, conversation, or terminal, bound to a task |
| Review record | Selected changes, comments, check results and publication state |

Single repositories and monorepos use the same model. Packages in a monorepo remain folders inside one Git repository. Classify nested repositories and submodules explicitly. Allow non-Git folders as reference roots, without presenting Git actions for them.

### Current checkout — default

Opening a task binds to each selected repository's existing directory, branch, working files, and Git index. Preserve staged and unstaged changes. Do not create a branch, switch branches, stash, copy files, or reset anything merely to start a task.

Tasks using the same checkout share its files and Git state. Switching tabs restores UI context, not an earlier version of the code. Diffs are live checkout changes and may include pre-existing edits or edits from another task. Do not label them as exclusively produced by the active agent.

### Isolated worktrees — optional

Task creation offers a clear choice: Current checkout or Isolated worktrees. The second mode selects a base branch and task branch for each participating repository, then creates task-owned worktrees. Show paths and branch names before creation. Record partial setup failures and retry only unfinished steps.

Worktrees separate working files and Git index state. They do not sandbox processes, credentials, ports, databases, or arbitrary filesystem access. Moving an existing task to a different mode is an explicit migration/new-task workflow, never a silent relocation of dirty files.

### Writer coordination

Coordinate app-managed agent writers by canonical checkout directory across all tasks. Allow independent repositories to run concurrently. For the same directory, default to one active agent writer and offer queue, handoff, or a new isolated task. Manual editing remains available with unsaved-buffer reconciliation. External editors and processes can still write; watchers must detect their changes.

## 5. Interface specification

The activity rail selects **Projects, Explorer, Search, Source Control, and Agents**. It changes the sidebar contents without changing the active task.

Projects shows grouped tasks and sessions, with compact status: idle, running, needs input, ready for review, failed, or archived. Explorer shows the active task's repository roots with clear repository labels. Source Control groups changes by repository.

Use two tab levels:

1. Task tabs: Add login, Fix checkout, Investigate API error.
2. View tabs: agent conversation, file, diff, terminal.

Avoid an additional project tab strip. Include project names in task tabs when several projects are open. Duplicate filenames include their repository name.

The center is the editor/review area, the agent panel can dock on the right, and the terminal panel opens below. Provide Agent, Code, and Review layout presets that rearrange the same task context. Panels are resizable, hideable, and restorable.

Familiar interactions: quick open, command palette, global search, find/replace, file tabs, split editor, breadcrumbs, configurable shortcuts, file operations, dirty indicators, and navigation to diagnostics. Keep repository, branch, checkout mode, and directory visible where users act.

Closing a file tab does not stop an agent. Closing a task tab does not delete its files or worktree. Stop, archive, and delete are separate explicit actions.

## 6. Signature workflow

1. Create a project called Shop and add existing web and api repositories from separate directories.
2. Create Add password reset, select both repositories, and keep Current checkout selected.
3. Start an API session and a web session. Each displays its working directory and scope. Sibling repository context is explicit and depends on provider capabilities.
4. Inspect the generated API diff, open the real file, make a manual correction, and send a selected range or diff comment to the session.
5. Switch tasks while independent sessions continue. Requests for input remain visible.
6. Return with tabs and layout restored; show current files and branch state.
7. Run each repository's configured checks and review staged/unstaged changes.
8. Commit each repository separately. In beta, create linked PRs and record merge dependencies.
9. Archive the task while preserving existing checkout directories. Clean up optional worktrees only through a reviewed workflow that handles dirty files.

This is the first demo and the first integration test journey.

## 7. Release scope

### Private alpha — must have

- Project creation, repository selection and grouped task list.
- Current-checkout default plus optional worktree setup and recovery.
- Task/view tabs; Projects/Explorer/Source Control switching.
- Manual editor, file watching, search, quick open, split views and diffs.
- Integrated terminal with explicit repository directory.
- One real structured agent adapter: events, input requests, cancellation, accurate recovery states.
- Git status, file/hunk stage and unstage, staged/unstaged diffs, commit, fetch, push, and guarded branch switching.
- Conflict detection and editable conflict files; clear unresolved status.
- Persistence of tasks, open views, layout and transcripts.
- Protection against silent buffer loss and wrong-directory operations.

For the first language matrix, target JavaScript/TypeScript plus JSON, HTML and CSS. The spike determines which diagnostics, completion and navigation features can be delivered reliably. Other languages can initially use text/syntax editing with clearly described limits.

### Public beta

- Second structured provider adapter.
- Multi-repository review summary and diff feedback to agents.
- Configured checks tied to the actual content/revision tested.
- Git pull choices with explicit merge/rebase behavior; stash UI and usable history.
- Merge conflict comparison and resolution UI.
- GitHub linked PR workflow with partial-failure recovery.
- Packaging, update verification, crash recovery, accessibility and performance hardening.

### Later, driven by usage

Git graph, cherry-pick and interactive rebase; richer language support; debugger integrations; SSH and dev containers; shared team configuration and handoff.

Defer mobile, cloud agent fleets, custom model hosting, marketplace, billing, and arbitrary VS Code extension compatibility. Early scope should prove the complete local loop.

## 8. Architecture recommendation

Start with a custom shell. The project/task model and panel layout are central enough to justify owning them. This is a recommendation to validate, not an assumption that Code OSS cannot work.

Proposed stack: Electron desktop host, React/TypeScript UI, Monaco editor, xterm.js terminal surface, PTY-backed process service, local Git CLI, and SQLite metadata. These are candidate dependencies; verify versions, licenses and platform support during implementation.

Monaco provides an editor component rather than the complete VS Code workbench. Plan language services explicitly and do not promise VS Code extension compatibility. If observed users require a broad extension ecosystem or full debugging before they can use Ramu, revisit Code OSS before building equivalent infrastructure.

Evaluate reusable T3 Code modules during the spike, especially provider integration and event handling. Reuse only when the pinned revision's license and architecture fit Ramu's multi-repository bindings and current-checkout behavior. A whole-app fork is not the default assumption.

| Module | Owns |
| --- | --- |
| Project/task service | Roots, bindings, task state, settings and context restoration |
| Checkout service | Worktree lifecycle, canonical paths and writer coordination |
| Editor service | Models, buffers, watchers, saving and disk-change reconciliation |
| Git service | Structured Git results, shared/exclusive locks and operation journal |
| Agent service | Provider adapters, events, approvals, cancellation and recovery |
| Process service | PTYs, process lifecycle, working directories and terminal references |
| Review service | Comments, selected changes, check evidence and related PRs |
| State service | SQLite migrations, persisted events and recovery records |

Use checkout-level coordination for operations on the same files/index. Worktrees also share repository metadata and refs, so operations affecting those need common-repository coordination. Never assume a task ID is an adequate lock key.

The renderer uses a narrow validated IPC interface. Privileged Git, filesystem, process and credential operations run outside the renderer. Follow the desktop framework's current security guidance. Store credentials in OS/provider-managed stores; keep source files on disk and metadata in the application database.

### Provider contract

The adapter reports capabilities instead of pretending every CLI has equivalent integration. Required concepts: launch, streaming events, requested input/approval, send input, cancel, terminal exit, transcript persistence, and optional native resume. A terminal-only CLI is a terminal session, not automatically a structured agent.

Choose the first provider by proving its current supported integration surface during the spike. Codex and Claude Code are the intended first pair, with one shipping in alpha. Respect provider-supported authentication and subscription use. Restored transcripts and actually resumed processes must have different states.

## 9. Reliability rules and meaningful checks

- No implicit checkout, reset, stash, commit or cleanup on task switches.
- Before branch changes, reconcile dirty buffers and coordinate writers across every task sharing the checkout.
- Detect external branch changes and refresh session assumptions.
- Reconcile unsaved buffers when agents or external tools change the underlying file; preserve both versions.
- Use structured Git parsing, argument arrays and canonical paths. Do not construct shell commands from untrusted paths or agent output.
- Handle partial multi-repository operations explicitly. There is no atomic cross-repository commit or push.
- Bind tests/checks to the content tested; invalidate readiness after relevant edits.
- Separate agent claims of completion from observed test outcomes.
- On restart, restore UI state and accurately report which processes are gone or recoverable.
- Refuse silent deletion of dirty worktrees; current-checkout archive never deletes user repositories.

Verify with real temporary Git repositories: dirty/staged input, spaces in paths, duplicate filenames, two tasks sharing a checkout, independent worktrees, nested roots, external branch/file changes, conflicts, failed Git commands, interrupted processes and partial setup/publication. Test actual provider event flows and the full signature journey. Add targeted performance checks for large repositories and long conversations.

## 10. Build sequence and gates

These are planning ranges for a focused solo developer, not committed dates. Provider limitations and language-service depth can change them.

| Phase | Rough effort | Exit gate |
| --- | --- | --- |
| Discovery + interaction prototype | 1–2 weeks | Repeated evidence of the tool-switching pain; understandable two-level tabs |
| Architecture spike | 1–2 weeks | Two repositories, both checkout modes, real agent, correct editor/diff/terminal paths |
| Workspace foundation | 2–3 weeks | Persistent projects/tasks, navigation, files, editor, terminals and restart recovery |
| Agent + Git workflow | 3–4 weeks | Real task completed through agent, manual edit, stage and commit |
| Alpha hardening and pilot | 2–3 weeks | Reliable workflows with 10–20 pilot users and no known silent data-loss paths |
| Beta expansion | Subsequent months | Second provider, richer conflicts/checks/PRs, stable repeat use |

An initial alpha range is roughly 9–14 weeks under narrow scope. Full IDE parity or simultaneous platform delivery would materially expand it. Select one test platform at the start; design portability but ship what has actually been verified.

### First engineering milestone

One project, two existing repositories, two task tabs, one real agent, Explorer switching, manual editing, live diffs, a terminal, file staging and commit, and UI restoration after restart. Then add an isolated task and prove every surface uses its worktree path.

Stop and resolve architecture issues if this milestone causes wrong-repository edits, stale Git state, hidden checkout mutations or silent buffer overwrites. Prove the foundations before adding more providers.

## 11. Launch experiment

Use one recognizable pain and a real 45–60 second recording: open web + api, start one task, inspect agent edits, correct code manually, review both repositories, and commit. Show PR linking once it ships; do not fake future capabilities in the alpha demo.

Provide an installable build, a reproducible two-repository sample project, a short guide, and an honest support matrix. Keep provider setup and first reviewed change short. An open-source core is the proposed growth path; paid features can follow proven repeat use.

Proposed pilot gates:

- 8 of 10 observed users complete the sample journey without rescue.
- At least half of activated pilot users return in week two for real work.
- Median first reviewed change is below 10 minutes in the prepared sample.
- Record every external-editor escape and its reason; reduce repeated escapes for supported tasks.
- No known silent data loss or wrong-directory writes in the supported workflow.

These are internal targets, not industry benchmarks. Retention, review completion and trust matter more than generated lines, agent count, stars or downloads.

## 12. Current evidence and unresolved choices

Official sources checked on 9 October 2026:

- T3 Code product and source entry point: https://t3.codes/
- Orca product: https://www.onorca.dev/
- Monaco source/documentation: https://github.com/microsoft/monaco-editor
- Electron security guidance: https://www.electronjs.org/docs/latest/tutorial/security
- Existing Ramu app listing: https://play.google.com/store/apps/details?id=com.nerimoklinika.ramu

Implementation must verify the first provider's supported APIs, versions and licensing; editor language-service coverage; the first supported OS; and whether a reusable T3 module reduces work without distorting the data model. Public release also needs separate name/domain review. The chosen product direction and current-checkout default do not depend on those outstanding implementation choices.

## 13. Claude and Codex ACP migration completion plan

Reviewed on 12 October 2026. Detailed evidence and reproduction scripts live in [ACP-MIGRATION-AUDIT.md](ACP-MIGRATION-AUDIT.md). This section tracks the proposed migration of Claude and Codex; Cursor and Antigravity already use ACP.

**Recommendation: pursue a staged hybrid candidate, but keep the current native integrations until it proves feature parity and a maintenance benefit.** ACP offers a shared client interface; the adapters still wrap the native SDK/app-server and add another versioned dependency. A Claude library host and a maintained Codex adapter extension are feasible ways to preserve Ramu's existing behavior. Their prototypes are not a completed integration. The user explicitly authorized migration on 12 October; the candidate is now implemented with Ramu-owned ACP hosts and native extensions. Stock adapter replacement is not the selected implementation.

### Evidence already available

- [x] Audit pinned released adapters and compare them with Ramu's native features. Registry recheck on 12 October still reports Claude `0.89.1` and Codex `2.2.2`.
- [x] Establish adapter-level live feasibility for streaming, steering/cancellation during tools, MCP form/URL input, native main/helper history replay, PNG input, and manual compaction/restart. These are prior isolated audit results, not Ramu integration passes.
- [x] Establish retained native Aside feasibility and prototype paths for Claude owning-Query controls and Codex missing events/policies. Canonical Codex helper negotiation still needs a schema repair or the verified legacy workaround.
- [x] Re-run published Codex event/control/state diagnostics on 12 October. The stock gaps still reproduce; successful diagnostic assertions confirm those gaps rather than close them. Ramu's targeted current-runner baseline passes: 7 files, 157 tests passed, 1 skipped.

### Implementation and verification still required

Complete the following in order. Every unchecked item needs evidence from the combined Ramu candidate; adapter advertisements, synthetic contracts, and existing native tests alone cannot close it.

- [ ] **Candidate architecture and ownership.** Define the shared ACP client, Claude library host, Codex extensions, and retained native usage/history/Aside paths. Pin packages and extension schemas; document who owns each process/session/control, how extensions are validated, and how adapter changes are maintained. Verify controls cannot reach another chat. Compare code and upgrade effort with the native baseline before committing to this design.
- [ ] **Ramu client coverage.** Implement capability negotiation, additional roots on new/load/resume/fork, steering, effort/fast/model controls, context/plan/compaction events, streamed command output, and child events. Preserve stable IDs and terminal states; upsert compaction by `compactionId` without losing metadata. Test interleaving, completion enrichment, unknown children, late updates, and repeated replay without duplicate bubbles. Keep existing Cursor/Antigravity behavior covered.
- [ ] **Exact access and analysis policies.** Preserve Codex `edits = untrusted + workspaceWrite`, `auto = on-request + workspaceWrite`, and analysis `never + readOnly` on real turns, resumes, helpers, and settings changes. Preserve Claude access modes; enforce tool-free analysis with no tools/MCP and denied permission/elicitation. Test requested writes, denial, cancellation, and a usable parent afterwards. Plan/read-only mode selection alone is insufficient.
- [ ] **Codex native event extensions.** Forward structured subscription updates, live patch snapshots, aggregate turn diffs, and native async question metadata from the adapter's owning app-server. Verify live wire delivery, ordering, main/child attribution, and no duplicate ACP/native events. A separate app-server cannot observe the owning process's live thread state.
- [ ] **Scoped MCP and durable questions.** Preserve per-session auth, instructions, tool availability, and the one-hour wait timeout; adapt scoped tool-name matching if server names become unique. Exercise Ramu's real question store: choices/custom text, drafts, multiple pending requests, late-answer steering, decline/cancel, timeout, restart, and independent child questions. Confirm one chat never receives another chat's question or answer.
- [ ] **Helpers and dynamic routing.** Use repaired or explicitly negotiated legacy Codex child support. Map native task IDs to stable Ramu children. Verify Claude direct Stop through the owning Query, Codex's existing parent relay, nested/resumed/background helpers, scoped approvals, changing per-type/quota routes, Codex hook trust/config refresh, and cross-provider children. Main-turn completion must retain the checkout writer while helpers run and delay change capture until they finish.
- [ ] **Usage, fallback, and reset return.** Verify structured on-demand reads, freshness/cadence during turns, threshold switching, actual limit errors, main/child fallback chains, same-provider session retention, provider holds, and return after reset through the candidate. Use deterministic injected windows/errors for thresholds and a bounded live check for transport; exhausting a real account is unnecessary.
- [ ] **Existing-history recovery.** Load representative direct-native fixtures with tools, helpers, manual compaction, and historical provider fallback. Test partial tool results, missing provider history, continuation, and two successive restarts through Ramu's database mappings. Preserve evidence from successful providers when another read fails; do not label transcript restoration as a running process.
- [ ] **Aside and background analysis lifecycle.** Retain native ephemeral/tool-free behavior or prove an equivalent replacement. Beyond prior idle/active-parent tests, exercise in-flight context freshness, abort/stop races, provider exit, failed forks, and cleanup failures. Verify parent history and durable thread lists remain correct.
- [ ] **Settings, attachments, and automatic compaction.** Test real model availability, rejected setting changes, effort/default clearing, Codex Fast/Standard, attachment variants, output exit codes, and automatic compaction through the resulting UI/state mappings. Re-run restart/continuation after automatic compaction; the existing manual `/compact` result does not certify it.
- [ ] **Ramu workflows added since the audit.** Cover Advisor's nonblocking steering and wait/stop behavior, Claude native-advisor suppression, and Goals continuation/pause/limits/restart under the candidate's terminal states. Track existing pending-advice restart and model-compliance limitations separately; a migration must not silently worsen them.
- [ ] **Workspace and review journey.** Complete the two-repository signature workflow in current checkouts and isolated worktrees: agent edit, manual correction, task switch, restart, review, checks, stage, and commit. Include shared-checkout writer coordination, Undo, child patch application/conflicts, schedules, and recaps. Assert every surface uses its actual binding and background completion cannot release a writer early.
- [ ] **Packaged runtime and failure recovery.** Verify adapter install/update/version management, configured executable paths, existing login, clean-machine setup, paths with spaces, process crash/restart, and supported-platform packaging. Certify only platforms actually tested. Resolve or explicitly record earlier audit-fixture cleanup uncertainty separately from candidate cleanup checks.
- [ ] **Candidate acceptance and rollout.** Run `pnpm check`, relevant desktop automation, and live-provider compatibility against the exact candidate revision and pinned adapters. Record each gate's test/fixture, expected outcome, observed result, and platform. Prepare a reversible provider-by-provider rollout with native rollback that preserves settings, session IDs, histories, and pending-question records. The user's migration instruction was received on 12 October; packaged rollout validation is still required.

Completion means every candidate gate above has reproducible passing evidence, any retained limitations are explicitly accepted, and the rollout is authorized. The integration status is **implemented; extended release acceptance incomplete**. Avoid removing native paths solely to make the architecture appear uniform.

Implementation note (12 October): Claude and Codex now cross the official ACP SDK through local Ramu-owned hosts retaining their native backends. OpenCode switched to native CLI ACP; Cursor/Antigravity remain native ACP. New targeted transport tests and live Claude/Codex/OpenCode turns pass. Provider accounts/update controls, GitHub app-update staging, service build identity/pinned runtime, explicit restart choices, and keep-awake power-source settings are implemented. Unchecked acceptance gates above remain open wherever their full scenario matrix has not been exercised; no stock-adapter or packaged-updater parity is implied.

### Provider settings, updates, and keep-awake implementation

- [x] Replace install/setup panels with Login, Update CLI, optional CLI auto-update, and Advanced paths.
- [x] Add named Codex/OpenCode credential profiles; pin chats/helpers/history to their original profile and separate account usage windows.
- [x] Run provider checks/updates and GitHub app-update checks/downloads in the detached service.
- [x] Identify the service with the app version plus a content hash; preserve its pinned runtime during app-only updates.
- [x] Require an explicit app restart choice; provide a separate confirmed app-and-service restart.
- [x] Add keep-awake, initially off and enabled on first login-startup installation. Default to plugged-in-only; allow plugged-in plus battery. Verify the underlying macOS assertion without requiring startup installation.
- [x] Verify deterministic ACP transport, 3 live provider turns, the full automated checks, and desktop settings/recovery smoke tests.
- [ ] Validate first-time startup installation and a signed published app update on a separate machine. Unsigned builds and other platforms retain manual app installation.

Detailed migration acceptance scenarios above remain open where their entire matrix has not been exercised.
