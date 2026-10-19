# Remaining workspace defaults and naming work

Current behavior is in [UI](UI.md#workspace-defaults-and-branch-names).

Default automatic project selection, the retained Auto/manual project dropdown, Settings control, ambiguity handling and pre-thread routing are planned in [Assistant workflow](ASSISTANT-WORKFLOW-PLAN.md#1-automatic-project-selection-default). Resolve the project before applying workspace defaults; explicit project and draft choices take precedence over routing and global defaults.

## Smallest usable delivery

A person starts a thread with the host default or chooses an existing workspace, sees where the agent will work and can correct the choice before creation. Prioritize preserved draft/outbox intent and scope; manual/generated branch controls remain optional details and never a prerequisite for starting work with a valid default. Validate creation and reconnect from both Home and a scoped entry point, with the displayed checkout matching files, terminal and agent execution. Follow the [root product and planning guidance](../AGENTS.md#product-design-and-architecture) for this and later increments.

## Ramu design and architecture

Follow [Architecture](ARCHITECTURE.md) and [UI](UI.md). Extend Settings → Git, existing New thread controls and mobile sheets with shared app controls/tokens; do not edit shadcn primitives or introduce another workspace wizard. Allocation, branch generation and label persistence remain in the current server workspace services and validated named API; preserve checkout/Git locks and idempotent creation. Route changes to the selected host, qualify cached state by host and keep device drafts/outbox intent separate from execution-host defaults. Provider inference uses existing adapters, and the UI never executes Git or allocates paths directly.

## Remaining implementation

- Add explicit Generate name, editable candidates and provisional previews on mobile. Verify real-provider cancellation, quota errors, generated-name UX and reconnect/device behavior. Desktop controls and server generation have focused fake-provider/Git coverage.
- Persist explicit desktop draft provenance and restore manual/default/reused choices. Mobile stores these choices with the active project draft; extend restoration coverage to all entry points and storage-failure recovery. Freeze preview bases in the outbox alongside the naming inputs already captured at enqueue. Review changed bases after a queued preview.
- Add a shared workspace label edit independent of thread titles and Git branch names. Extend mobile existing-workspace selection acceptance to lost acknowledgements, reconnect, removed worktrees and physical devices; the server revalidates readiness at delivery.
- Extend capability/missing-method handling beyond mobile workspace catalog/default discovery, including naming controls. Improve unavailable-mode reasons in mobile pickers and verify offline default behavior and every issue/PR/keyboard entry point.
- Extend case-insensitive filesystem allocation checks, namespace collisions and restart recovery evidence. Pending database reservations and per-repository Git locks exist; cross-process allocation beyond this host service still needs analysis.
- Complete English/Indonesian wording, native visual/keyboard/accessibility acceptance, and generated/manual-name edge cases.

## Acceptance and checks

- Shared/settings tests: defaults/migration, blank and nested prefix, invalid values, host Mixed/reset/edit conflicts, old capabilities, explicit/manual/reuse precedence, changing defaults mid-draft and across hosts, no project-layer assumptions.
- Real temporary-Git integration tests in the existing server suite: current checkout preserves branch/index/stash/tracked/untracked state; worktrees start from recorded commits without copying dirty files; multi-repository planning and detached HEAD; plain folder/unborn/mixed projects; duplicate and case-conflicting names, bounded suffix allocation, malicious paths/refs; concurrent preview/create, moved HEAD, lost acknowledgement, partial setup and safe retry ownership. Preserve existing `workspace.test.ts` regression coverage rather than replacing the engine.
- Focused client/mobile tests: all new-thread entry paths, settings arrival/error, manual override preserved, stale preview results discarded, existing workspace validation, immutable outbox intent and reconnect without duplicate creation. Generation tests cover invalid/taken output, limits/timeouts, manual-edit races and no post-cancel mutation; use fake providers.
- Run shared/server/web/mobile tests and types scoped to the implementation touched. For desktop-facing changes run `pnpm build` followed by the single `pnpm test:desktop-smoke`; do not add a parallel desktop end-to-end suite. Implementation changes require the listed scoped checks and desktop smoke test.
- Manual desktop and iOS/Android acceptance: keyboard/focus, large text and screen-reader labels for mode/base/name/path; two paired hosts with different defaults; settings changed while composing/offline; two threads sharing a worktree; new worktree creation from a dirty checkout and recovery after restart. Verify displayed workspace/branch matches agent cwd, files, terminal, Source Control and review scope.
