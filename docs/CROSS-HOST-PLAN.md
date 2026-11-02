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

Stage 1, **Continue on ‹host›**, has shipped ([Agents and routing](AGENT-ROUTING.md#continue-on-another-host)). Each remaining stage is useful alone.

### Stage 2: Choosing hosts

- **Host descriptions:** hosts already report platform and architecture, and the Continue menu suggests one whose platform the request names. A short description the person writes (`GPU box`, `office network`) would be matched the same way, and `hostThreads.projects` would add these facts so `project_list` lets an agent recommend a host.

### Stage 3: Outside the app

- **Totals across hosts:** the desktop's Plan usage already lists logins from other hosts once, matched by sign-in email (`packages/shared/src/usageAcrossHosts.ts`); the phone's **All hosts** view still lists each host separately and should use the same merge. A new per-day activity summary (tokens, and cost where the provider reports it) is added by the device across connected hosts, with a per-host breakdown. An offline host, or a provider that reports no cost, is marked and never counted as zero.

## Services to extend

- **Stage 2:** `hostThreads.projects` and `projectsForHost`, the host status that already reports `process.platform`, the free-memory figure and low-memory state each host sends through inbox state (Resources), Add the new host facts to the [host pairing review](HOST-PAIRING-REVIEW.md).
- **Stage 3:** `usage.accounts` and the `costUsd` values in result events, for which a stored daily summary is new; Check whether `accountId` matches across hosts before relying on it.

Every string goes through `t()` with an Indonesian translation, and the phone gets the same sheet, labels and actions. Update [Agents and routing](AGENT-ROUTING.md), [Security](../SECURITY.md) and [Automation](AUTOMATION.md) as each stage lands.

## Acceptance

### Stage 2

- A description match never starts anything, and a host with no description is not suggested by one.

### Stage 3

- A login used on two hosts is shown once on the phone too. Activity totals match each host's own figures, and missing figures are marked.

All stages run on two physical hosts before closing, including a phone.
