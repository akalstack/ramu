# Home and Inbox

## Home

Home is for starting work: the message box and, when something needs you, one line such as **2 need you · 5 finished** that opens Inbox.

With **Auto**, a request that fits no project asks where to start. **New project** starts in No project and asks the agent to create one: it asks at most three questions, names the stack in one line, then creates the folder, runs the framework's own generator, commits, and the thread moves into the new project and continues there with a goal checked by its build and tests ([Agents](working-with-agents.md#threads-started-by-agents)). **No project** (on the phone, **Standalone**) is for something that needs no project yet, such as a page or a question.

On the desktop, **New project…** in the Project picker does the same, and a host with no projects shows **Start something new** beside **Open a folder**. Both also show a project name and stack: with a name, Ramu creates the project itself (the stack's generator, `ramu.json` and a first commit) and the thread starts in it with your message, with no agent turn spent on setup. The folder goes beside your other repositories; **Change…** next to it opens the host's folder browser to put it somewhere else, and that host remembers the choice on this device for the next project. **Start from a design** there picks one of your Design artifacts instead: the project starts with it in `design/` and the agent builds the screens it shows. On the phone, the project list has **New project**, shown as **Start something new** when the host has no projects; it starts the agent-led way, and the choice stays with the draft. The rest of the path, from there to a live app, is in [Shipping an app](shipping.md).

## Inbox

**Inbox** (⌘⇧I) answers "what needs me?" across every connected host. Its tabs are **Brief**, **Running**, **Recaps**, **Learned** and **Completed**, on desktop and phone. The badge counts what the Brief lists.

### Brief

The Brief lists what needs you, most urgent first, without a model call:

1. Approvals and questions
2. Failed threads you haven't opened
3. Usage limits and paused goals
4. A host low on memory
5. Recaps that need a decision

The usual next step is one tap: **Allow once** for an approval, an option for a single-choice question, **Retry** or **Mark done** for a failure, **Stop idle** for a host low on memory. Other questions expand in place. Opening an approval or question on desktop goes to the session that asked, a helper's own included, scrolled to the request. Five rows show, then **See all**. Viewer devices see rows without buttons. A thread's hover card says what lets it continue when that is up to you, such as resuming a goal at its turn limit.

Deployed apps reach you as notifications instead of Brief rows: a usage notice at 80% or 100% of a plan's limit opens the project's most recent thread ([Usage](deploy.md#usage)), and a live address that stops answering opens a **Down:** thread in the project and notifies your phone ([Uptime](deploy.md#uptime)).

### Running and Resources

**Running** lists working threads. On owner devices it also shows what they use: a memory bar per host (Ramu's threads, Ramu itself, other apps and what is available, with Ramu's share of the CPU and **Low memory**), then threads heaviest first, each with a memory bar beside the heaviest thread's and a CPU bar where full is one busy core. A thread with servers shows how many. Expand a thread to see its agent, terminals, commands, test devices and servers, each with **Stop**. A command still alive under finished work reads **Still running**. Figures are approximate and read only while the tab is open. Ramu never stops work by itself. On the phone, the host's own work (such as learning or recaps being generated) is listed under **On the computer**, with **Stop** for the work that can be stopped safely.

### Recaps, Learned and Completed

- **Recaps** summarize what threads did and what is left. Mark an item done, dismiss it or snooze it; every action has **Undo**.
- **Learned** lists "What Ramu learned" summaries ([Learning](memory-and-learning.md)).
- **Completed** shows threads finished in the last 7 days.

Nothing needs clearing: rows leave as you answer or finish them.
