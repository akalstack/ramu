# Agents

How a thread's agent works, how to bring in other models, and how work spreads across threads and hosts.

## Changing the model

Pick another model while a turn runs and Ramu waits five seconds (**Apply now** or **Cancel**). Idle threads switch at once. When the new model can't resume the old session, Ramu hands it the conversation so far (a **Context handoff**). A change the provider can't take leaves the current model running.

## Usage limits and fallback

**Settings → Models → Provider fallback** is an ordered list of provider and model pairs, best first. When a model hits its limit, the thread moves to the next one with room, carrying the visible conversation (never private reasoning). Switch at the limit (default) or earlier at 80, 90 or 95%.

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
- **Add teammate…** (also `/teammate` and the thread menu) to choose the model, how it works and what it should do before it starts.

Once you talk to a teammate it becomes the recipient: the **To** chip in the composer shows it, and plain messages keep going to it until you choose **Main agent** there or start a message with `@lead`. A thread holds up to four teammates; the same model twice is numbered (`Opus 5.5 2`).

- **Review** (default) reads the latest changes and replies with findings. It never edits, whatever the thread allows.
- **Take over** edits while the main agent waits, then hands back with a summary. A custom agent that may edit joins this way.

Before each message, a teammate gets a short catch-up on what the thread said and which files changed since it last took part. The main agent and teammates also message each other by name: `teammate_message` sends a note, and `teammate_ask` lets the main agent ask a teammate and get the reply inside its own turn. Each teammate's bar above the composer and its card show what it changed (files and lines) and its turns and reported cost.

After four teammate reports or notes without you writing, the exchange pauses; a message to any of them continues it.

## Custom agents

**Settings → Goals & delegation → Custom agents** keeps reusable agents: a name, when to use it, instructions, an optional model and a read-only switch. **New agent** drafts one from a sentence for you to edit. The thread's agent uses one when a task fits, and its helper card shows **custom: ‹name›**. A teammate can start from one too.

## Threads started by agents

An agent can start separate threads you own: a follow-up, the matching change in another project, or several parts in parallel. They appear in the sidebar, report back when they finish or need you, and keep running if the starting thread stops.

- In Full access, one thread in the same project starts at once. Anything wider shows one approval card.
- Started threads can start one more level, and a thread can start 8 an hour.
- **Let agents start threads** (Settings → Threads) turns this off.

### On another host

From a host's row in **Settings → Remote access**, request **Agents** to let this host's agents start threads there. Every such start asks you first, needs an exact project name, and gets at most that host's access ceiling for the pairing (default **Allow edits**). See [Security](../../SECURITY.md#host-pairing).

## One prompt, several threads

With **Auto** as the destination, a request that needs several projects (on any connected host) becomes a reviewed list: one thread per project, each with an editable brief, plus a shared contract. Nothing starts until **Start all**. **Split requests across projects** (Settings → Threads) turns this off.

## Continue on another host

**Continue on ‹host›** (thread menu) copies a stopped thread to another connected host, or up to four with **Also on**. The sheet shows the branch it starts from, what stays behind (uncommitted files, unpushed commits), the project there and the model. It matches the project by Git remote, or clones it there. The conversation travels with secrets removed; files never do. Both threads stay linked, and **Bring back result** queues the other thread's latest reply in the original.

Hosts whose platform or description (**Settings → Threads → Describe this host**) the request mentions are listed first.

## Threads from a terminal

`ramu thread start|status|message|list` lets a terminal agent or script place work on this host. See [Remote hosts](remote-hosts.md#threads-from-a-terminal).

## Operator

**Operator** (Settings → Threads, off by default) turns one sentence into proposed actions across hosts: "stop everything on vps", "retry what failed". It can stop, retry, message, archive or finish threads and pause or run schedules. Nothing runs until you tick and confirm.

## Rules and MCP

- **Settings → Agent setup → Rules** holds your own instructions. **Always** rules reach every new thread (24,000 characters per scope); **Manual** rules stay stored. Ramu also lists the instruction files providers read (`AGENTS.md`, `CLAUDE.md` and rules folders), read-only.
- **/mcp** in a thread shows each MCP server's status. Repository `.mcp.json` files and Claude's local entries are shared with every provider.

## Thread titles

A thread is named from its first message, then once more after the first reply. **Rename** always wins; **Rename with AI** regenerates. A thread's hover card (and the phone's rename sheet) says where its title came from: your first message, Ramu, the provider, or you, and whether Ramu may still change it.

## Asides and advice

Select text in a thread to quote it or ask a read-only Aside. The optional advisor asks a second model for an opinion ([Providers](providers.md#advisor)).
