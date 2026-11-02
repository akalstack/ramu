# Continue work on another host

Let a person move work to the machine that can do it, in a few taps. Remove work as it lands, document shipped behavior in the feature guides, and delete this plan when implementation and acceptance are finished.

## The need

Some work only runs on one machine: a Windows-only bug, a GPU box, a server with production network access. Agents can already start a thread on another host ([Agents and routing](AGENT-ROUTING.md#threads-on-another-host)), but only for a project that already exists there, and only as a fresh request. To move a half-finished investigation, a person re-explains it, finds out the project is missing, clones it by hand on that machine and pastes context across.

**Easier for the person:** from the thread they are in, **Continue on ‹host›** carries the conversation and the branch to that host, sets the project up if it is missing, and starts the work there. They approve once and watch it from the thread they started in.

[Threadlines' Fleet](https://github.com/Threadlines/threadlines/releases/tag/v0.8.0) (move a thread to another computer, set up a project there) is a reference for the need only. Ramu keeps its own navigation, approvals and host isolation, and builds none of Fleet's separate page.

## Decisions

- **No Fleet page.** Hosts already have the sidebar switcher, **Settings → Remote access** and Inbox's all-hosts view. This adds actions to the thread and project menus, not a destination.
- **A copy, not a move.** The new thread starts on the other host with a handoff; the original stays where it is and can be archived. A running agent session never migrates between machines.
- **Committed work only.** Uncommitted changes never leave a host, as for any start there. Continuing offers **Commit and push** first, or continues from the last pushed commit and says what was left out.
- **Every step asks.** The existing per-start approval covers the thread; cloning a project is a second approval naming the repository and host. Neither can be saved as a rule or skipped by access mode.
- **Ceilings apply.** The other host still enforces its depth, hourly limits and **Most access for its threads** for this pairing.
- **Suggest, never choose.** Ramu may suggest a host or an action (archive the original, pick a host), but a person confirms each one.

## Delivery

- **Continue on ‹host›** in the thread menu on desktop and phone, listed only for hosts this host is paired with and can reach. The sheet shows the host, the project there (or **Set up on ‹host›**), the branch and commit, any changes left behind, and the model the other host will use.
- **Set up a project:** when the other host has no project with this repository, the sheet offers **Clone ‹repository› on ‹host›**. The other host clones with its own credentials and clone path, and credentials never travel. If it cannot (no access, no network), the sheet says so and starts nothing.
- **What travels:** the thread's handoff (`buildHandoff`, secrets redacted, no provider-private reasoning), the branch name and commit, and the person's note for the other host. The first message names this host and thread, and the thread shows **From ‹thread› on ‹host›**.
- **Following:** the started thread appears under the one it came from in the thread list, with its host and state, and reports back through the existing `remote:` status and queued report. A host that cannot be reached shows **Waiting for ‹host›**, as for agent starts.
- **Agents:** `thread_start` with `host` gains the same optional repository setup, behind the same two approvals, so an agent that finds a Windows-only bug can ask for it.
- **Phone:** the same sheet, labels and approvals.
- **Several hosts at once:** the sheet can select more than one paired host (for example Windows and Linux). Each gets its own thread, approval line and result, all shown under the original, and one failing host does not stop the others. Up to 4 targets per action.
- **Host suggested for the work:** each host reports its platform and what it can do (operating system, GPU, reach to its network) to hosts it is paired with. When a request or a failing thread names a platform the current host lacks, the sheet or composer suggests the paired host that has it, with the reason, and asks first. Nothing is chosen automatically.
- **Archive the original:** when the continued thread finishes, the original offers **Archive**, with Undo. It is never archived by itself.
- **Totals across hosts:** Plan usage and Inbox show spend and token use merged across paired hosts for the day, with a per-host breakdown on tap. A host that is offline is marked and left out of the total instead of counted as zero. No new page.
- **Terminal agents and scripts:** `ramu thread start|status|message` lets Claude Code, Codex or a script in a terminal start and follow Ramu threads, so work begun outside the app lands in the same place. The first use from each tool asks the person in the app and can be revoked in **Settings → Threads**. It reaches only threads it started, never the host-device path, and carries the same two approvals, limits and ceilings as an agent. Settings → Threads can turn it off.
- **Scheduled work on a chosen host:** a schedule can run on a paired host instead of this one. A host that is asleep or offline shows **Waiting for ‹host›** and the run starts when it returns, or is reported as skipped after a day, as for agent starts.

## Services to extend

`remoteThreads.ts` and `agentHosts.ts` for the calling side, `schedules.ts` for remote schedules, `presence.ts` for host capabilities, `cli.ts` for the terminal commands, the Plan usage and `hostInbox.ts` figures for totals, `agentThreads.ts` (`startForHost`, `projectsForHost`) for the receiving side, `handoff.ts` for context, and the existing clone path in the workspace service on the receiving host. Add the methods to `HOST_METHODS` in `apps/server/src/remote/access.ts` only after the [host pairing review](HOST-PAIRING-REVIEW.md) covers a pairing that can ask another host to clone. Terminal agents need their own security review, written like the host pairing review, before they ship. Validate every payload with `zod`, bound the repository URL and note, and add the strings with Indonesian translations.

## Acceptance

- **Representative task:** with a Windows host paired, a person reproduces a Windows-only failure from a Mac thread by choosing **Continue on ‹host›**, approving once, and reading the other host's result, with no copying of context or manual clone.
- The other host never receives uncommitted changes, credentials or provider-private reasoning.
- A refused, offline or revoked host leaves the original thread unchanged and creates no half-started thread or partial clone.
- A paired host cannot reach clone or continue methods unless the person approved that pairing for them, and the receiving host's limits hold.
- Continuing on two hosts at once starts two threads, and one host failing leaves the other running.
- A suggested host is never used without a tap, and a host that does not report its platform is never suggested.
- Totals match the sum of each host's own figures, and an offline host is marked, not counted as zero.
- A terminal agent cannot reach threads it did not start, cannot start anything before the person approves its first use, and loses access when revoked. The security review has no open findings.
- A schedule set for a paired host runs there once, survives that host sleeping, and is not run by this host as well.
- Archiving the original needs a tap and Undo restores it.
- Run on two physical hosts, including a phone approving the start.
