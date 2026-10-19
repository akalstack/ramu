# Manage agent-started background terminals

## Human need and smallest usable delivery

An agent starts a development server, watcher or other persistent command, finishes its reply, and leaves the person unsure what is still running or how to stop it. A person must be able to find that work, identify its thread and execution host, read its output and stop it without asking another agent or finding a process ID.

The first delivery is a thread-scoped **Background terminals** entry in the existing thread activity/detail surfaces, opening the existing terminal area. List agent-started persistent commands with their current state, output and supported stop control. Keep access after the agent becomes idle, without configuration or a separate management page. Validate with a real development server started by an agent, then inspected and stopped by a person after the turn ends.

## Ramu design and architecture

Follow [Architecture](ARCHITECTURE.md), [UI](UI.md#workspace-and-terminals) and the [root product guidance](../AGENTS.md#product-design-and-architecture). Extend existing navigation, terminal panes, thread activity and services. Keep advanced details optional and preserve drafts, focus and the ability to review, correct, stop and recover work.

- The execution server owns command identity, lifecycle, output, persistence and authorization. Clients call validated named methods in `packages/shared/src/api.ts`; renderers and device shells never discover or kill host processes.
- Extend `apps/server/src/workspace/pty.ts` (`TerminalService`) and `apps/server/src/ipc/handlers/terminals.ts` for Ramu-owned terminals. Reuse `term.list`, `term.snapshot` and terminal change/output/exit events where their contracts fit. The current in-memory PTY list and foreground `busy` heuristic do not establish ownership or liveness of detached background commands.
- Extend existing provider adapters/runners to report provider-owned command handles and inspect/stop/input capabilities. A provider's persistent tool process is not automatically a Ramu PTY. Preserve native execution when it serves this flow; never infer attach or stop support from transcript text, a PID or a port number.
- Reuse `apps/web/src/workspace/TerminalPanel.tsx`, `terminalRegistry.ts`, `views/TerminalView.tsx` and existing thread activity/detail controls. Keep one server-owned state model across surfaces. Compose Ramu components outside `components/ui/`, using existing tokens, refs, composition and accessibility patterns.
- Qualify command identities, queries, events and mutations by execution host and owning thread/workspace. Reuse host routing and capability/role checks. Device layout preferences stay on the device; reconnecting or switching hosts never redirects a control to another host.

## Provider feasibility and delivery path

Initial source inspection found the following starting points; these are not completed live-provider acceptance:

- **Claude Code:** the installed Agent SDK exposes background-task lifecycle events and `stopTask()`. Ramu already consumes task events in `agent/claudeStreamPump.ts` and routes native task stops in `agent/agentTasks.ts`. Start by verifying a background Bash server's identity, output access and individual stop after the parent turn ends; helper-task support alone does not prove terminal management is complete.
- **Codex:** `providers/codex.ts` already consumes command execution output events. The shared runner currently exposes turn interruption, without an individual-command stop contract. Verify the installed app-server's native command handles, output lifetime and targeted termination before enabling controls; a turn interrupt is not a substitute for stopping one persistent server.
- **ACP providers:** the [ACP terminal protocol](https://agentclientprotocol.com/protocol/v1/terminals) defines create, output, wait, kill and release operations. Ramu currently advertises `terminal: false` in `providers/acp.ts`. Implement the client-side terminal boundary through the execution server and enable it only after verifying that the specific provider uses it. Protocol support does not establish support in every provider runtime.
- **Other native runners:** verify OpenCode and Cursor individually through their current adapters/runners. Until a targeted lifecycle contract is demonstrated, report unavailable capabilities rather than guessing from tool output.

For consistent management across providers that can call Ramu tools, add a managed persistent-command launch tool through the existing agent tool registry/MCP boundary, backed by the existing server terminal service. This is planned work, not an already-exposed terminal tool. Return the stable command identity and instruct agents to use this path for servers/watchers when native lifecycle control is insufficient. Preserve execution scope, access policy and required tool approvals; never use this path to bypass a provider restriction. Native commands remain supported where verified. Arbitrary processes launched outside either tracked path cannot be guaranteed discoverable or controllable.

## First delivery behavior

1. **Find running work.** Show a quiet count/link when the thread has tracked background work, including sub-agent work with source attribution. Commands do not count as agent helpers or make a completed turn appear to be thinking. Preserve access when the thread is idle, archived or reopened.
2. **Recognize a command.** Show a readable command label, running/stopping/exited/failed/unknown state and start time. Details expose the full command when available, working directory, host, parent thread and sub-agent origin. Unknown metadata stays unknown. Reported local URLs use existing link routing; printed URLs do not establish readiness.
3. **Inspect output.** Open an existing terminal by identity without spawning another shell. Provider-owned commands use the same detail surface with bounded output, labelled as an excerpt when appropriate. Preserve scroll/selection and offer resume-following output. Expose interactive input only when supported by the owner.
4. **Stop owned work.** Provide **Stop** through the command's actual owner. Request graceful interruption/termination and show stopping until acknowledged. Offer **Force stop** only when supported after graceful stop fails or times out, explaining its effect. Target the owned process group/job, never an entire provider session, unrelated shell, matching process name or reused PID. Preserve final output and exit outcome. Repeated requests and already-exited commands are safe.
5. **Keep lifecycle understandable.** Hiding the list or closing its output viewer leaves the command running. Keep existing ordinary terminal-tab close semantics explicit; inspect and stop are distinct for this flow. Completing or stopping an agent turn does not itself stop a deliberately persistent command. If provider shutdown necessarily ends its commands, report that outcome. Feed human stop actions into the existing agent event/session boundary so the agent does not silently relaunch the command; restarting needs a new explicit instruction.
6. **Recover honestly.** Navigation, window close and client disconnect leave server-owned work alone. Reconnect reads authoritative state and resumes output by cursor without duplicate rows. After server/provider restart, reconcile durable ownership records with live handles; report unknown/unavailable when survival cannot be established. Never replay saved launches automatically. Before deleting a thread or removing its workspace, surface remaining owned commands and require an explicit stop-and-remove or cancel choice before destroying their execution scope.

## Remaining implementation

- Trace persistent execution paths for each supported provider and record actual capabilities. Deliver one supported end-to-end path first; unsupported providers show a reason. Route Ramu-managed launches through the existing terminal service and register native executions through their provider boundary. Do not claim coverage for arbitrary unregistered daemonized processes.
- Add shared metadata: stable owner-qualified ID, thread/sub-agent and workspace association, backend, command/cwd, timestamps, state, output cursor, exit outcome and action capabilities. Keep command lifecycle separate from agent-turn/helper status. Bound output retention/history; do not persist environment variables or credentials as metadata, and preserve existing output access rules.
- Extend server list/snapshot/event and stop contracts with ownership validation, authorization, idempotency and restart reconciliation. Keep provider handles opaque and revalidate them on every action. Disconnected, unsupported and old-host controls explain their limits; cached rows cannot authorize mutations.
- Compose discovery and details from existing desktop components, preserving composer drafts, navigation position, keyboard focus and output performance. Cover empty/loading/error/offline states, English/Indonesian copy and screen-reader labels. State must not depend on color.
- Deliver mobile list/output/stop through existing thread/terminal sheets as a separate increment using the same typed API. Unsupported input or force-stop capabilities have a clear explanation; device-local commands never substitute for host control.

## Acceptance and validation

- Representative task: ask an agent to run the project's development server and leave it running. After its reply finishes, find the command, inspect logs/location, hide/reopen the viewer and stop it. Confirm the owned server exits and releases its port while another thread's server remains running. The transcript reflects the human stop and the agent does not relaunch it on its own.
- Focused shared/server tests cover registration/deduplication, provider/Ramu ownership, same IDs on different hosts, wrong-thread/role rejection, graceful/force-stop capabilities, exited-before-stop races, lost acknowledgements, bounded output/cursors, descendant cleanup and stale/reused handles. Use existing suites and fake providers; use real process integration tests where termination crosses the OS boundary.
- Focused client tests cover discovery after turn completion, sub-agent attribution, host dispatch, read-only versus interactive output, hide versus stop, unsupported/old hosts, reconnect without duplicate launches, preserved drafts/focus and truthful unknown state after restart. Verify thread/workspace removal cannot leave unacknowledged tracked work behind.
- Manual acceptance covers a real supported provider, two hosts, concurrent servers, graceful-stop failure, server/provider restart, archived-thread reopening, long/noisy output, keyboard navigation, screen readers, large text, narrow layouts and translations. Verify platform-specific termination rather than assuming POSIX behavior everywhere.
- Run affected package tests and typechecks for implementation changes. Desktop-facing work additionally requires `pnpm build` followed by the single `pnpm test:desktop-smoke`, without rebuilding during smoke. Documentation-only edits need formatting and local-link checks.

## Later options

Add project/host-wide discovery through existing workspace or Inbox surfaces if people cannot find commands whose thread they have forgotten. Explicit restart with reviewed command/cwd, bulk stop, resource metrics, port discovery and automatic cleanup policies are separate increments requiring demonstrated need. A general OS process manager or automatic service supervisor is outside the first delivery.

Remove delivered items, move lasting behavior into feature guides and retain outstanding checks here or in [the roadmap](ROADMAP.md). Delete the plan when nothing remains.
