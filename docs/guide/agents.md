# Agents

How a thread's agent works, how to bring in other models, and how work spreads across threads and hosts.

## Changing the model

Pick another model while a turn runs and Ramu waits five seconds (**Apply now** or **Cancel**). Idle threads switch at once. When the new model can't resume the old session, Ramu hands it the conversation so far (a **Context handoff**). A change the provider can't take leaves the current model running.

## Usage limits and fallback

**Settings → Models → Provider fallback** is an ordered list of provider and model pairs, best first. When a model hits its limit, the thread moves to the next one with room, carrying the visible conversation (never private reasoning). Switch at the limit (default) or earlier at 80, 90 or 95%. Once a current usage reading shows the model it left has room again, the thread switches back before your next message, never mid-turn, and gets what happened in between. A model or login you picked yourself, or a provider held in the composer, is never switched back.

**When a usage limit is reached** offers **Switch to another model**, **Wait on this model** or **Stop and let me decide**. When every option is limited, the thread waits with **Limit reached · resumes around …**, keeps your queued messages, and continues at the reset, even after a restart. **Try again** checks right away. A limit is never a failure.

Every enabled account of a provider is tried before another model.

## Sub-agents

The agent can start helpers for parts of a task. Helper cards show progress; open one to read, message or stop it. Stopping the thread stops its helpers.

- **Routing** (Settings → Goals & delegation → Sub-agents) can send helpers to another provider or model, or keep each provider's own.
- **Isolation** gives a helper its own checkout and applies its changes back when it finishes.

## Teammates

A teammate is another model working in the thread beside its main agent, with its own session. Type `@` at the start of a message to choose who it goes to (desktop and phone):

- **A teammate already here**, by its name, such as `@opus-5.5`.
- **A model** from the model menu, or one of your **custom agents**: sending brings it into the thread with the conversation so far and gives it your message. Nothing to set up first.
- **Add teammate…** in the `@` list (or `/teammate`) starts the message with `@` and the thread's own model.

The mention shows as that model's icon and name. While a message brings a new teammate in, the composer's controls are the teammate's: its model, effort and access, and **Review** or **Take over**. Choosing another model there rewrites the mention. The rest of the message is its brief.

Once you talk to a teammate it becomes the recipient: the **To** chip in the composer shows it, and plain messages keep going to it until you choose **Main agent** there or start a message with `@lead`. A thread holds up to four teammates; the same model twice is numbered (`Opus 5.5 2`).

- **Review** (default) reads the latest changes and replies with findings. It never edits, whatever the thread allows. On Claude it can run commands that only read, such as `git diff`, `git log`, `ls` and `grep`; tests, builds and anything that writes are refused, so it names them for the lead to run.
- **Take over** edits while the main agent waits, then hands back with a summary. A custom agent that may edit joins this way.

In the thread, on the desktop and the phone, what you write to a teammate sits on your side under **To ‹name›**, and its reply follows in a card with its icon and name, so every reply reads after the request it answers; only a very long reply folds behind **Show full report**. When the main agent asks a teammate itself, its **Asked teammate** row opens to the question and the reply.

Before each message, a teammate gets a short catch-up on what the thread said and which files changed since it last took part. The main agent and teammates also message each other by name: `teammate_message` sends a note, and `teammate_ask` lets the main agent ask a teammate and get the reply inside its own turn. **Agents** above the composer lists everything working beside the main agent: teammates, sub-agents still running and the agent's own background commands, each with its role, status and **Stop**. Each teammate's row and card show what it changed (files and lines) and its turns and reported cost. Its list button, or **All agents** in the thread's ⋯ menu, shows every agent the thread has had, finished ones included. On the phone the same agents, background commands included, are in the active-agents pill above the composer.

The main agent can also suggest a teammate, for example a second model to review risky changes. The suggestion is an approval card that says which model and login it would use; nothing joins until you allow it, and after a no it waits for your next message before suggesting again. **Let agents suggest teammates** (Settings → Threads) turns this off.

After four teammate reports or notes without you writing, the exchange pauses and the teammate shows **Paused for you**. Its latest report waits instead of reaching the main agent: **Continue** on its row, card or panel (on the phone, in its details) delivers it and allows four more rounds, and so does any message you write.

A teammate that worked well can be kept: **Save as teammate** in its panel (on the phone, in its details) asks only for a name and saves its model, its brief and whether it may edit as a custom agent, so `@name` brings it into any thread.

## Custom agents

**Settings → Goals & delegation → Custom agents** keeps reusable agents: a name, when to use it, instructions, an optional model and a read-only switch. A new host starts with four you can use as teammates right away, edit or delete: `@security-reviewer`, `@test-writer` (may edit), `@second-opinion` and `@simplifier`. Give `second-opinion` a model from another provider for a truly independent look. **New agent** drafts one from a sentence for you to edit. The thread's agent uses one when a task fits, and its helper card shows **custom: ‹name›**. A teammate can start from one too.

## Threads started by agents

An agent can start separate threads you own: a follow-up, the matching change in another project, or several parts in parallel. They appear in the sidebar, report back when they finish or need you, and keep running if the starting thread stops.

- In Full access, one thread in the same project starts at once. Anything wider shows one approval card.
- Started threads can start one more level, and a thread can start 8 an hour.
- **Let agents start threads** (Settings → Threads) turns this off.

### On another host

From a host's row in **Settings → Remote access**, request **Agents** to let this host's agents start threads there. Every such start asks you first, needs an exact project name, and gets at most that host's access ceiling for the pairing (default **Allow edits**). See [Security](../../SECURITY.md#host-pairing).

## Acting on several threads

In the sidebar, Cmd/Ctrl-click adds a thread to the selection and Shift-click selects a range, starting from the open thread when nothing is selected yet. The bar above the list pins, finishes, archives or deletes them together; **Delete** or **Backspace** deletes them, and **Esc** clears the selection. Archive and done can be undone; delete still reviews each thread so a running command is never lost.

A thread marked done leaves its project and moves to **Done** at the bottom of the list, on the desktop and the phone alike, newest first; sending it a message brings it back.

On the phone, long-press a thread and choose **Select**, then tap more threads; the header marks them done, archives or deletes them, and **×** cancels. Deleting several at once keeps any thread with a background command for its own review.

In a thread on iPhone, long-press a word to select it and drag the handles to select more, as on the desktop. The bar above the message box quotes, starts a thread with, asks aside about or copies the selection; **More** has the whole message's actions. On Android, long-press a message to select its text.

A quote, a tagged file or another reference in the message box opens when you press it: a quote shows in full with **Show in conversation**, which scrolls to the message it came from and marks it, and **Remove**; a file offers **Open** and **Copy path**. On the phone a quote opens from its chip above the message box, and a tagged file offers **Open** while the cursor is in it.

## Projects on other hosts

With **Auto** as the destination, Home also weighs the projects on your other connected hosts. A request that belongs to one of them starts there, in that project's default checkout, and the thread opens. When more than one project could fit, Home asks. For work that spans several repositories, add them to one project: a folder that holds them all gives one thread every repository.

## Continue on another host

**Continue on ‹host›** (thread menu) copies a stopped thread to another connected host, or up to four with **Also on**. The sheet shows the branch it starts from, what stays behind (uncommitted files, unpushed commits), the project there and the model. It matches the project by Git remote, or clones it there. The conversation travels with secrets removed; files never do. Both threads stay linked, and **Bring back result** queues the other thread's latest reply in the original.

Hosts whose platform or description (**Settings → Threads → Describe this host**) the request mentions are listed first.

## Threads from a terminal

`ramu thread start|status|message|list` lets a terminal agent or script place work on this host. See [Remote hosts](remote-hosts.md#threads-from-a-terminal).

## Rules and MCP

- **Settings → Agent setup → Rules** holds your own instructions. **Always** rules reach every new thread (24,000 characters per scope); **Manual** rules stay stored. Ramu also lists the instruction files providers read (`AGENTS.md`, `CLAUDE.md` and rules folders), read-only.
- **Settings → Agent setup → MCP servers** and **Skills** open on **All projects**: your own servers and skills, and one switch each that shares it with every provider and account in every project. Each says how many projects chose differently. Choose a project under **Applies to** to see its own servers and skills too; a switch there makes an exception for that project, and **Use the all-projects setting** drops it. **Connect through Ramu** is offered in a project. The phone shows the same lists read-only.
- **/mcp** in a thread shows each MCP server's status. Repository `.mcp.json` files and Claude's local entries are shared with every provider.

## Secrets agents ask for

When an agent needs a token, password, PIN or pairing code only you can give, it asks with a masked card in the thread instead of in chat, on the desktop and the phone. **Save** sends the value to the host, which writes it to a private file only your user can read and gives the agent that file's path, never the value; the agent reads it inside the command that needs it. The value is not stored in the thread, and the file is deleted after a day. **Decline** tells the agent to go on without it. A card left unanswered for ten minutes, or still open when the run stops, closes, and the agent asks again only if it still needs it.

When the agent names the variable a tool reads, such as `VERCEL_TOKEN`, the card on the host offers **Keep as VERCEL_TOKEN for later threads**. That adds it to [**Settings → Environment variables**](providers.md#environment-variables) for all providers, so new threads have it and do not ask again.

## Thread titles

A thread is named from its first message, then once more after the first reply. **Rename** always wins; **Rename with AI** regenerates. A thread's hover card (and the phone's rename sheet) says where its title came from: your first message, Ramu, the provider, or you, and whether Ramu may still change it.

## Asides and advice

Select text in a thread to quote it or ask a read-only Aside. The optional advisor asks a second model for an opinion ([Providers](providers.md#advisor)).
