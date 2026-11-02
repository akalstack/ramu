# Work across hosts

Let a person send work to the machine that can do it, and see that work from one place. Remove work as it lands, document shipped behavior in the feature guides, and delete this plan when implementation and acceptance are finished.

## The need

Some work only runs on one machine: a Linux-only failure, a GPU box, a server inside a private network. Agents can already start a thread on another host ([Agents and routing](AGENT-ROUTING.md#threads-on-another-host)), but only after a host pairing, only for a project that already exists there, and only with a brief the agent writes. To move a half-finished investigation, a person re-explains it, finds the project is missing, clones it by hand on that machine and pastes context across. Afterwards nothing connects the two threads.

**Easier for the person:** from the thread they are in, **Continue on ‹host›** shows what will travel, sets the project up if it is missing, and starts the work there after one confirmation. The two threads stay linked, and the result can come back with one action.

[Threadlines' Fleet](https://github.com/Threadlines/threadlines/releases/tag/v0.8.0) (move a thread to another computer, set up a project there) is a reference for the need only. Ramu keeps its own navigation, approvals and host isolation.

## Decisions

- **No Fleet page.** Hosts already have the sidebar switcher, **Settings → Remote access** and Inbox's all-hosts view. This adds actions to existing menus and sheets.
- **The person's device does the crossing.** A desktop or phone is already an owner on every host it connects to, so a person's action calls each host directly, as `threads.startGroup` does for Auto splits. No host pairing or **Agents** grant is needed, and viewer devices are refused on both hosts.
- **`HOST_METHODS` keeps its four methods.** A paired host never clones and never reads a transcript. A compromised agent on one host therefore cannot make another host fetch a repository. An agent that finds the project missing tells the person, who uses **Continue on ‹host›**.
- **A copy, not a move.** The new thread starts fresh on the other host. The original stays, labelled **Continued on ‹host›**. A running agent session never migrates, and the original must be idle or stopped first.
- **Files stay, the conversation travels.** Uncommitted files never leave a host, and the other host starts from pushed commits. The transcript does travel and can quote code, tool output and uncommitted content, so the sheet says so before anything is sent. The other host's model provider may also be a different account.
- **Every step is confirmed.** One confirmation covers the sheet as shown, including a clone it names. Nothing starts from a suggestion alone, and access defaults to **Allow edits** on the other host whatever the original used.
- **Same-user processes are not a boundary.** The local socket gives any process of this OS user owner access, and Ramu cannot tell which tool called it. Terminal commands therefore get attribution and sensible defaults, and are documented in [Security](../SECURITY.md) as trusted like the person. They are not given per-tool approvals that could not be enforced.
- **Windows waits.** Windows is unsupported, so nothing here is tested or promised on it until it is.

## Delivery

Each stage is useful alone. Stage 1 ships first, and later stages start from what it shows.

### Stage 1: Continue on another host

- **Starting:** **Continue on ‹host›** in the thread menu on desktop and phone, listing hosts this device is connected to, or **Continue on another host…** for several. It sits beside **Continue in new chat** and is hidden from viewer devices.
- **Sheet:** built from the same review pattern as `SplitReview`. It shows host and platform, the project there, branch and commit, what is left behind, the model that will run, access, and an optional note. Each row states a problem with its fix, and nothing starts until all are settled.
- **Project match:** by normalized Git remote URL on the other host, not by name, because names differ between machines. A match by name alone is offered but needs a choice.
- **Set up on ‹host›:** when no project matches, the sheet offers a clone of the same remote, with a folder prefilled from where that host keeps its projects. It reuses `folders.clone` with its progress and cancel, and adds the project. The other host uses its own credentials. If the clone fails, the sheet shows why, removes the partial folder and starts nothing. Only single-repository projects can be set up this way; a multi-repository workspace must already exist there, and the sheet says so.
- **Work left behind:**
  - Uncommitted or unpushed work offers the existing **Commit and push** flow, or continuing from the last pushed commit with the difference listed.
  - A project with no remote cannot continue, and the sheet explains why.
  - The other host checks out the pushed branch in a new worktree, so its own checkout and changes are untouched.
- **What travels:** a thread handoff with `redactSecrets` applied, bounded to fit `thread_start`'s 100,000-character prompt, plus the note. Provider-private reasoning, attachments and queued messages stay, and the sheet lists any queued messages. A goal travels as context and is not started there. References to `session_recall` are removed, because those event numbers exist only on the original host.
- **Model:** the thread's provider and model when the other host has them, otherwise its default, shown before starting. Fallback and limits follow that host's settings.
- **Linking:** the new thread records the original's host and thread, and shows **Continued from ‹thread› on ‹host›**. The original records the new thread and shows **Continued on ‹host›** with **Open**. If recording on the original fails, the started thread still stands and the label is retried. Connected clients nest the new thread under its original; when the original's host is not connected, it stays a labelled row.
- **Bring back:** when the new thread settles, the original offers **Bring back result**, which queues its latest reply there, labelled with its host. Nothing is carried automatically. The usual notification names the host and opens the thread.
- **Archive the original:** the same banner offers **Archive**, with Undo. It is never archived by itself.
- **Retries:** the start carries a key, so a lost reply finds the same thread instead of starting a second one. A host that drops before starting leaves the sheet open with its contents and starts nothing.

### Stage 2: Choosing hosts

- **Several hosts at once:** the sheet can target up to 4 hosts, each with its own rows and outcome, and one failing does not stop the others. Each host gets a new branch from the same commit, so agents never share one.
- **Host suggested for the work:** each host reports its OS and architecture, and may carry a short description the person writes (`GPU box`, `office network`). Ramu does not detect capabilities. The sheet lists hosts with the project and the thread's model first, and marks a platform or description the thread's latest request names with a plain text match and no model call. `hostThreads.projects` adds the same host facts, so `project_list` lets an agent recommend a host in its reply.
- **Scheduled work on a chosen host:** the Automation editor gains **Runs on**, saving through `schedules.save` on that host, and lists schedules from every connected host with a host label. Schedules already live on their host, so it fires them, follows its own **Missed** setting and never runs twice. Moving a schedule saves it on the new host, then removes it from the old one after confirmation. Project and model are checked against the new host in the editor.

### Stage 3: Outside the app

- **Totals across hosts:** Plan usage shows each login once, because a login's percentage is the same quota seen from every host and percentages never add up. Readings for one login use the newest; logins that cannot be matched across hosts are listed by host. A new per-day activity summary (tokens, and cost where the provider reports it) is added by the device across connected hosts, with a per-host breakdown. An offline host, or a provider that reports no cost, is marked and never counted as zero.
- **Terminal agents and scripts:** `ramu thread start|status|message|list` reaches this host's threads, so Claude Code, Codex or a script can place work where the person will see it. Commands print JSON with `--json`, and `status --wait` blocks until the thread settles. Threads use **Allow edits** unless the host's defaults narrow them, show **Started from a terminal** with the name given by `--as`, and stop working when **Let agents start threads** is off. Other hosts stay out of reach of these commands.

## Services to extend

- **Stage 1:** add two owner-only methods, one that prepares the package on the original host and one that starts on the other, both validated with `zod`, bounded and off the viewer allowlist. Extend `buildHandoff` in `apps/server/src/agent/handoff.ts` for portable output, reuse the path behind `agent.continuationPrompt` and `useContinueInNewChat.ts`, and apply `redactSecrets` from `apps/server/src/memory/secrets.ts`, since handoffs do not redact today. Reuse `apps/server/src/remote/hostFolders.ts` for cloning, and extend `ThreadOrigin` with the host and thread ids.
- **Check before building:** `branch` in `agentThreads.ts` creates a new branch, so starting a worktree on an existing remote branch needs adding. Project matching needs each repository's remote URL.
- **Stage 2:** `hostThreads.projects` and `projectsForHost`, the host status that already reports `process.platform`, `apps/server/src/background/schedules.ts`, and `apps/web/src/Automation.tsx` with its phone equivalent. Add the new host facts to the [host pairing review](HOST-PAIRING-REVIEW.md).
- **Stage 3:** `usage.accounts` and the `costUsd` values in result events, for which a stored daily summary is new; `apps/server/src/cli.ts`, reusing `agentThreads` start and status logic. Check whether `accountId` matches across hosts before relying on it.

Every string goes through `t()` with an Indonesian translation, and the phone gets the same sheet, labels and actions. Update [Agents and routing](AGENT-ROUTING.md), [Security](../SECURITY.md) and [Automation](AUTOMATION.md) as each stage lands.

## Acceptance

### Stage 1

- **Representative task:** from a thread on a Mac, a person continues a Linux-only failure on a Linux host where the project is missing. They confirm once, with no pasted context or manual clone, then read the result and bring it back. Repeat from a phone.
- No uncommitted file reaches the other host, its existing checkout is unchanged, and a secret planted in a thread does not appear in what is sent.
- A viewer device is refused on both hosts, and a paired host cannot reach clone, package or start methods.
- A refused, offline or failing host leaves the original unchanged, with no partial clone and no half-started thread. A retried start creates one thread.
- A running thread cannot be continued until it is stopped, and a project with no remote explains why.
- A provider or model missing on the other host is shown before starting.
- Archiving needs a tap and Undo restores it.

### Stage 2

- Continuing on two hosts starts two threads on separate branches, and one failing leaves the other running.
- A suggestion never starts anything, and a host that reports nothing is not suggested.
- A schedule set for another host runs there once, follows its **Missed** setting after that host sleeps, and does not run on the first host. A moved schedule exists on one host only.

### Stage 3

- A login used on two hosts is shown once. Activity totals match each host's own figures, and missing figures are marked.
- `ramu thread` works from a terminal agent on a live run, and stops when **Let agents start threads** is off. Its threads are labelled, and it cannot reach another host.

All stages run on two physical hosts before closing, including a phone.
