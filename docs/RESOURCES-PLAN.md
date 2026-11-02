# Resources

Show what Ramu's agents and terminals are using on each host, and let the person free memory in one step. Remove work as it lands, document shipped behavior in the feature guides, and delete this plan when implementation and acceptance are finished.

## The need

Several agents on one host can exhaust its memory; a single coding agent can reach gigabytes. When a laptop or server slows down, the person has to open Activity Monitor or `top`, read a list of `node` and `claude` processes, work out which thread owns each one, and kill it by hand, which risks stopping the wrong work. On a phone or a remote host, they cannot do this at all.

**Easier for the person:** the question "what is using my memory, and what can I stop?" is answered by thread name inside Inbox, on any connected host, with Stop one tap away. When a host runs low, Ramu says so and names what can safely stop.

## Decisions

- **Called Resources.** "Memory" already means agent memory in Ramu ([Memory](MEMORY.md)).
- **No new navigation.** Figures live in Inbox's **Running** tab, which already lists this work on desktop and phone and across hosts. There is no status bar, panel or page to learn.
- **Ramu's work only.** It is not a system monitor: there are no per-process lists of other applications, and no killing of anything Ramu did not start.
- **Threads are the unit.** Rows are threads, not process trees. A helper or command counts toward the thread that started it.
- **Current values only.** No history, charts or stored samples, for CPU as well as memory.
- **Ramu never stops work by itself.** It only suggests, with no automatic limits per thread, because a limit that fires can stop the work the person cares about most.
- **Resident memory, not exact footprints.** Figures stay approximate, because exact macOS footprints need a slow per-process read and would not change which thread to stop.
- **Nothing on Home.** Home has no lists, and the low-memory row in the Brief already reaches the person.
- **Sampling is cheap and on demand.** Per-process figures are read only while someone is looking.

Orca's resource manager is the reference for the need, and for separating host memory from per-process totals. Ramu leaves out its charts, per-repository buckets and status-bar panel.

## Delivery

```
Inbox · Running

vps      12.4 of 16 GB used · Ramu 8.1 GB              Low memory
macbook  21 of 36 GB used · Ramu 3.2 GB

Checkout API             Working    4.2 GB   Stop
  Agent 3.1 GB · pnpm dev 1.1 GB             Stop
Backfill dueDate         Idle       2.6 GB   Stop
Ramu (service, browser)             1.3 GB
```

- **Host line:** one line above the Running list per host: memory used of total, Ramu's total and **Low memory** when applicable. With no threads running, the tab still shows the line.
- **Thread rows:** the existing rows gain a memory figure while open, sorted highest first within each host. CPU appears only when a thread is above one full core, as **Busy**, since instant CPU percentages mostly add noise.
- **Thread detail:** expanding a row shows its agent, terminals and background commands by the names the thread already uses, each with Stop. Command-line arguments are never shown.
- **Stop:** an agent stops through `agent.stop`, and a command or terminal through its existing stop path, so the thread and its transcript stay and the person can continue later. Stopping work in progress names the thread and asks first; stopping an idle thread needs no confirmation. Stopped rows leave the list as their state changes.
- **Left running:** commands and terminals still alive under a finished or archived thread get a **Still running** label, so forgotten dev servers are found and stopped.
- **Ramu row:** the service, Host Chromium and, on desktop for the local host, the app's own windows and browser tabs. It is read-only. Desktop's figure comes from Electron on the device; hosts report the rest.
- **Low memory in the Brief:** when a host stays below a low-memory threshold across two checks, Inbox's Brief gains one row, ordered after limits and paused goals: **vps is low on memory: 2 idle threads use 5 GB**, with **Stop idle** and **Open**. It clears when memory recovers. Only idle threads are offered, and the row counts toward the Inbox badge like other items that need the person.
- **Phone:** the same line, figures and Stop in the Inbox Running tab, and the same Brief row. No separate screen.

## Host service

- Add `resources.snapshot` and validate it with `zod`. It returns host memory, per-thread totals with their items, and Ramu's own total; it never returns paths, arguments or environment values.
- Host memory comes from `os.totalmem`, plus `/usr/bin/memory_pressure -Q` on macOS and `MemAvailable` from `/proc/meminfo` on Linux, because `os.freemem` alone reports a healthy Mac as nearly full.
- Per-process figures come from one bounded `ps` run with `execFile`, building a parent map once. Each known root collects its descendants. A process counted under a thread is not counted again under Ramu.
- Figures are resident memory, shown as approximate, because resident sizes can repeat shared pages.
- Concurrent callers share one in-flight read, and a short cache stops many viewers multiplying `ps` runs. Clients poll every 5 seconds only while Running is visible.
- The low-memory check runs from host figures once a minute, without `ps`, and reaches clients with the free-memory figure through the existing inbox state.
- Roots come from what the service already started: `pty.ts` entries already carry `taskId` and lead their own process group, and Codex, OpenCode and ACP sessions own their child process. The Claude SDK does not expose a process id to Ramu today; capture it where `agent.ts` starts the query, or attribute it from its session's descendants. Check this first, because it decides whether the largest figure is accurate.
- Ramu's total includes unattributed descendants, so nothing it started goes missing.

**Access:** `resources.snapshot` stays off the viewer allowlist in `packages/shared/src/viewerAccess.ts` and off `HOST_METHODS`, so viewer devices and paired hosts cannot read it. Stop reuses existing methods and their authorization, and the server resolves targets from its own records rather than accepting a process id from a client. Viewers see Running as it is today.

## Services to extend

`apps/server/src/workspace/pty.ts`, `apps/server/src/agent.ts`, the provider runtimes in `apps/server/src/providers/`, `apps/server/src/ipc/handlers/`, `packages/shared/src/api.ts`, `packages/shared/src/hostInbox.ts`, `apps/web/src/inbox/`, `apps/mobile/src/app/(tabs)/inbox/`, and `apps/desktop/src/main/hostOverview.ts` for the app's own figure. Host-memory parsing and the process tree are pure functions with tests.

## Acceptance

- **Representative task:** with three agents and a dev server running, and memory low, a person finds the heaviest thread and frees its memory from Inbox in under 30 seconds without leaving Ramu, then continues that thread. Repeat on a phone against a remote host.
- Thread figures sum, with the Ramu row, to the total shown, and no process is counted twice.
- Thread figures are checked for each provider on a live run, including Claude and a helper agent.
- Stop on an idle thread keeps its transcript, and the next message resumes it. A background command stops with its whole process group.
- A viewer device and a paired host are refused `resources.snapshot`, and responses contain no paths or arguments.
- With Running closed, no `ps` runs. A host with hundreds of processes keeps its snapshot bounded and quick.
- macOS and Linux report host memory close to Activity Monitor and `free`. An unsupported or failed reading hides figures rather than showing zero.
- Strings have Indonesian translations and rows stay accessible by keyboard and screen reader.
