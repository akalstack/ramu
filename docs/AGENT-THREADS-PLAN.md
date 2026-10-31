# Threads started by agents

Agents start, follow and message threads in this project, another project or on another paired host. Remove work as it lands, document shipped behavior in the feature guides, and delete this plan when implementation and acceptance are finished.

## The need

Someone working in one thread often finds work that belongs elsewhere: a follow-up in the same repository, a matching change in the API project, or tests that only run on the Linux box. Today they stop, open a new thread, choose the project, host and checkout, rewrite the context, then come back and check on it. Agents can start only helpers (`ramu_agent`) that report to the current thread. They cannot start a thread the person owns, reach another project or use another host.

**Easier for the person:** one sentence ("start a thread in the API project to add the field", "run the full suite on my Linux box") replaces five manual steps. The new thread gets a written brief, so nothing is retyped. The result comes back to the thread that asked, and both threads link to each other.

## T3 Code reference and intended improvements

Observed through T3 Code's agent tool surface (server 0.1.5, 2026-11-01), not its source. These are design inputs, not claims about how T3 implements them.

| T3 Code                                                                                                                                                                                                                                            | Ramu approach                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `t3_thread_launch` starts one top-level thread. It inherits the caller's project, model and modes unless `projectId`, `scratch`, `environmentId` or `workspaceStrategy` (root, existing worktree, new worktree from `baseRef`) is given. Modes cannot exceed the caller's. | The same reach, plus a **project named in words**: the destination is resolved by the existing Home Auto router (`workspace/projectRouter.ts`), and an ambiguous name asks the person instead of guessing. The agent never has to list projects and copy IDs first.                                                                     |
| `create_threads` starts up to 20 threads in this checkout.                                                                                                                                                                                         | Up to 8 per call, shown to the person as one card listing every thread before anything starts, when approval is needed.                                                                                                                                                                                                                      |
| "Uncommitted edits are not copied" into a new worktree.                                                                                                                                                                                            | **Bring my uncommitted changes**: the new checkout starts with the caller's working-tree patch, reusing `collectPatch` and `applyIsolation` from sub-agent isolation. The source checkout is left untouched.                                                                                                                                 |
| `delegate_task` sends only the task, with no parent history. `t3_thread_transfer` forks full context.                                                                                                                                              | The new thread receives a **brief**: the agent's prompt plus a bounded, secret-redacted summary built by the existing context handoff (`agent/handoff.ts`). The brief appears as the thread's first message, visible and editable before sending when approval is needed.                                                                      |
| `delegatedFrom {environmentId, threadId, title}` records provenance. `t3_thread_wait`, `t3_thread_read` and `t3_thread_send` follow up.                                                                                                             | Provenance is visible to the person in both directions: **Started from ‹thread›** on the new thread and a card in the caller's transcript. When the new thread finishes or waits for input, a short report goes back to the caller, as PR-watch feedback does today ([Pull requests](PULL-REQUESTS.md#watch-in-a-thread)).              |
| Linked environments: every tool accepts `environmentId`. An unlinked machine named in words ("my vps") starts linking from that hint, without a code in chat.                                                                                      | Hosts link through **host-to-host pairing**: one host pairs as a device of another with a scoped role, approved at the target with the existing number match. An agent may request pairing; only a person completes it. Revoke stops everything at once.                                                                                    |
| No depth or loop limit observed.                                                                                                                                                                                                                   | Agent-started threads may start threads only one level further, and a thread may start at most 8 threads per hour. Both limits explain themselves when reached.                                                                                                                                                                            |

## Naming

- Product copy keeps **thread**, **project**, **host** and **pair** ([Architecture](ARCHITECTURE.md)). T3's "environment" is Ramu's host and "link" is Ramu's pair. Rename the one outlier, **Apply settings to → All environments**, to **All hosts**.
- A **helper** (`ramu_agent`) works for the current thread and reports to it. A **thread** started by an agent belongs to the person, appears in the sidebar and continues on its own. The tool descriptions state this difference so agents pick the right one.
- Agent tools, registered beside `ramu_agent` and `schedule_*` in `apps/server/src/index.ts`: `thread_start`, `thread_status`, `thread_message` and `project_list`. Each takes an optional `host`. `ramu_agent` gains the same optional `host`.

## Delivery

### 1. Same host: this project and other projects

- `thread_start` with `prompt`, optional `title`, `project` (ID or name; omitted means the caller's project), `checkout` (`current`, `worktree` with optional `branch` and `base`, or the destination's default) and `bringChanges`. Model, effort and access inherit from the caller and can only be narrowed. It builds `CreateTaskInput` and goes through `tasks.create` and `agent.start`, so drafts, branch naming, workspace defaults and title generation behave as they do for a person.
- **Approval without a new setting.** In Full access, a thread in the caller's own project starts at once. Another project, a batch, or any non-Full mode shows one card with the destination, checkout, brief and **Start**, **Edit brief** and **Don't start**, plus **Allow for this thread**. Viewer-role devices see the card read-only.
- `thread_status` returns state, the last report and pending questions for threads this thread started. `thread_message` queues or steers them, never above the caller's access. `project_list` returns names, aliases and descriptions only.
- Phone: the approval card and both provenance links work there. A finished report sends a push only when the caller's thread is not on screen.

### 2. Other hosts

- **Host-to-host pairing.** `ramu pair` and **Settings → Remote access → Pair a device** accept a host as the paired device, through the same `POST /pair` and number match. New role permission **Start threads** (off for existing devices) beside computer use, browser, terminals and settings. The pairing token is stored in `credentials/` on the requesting host, never in preferences.
- **Agent requests, person approves.** Naming an unpaired host ("my vps") resolves against discovered and named hosts. The caller's thread shows **Pair with ‹host›**, and the target shows its usual request with the six-digit number. The agent's turn continues and is told pairing is pending.
- **Remote threads.** `thread_start`, `thread_status`, `thread_message` and `ramu_agent` with `host` call the target over one `RuntimeSocket` per paired host, with an `operationKey` so a retried start runs once. Provenance names both hosts. If the target is offline, the card shows **Waiting for ‹host›** and the start is kept for 24 hours, then fails visibly with **Try again**. `bringChanges` sends the patch only within the existing upload bounds.
- Update [Security](../SECURITY.md), [Headless server](HEADLESS-SERVER.md) and the roadmap's **Preference sync** note, which says hosts never talk to each other. Credentials and settings still never sync between hosts.

### Later options

Kept out of this delivery: fork or merge back a thread's full context, scheduled starts on another host (schedules already start threads locally), and starting threads from the phone's own agent picker.

## Services to extend

`tasks.create` and `SessionStarter` for starts; `workspace/projectRouter.ts` for names; `agent/handoff.ts` and `memory/secrets` for the brief; `workspace/isolation.ts` for `bringChanges`; `subagentRunner.ts` for the report-back and stop pattern; PR-watch delivery for queued feedback; `remote/devices.ts`, `remote/pairingRequests.ts`, `remote/permissionRequests.ts` and `packages/client-runtime` for host-to-host calls; the existing permission card for approvals.

## Acceptance

- In a Full-access thread, "start a thread to write the migration" opens a sidebar thread in the same project with a brief. Its report returns to the caller, and the two link to each other.
- "Do the matching change in the kelarin project" in Ask mode shows one card naming kelarin and the checkout. **Don't start** leaves nothing behind. An ambiguous name asks which project.
- `bringChanges` into a new worktree reproduces the caller's uncommitted diff and leaves the caller's checkout unchanged.
- A started thread cannot exceed the caller's access. A third level of agent-started threads and a ninth start in an hour are refused with a reason.
- With two hosts: an agent asks to use an unpaired host, the person allows it at the target with matching numbers, and the thread runs there. Revoking stops it within the heartbeat. A viewer-role pairing cannot start threads.
- With the laptop app closed, a headless host starts a thread on another headless host. Taking the target offline shows **Waiting for ‹host›** and resumes when it returns.
- Representative task: from one thread, change an API in one project, update its client in another and run the suite on a second host, without opening a new thread or retyping context by hand.

Tests: server tests with the fake provider for start, approval, limits, provenance and report-back; client-runtime tests for host-to-host pairing and retried starts. Desktop changes run `pnpm build` then `pnpm test:desktop-smoke`. Two-host and phone checks stay open under [Acceptance](ROADMAP.md#acceptance) until run.
