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

## Delivery

- **Continue on ‹host›** in the thread menu on desktop and phone, listed only for hosts this host is paired with and can reach. The sheet shows the host, the project there (or **Set up on ‹host›**), the branch and commit, any changes left behind, and the model the other host will use.
- **Set up a project:** when the other host has no project with this repository, the sheet offers **Clone ‹repository› on ‹host›**. The other host clones with its own credentials and clone path, and credentials never travel. If it cannot (no access, no network), the sheet says so and starts nothing.
- **What travels:** the thread's handoff (`buildHandoff`, secrets redacted, no provider-private reasoning), the branch name and commit, and the person's note for the other host. The first message names this host and thread, and the thread shows **From ‹thread› on ‹host›**.
- **Following:** the started thread appears under the one it came from in the thread list, with its host and state, and reports back through the existing `remote:` status and queued report. A host that cannot be reached shows **Waiting for ‹host›**, as for agent starts.
- **Agents:** `thread_start` with `host` gains the same optional repository setup, behind the same two approvals, so an agent that finds a Windows-only bug can ask for it.
- **Phone:** the same sheet, labels and approvals.

## Services to extend

`remoteThreads.ts` and `agentHosts.ts` for the calling side, `agentThreads.ts` (`startForHost`, `projectsForHost`) for the receiving side, `handoff.ts` for context, and the existing clone path in the workspace service on the receiving host. Add the methods to `HOST_METHODS` in `apps/server/src/remote/access.ts` only after the [host pairing review](HOST-PAIRING-REVIEW.md) covers a pairing that can ask another host to clone. Validate every payload with `zod`, bound the repository URL and note, and add the strings with Indonesian translations.

## Acceptance

- **Representative task:** with a Windows host paired, a person reproduces a Windows-only failure from a Mac thread by choosing **Continue on ‹host›**, approving once, and reading the other host's result, with no copying of context or manual clone.
- The other host never receives uncommitted changes, credentials or provider-private reasoning.
- A refused, offline or revoked host leaves the original thread unchanged and creates no half-started thread or partial clone.
- A paired host cannot reach clone or continue methods unless the person approved that pairing for them, and the receiving host's limits hold.
- Run on two physical hosts, including a phone approving the start.

## Later options

Decide these from use, one at a time. None is needed for the delivery above.

- **Totals across hosts:** spend and token use merged across paired hosts, so a person sees one figure for the day. Build it only if people ask where usage went; it extends Plan usage and the all-hosts Inbox, with no new page.
- **Host picked for the work:** when a project or request needs a platform (Windows, a GPU, production network), suggest the paired host that has it and ask first. Needs a host's platform and capabilities reported to its peers, so start only after **Continue on ‹host›** shows people choosing hosts by hand for the same reasons.
- **Terminal agents and scripts:** let Claude Code, Codex or a script in a terminal start and follow Ramu threads through `ramu`, so work begun outside the app lands in the same place. It needs its own approval on first use, a fence on which threads it can reach, and a security review like the [host pairing review](HOST-PAIRING-REVIEW.md); it must not reuse the host-device path.
- **Move instead of copy:** archive the original thread when the continued one finishes, offered as a prompt and never done by itself.
- **Several continued threads:** continue one thread on more than one host at once (for example Windows and Linux). The first delivery allows one target per action.
- **Scheduled work on a chosen host:** run a recurring task on a paired host instead of this one. It waits on how schedules behave on a host that is asleep or offline.
