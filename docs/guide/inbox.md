# Home and Inbox

## Home

Home is for starting work. It has the message box and, when something needs you, one line such as **2 need you · 5 finished** that opens Inbox.

Sending from Home with a project chosen opens the new thread right away, with your message and **Starting the agent…** while it sets up. With **Auto**, Home stays until it has picked the project. If the thread can't start, you're back on Home with your message still in the box.

With **Auto**, a request that fits no project asks where to start. **New project** starts in No project and asks the agent to create one. The agent asks at most three questions, names the stack in one line, creates the folder, runs the framework's own generator and commits. The thread then moves into the new project and continues there with a goal checked by its build and tests ([Agents](working-with-agents.md#threads-started-by-agents)). **No project** (on the phone, **Standalone**) is for something that needs no project yet, such as a page or a question.

On the desktop, **New project…** in the Project picker does the same, and a host with no projects shows **Start something new** beside **Open a folder**. Both also take a project name and a stack:

- **Agent recommends** (the default): the agent asks what it can't work out and picks the smallest stack that does the job. Agents write code quickly, so it starts without a framework unless the app needs sign-in, stored data, many routed pages, or is a phone or desktop app.
- **No framework:** a static site, Vite (no framework), Node (no framework), Go, Rust, Swift, or **No generator**, where the agent writes every file.
- **Framework:** Next.js, Vite + React, Vite + Vue, Nuxt, Astro, React Native (Expo), a Node API with Hono, Django, FastAPI, Rails, Tauri, Electron or Flutter. Libraries aren't stacks: the agent adds them when the app needs them, such as TanStack Router once a React app has several pages and TanStack Query once it fetches server data.

With one of Ramu's stacks or **No generator**, Ramu creates the project itself (the stack's generator, `ramu.json` and a first commit) and the thread starts in it with your message, with no agent turn spent on setup.

**Other framework…**: type any framework, such as SvelteKit, Laravel or Kotlin. The agent looks up its official create command on the web and shows you the commands, with the documentation they came from, before anything runs. A SwiftUI or Android app, or Kotlin Multiplatform, starts from Xcode's, Android Studio's or JetBrains' own wizard rather than a command, so the agent writes the project's files itself.

The folder goes where your projects go (see below). **Change…** next to it opens the host's folder browser to put it somewhere else. **Start from a design** picks one of your Design artifacts instead: the project starts with it in `design/` and the agent builds the screens it shows.

**Where a new project goes.** The host proposes the folder you last chose, else the folder that holds most of your projects, else a projects folder you already have (`~/Projects`, `~/Developer`, `~/Code`, `~/src` and the like), else a new `~/Projects`. It never puts a project straight into your home folder. When an agent creates the project, a card in the thread shows the folder with **Change…**, **Create project** and **Not now**, on the desktop and the phone. The host remembers the folder you approve or pick, so the next project goes there from any device. With Full access the card appears only the first time on a host. After that the agent creates the project in the remembered folder and says where it went. Other access modes always ask.

**Choosing a folder.** **Open a folder** on this computer uses the system folder dialog. For another host, for a clone, for **Change…**, and on the phone, Ramu shows the host's own folder browser. It starts at **Locations**: your home folder, the computer's root, each mounted drive (on macOS the volumes in `/Volumes`; on Linux drives mounted under `/media`, `/run/media` and `/mnt`; on Windows each drive letter), then your project folders. You can open any folder the host's user can read, or type or paste a path with the pencil button (**Type a path** on the phone). A path can start with `~` for the home folder. A filesystem root or an operating-system folder such as `/usr` or `C:\Windows` can't be a project, but you can open the folders inside it. Only owner devices can browse. To keep browsing inside chosen folders, start the host with `RAMU_BROWSE_ROOTS` set to them, separated by `:` (`;` on Windows).

On the phone, the project list has **New project**, shown as **Start something new** when the host has no projects. It starts the agent-led way, and the choice stays with the draft. The rest of the path to a live app is in [Shipping an app](shipping.md).

## Inbox

**Inbox** (⌘⇧I) shows what needs you across every connected host. Its tabs are **Brief**, **Running**, **Learned** and **Done**, on desktop and phone. The badge counts the threads the Brief lists, each once.

### Brief

The Brief lists what needs you, most urgent first, without a model call:

1. Approvals and questions
2. Failed threads you haven't opened
3. Usage limits and paused goals
4. A host low on memory

The usual next step is one tap: **Allow once** for an approval, an option for a single-choice question, **Retry** or **Mark done** for a failure, **Stop idle** for a host low on memory. Other questions expand in place. Each thread takes one row, its most urgent reason, with **+N more** for the rest. Opening a row goes where its next step is: an approval or question opens the session that asked (a helper's own included), scrolled to the request; a pull request opens its review; a failure opens its thread, which ends on the error. Five rows show, then **See all**. Viewer devices see rows without buttons. When what lets a thread continue is up to you, such as resuming a goal at its turn limit, its hover card says so.

A paired phone gets a push when a thread finishes, stops with an error or needs you, except about a thread you are looking at: open on the phone with Ramu in front, or on screen in a focused desktop window. While you are using the desktop app (its window in front, and a key or the pointer touched in the last two minutes), the phone gets no push from that host at all: the app's own notifications show what happened. Opening a thread on the phone also clears its pushes from the notification list.

On an iPhone, one **Live Activity** follows the work on the host you follow. In the Dynamic Island its mark is purple while threads work, amber when one needs you, red when one failed and green when all of it is done; beside it are the number of running threads, a hand and the number waiting for you, or the state's symbol. Expanded and on the Lock Screen it says how many threads run, need you, failed or finished (never a zero) and lists up to three of them, the most urgent first, each with what it is doing: **Working**, **Needs approval**, **Question**, **Limit reached**, **Needs you**, **Failed** or **Done**. Tapping it opens the thread it lists first.

It starts when a thread starts working or needs you: right away while Ramu is open, and on iOS 17.2 or later also while Ramu is closed, after the work has gone on for about 15 seconds. It changes with every thread of that stretch of work and stays while any of them works or waits for you. When none does, it shows the finished threads as done, or as failed, and leaves the Lock Screen about four minutes later, or at once when you open a thread it reported finished. Opening Ramu ends one left over from work that is already over. While Ramu is closed it keeps up through Ramu Link when the host is signed in to your Ramu account; those updates carry counts only, so thread names show only when Ramu updated it itself. Without them it keeps the last state it knew, and after ten minutes without an update turns grey and says **Open Ramu to update**. Swiping it away hides it until the next work. **Settings → Notifications → Live Activities** in Ramu turns it off, and **Settings → Apps → Ramu → Live Activities** on the iPhone offers **More Frequent Updates**.

Deployed apps reach you as notifications, not Brief rows. A live address that stops answering opens a **Down:** thread in the project and notifies your phone ([Live address and uptime](deploy.md#live-address-and-uptime)).

### Running and Resources

**Running** lists working threads. On owner devices it also shows what they use:

- A memory bar per host: Ramu's threads, Ramu itself, other apps and what is available, with Ramu's share of the CPU and **Low memory**.
- Threads, heaviest first, each with a memory bar next to the heaviest thread's and a CPU bar where full is one busy core. A thread with servers shows how many.

Expand a thread to see its agent, terminals, commands, test devices and servers, each with **Stop**. A command still alive under finished work reads **Still running**. Figures are approximate and are read only while the tab is open. Ramu never stops work by itself.

On the phone, the host's own work (such as learning or memory cleanup) is listed under **On the computer**, with **Stop** for work that can be stopped safely.

### Learned and Done

- **Learned** lists "What Ramu learned" summaries ([Learning](memory-and-learning.md)).
- **Done** shows threads finished in the last 7 days.
- **Done for you**, at the top of **Done**, lists what [shipping](git-hosting.md#shipping-a-change) did without asking in the last week, such as "Fixed failing checks on #42" or "Replied to reviewers on #42". A row opens its thread. **Undo** on a fix pushes a commit that reverts it and tells the thread not to push it again. It works while nothing came after the fix on the branch and the checkout has no uncommitted changes; otherwise undo it from the thread. **Undo** on replies deletes the replies Ramu posted; the fixes stay pushed.

Nothing needs clearing. Rows leave as you answer or finish them.
