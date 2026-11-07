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

- **Helpers use** (Settings → Goals & delegation → Sub-agents) picks their model: **The thread's model** (default) keeps each provider's own helpers; **A model chosen for each task** has Ramu run each helper on the thread's provider with the model and effort that provider picks for it, after one short selection request; **A model I pick** runs every helper on one model, on any provider. At a usage limit, helpers follow the thread's fallback order and threshold, and a provider's own helper that stops at a limit continues on the next model with what it had done. Up to three helpers run at once per thread; more wait for a slot.
- A helper that would write beside other work gets its own copy of the checkout: one running in the background while the thread goes on, or one started alongside another writing helper, including two the agent starts in the same step. Its changes come back when it finishes; any that conflict stay in its copy for review. A helper the thread waits for alone, a read-only helper and a teammate work in the thread's own checkout, so their edits show as they happen. A helper card says **Own copy** when it has one.
- The agent can also choose for one helper: a **model** by its handle (such as `opus-5.5`; the `agent_models` tool lists each provider's current models), **isolation** (`worktree` for its own copy with the thread's uncommitted changes, `shared` to work in the thread's checkout unless another helper is writing there) and a **role**. Research and review helpers read and report and never edit; implementation and test helpers may edit. A helper keeps the thread's access and never gets more.
- The agent can check its own helpers and stop one that went off track (`ramu_agent_status`, `ramu_agent_stop`); it cannot reach another thread's helpers. Reports arrive as messages, so the agent is told to end its turn rather than check in a loop.
- A provider that sends a call again after a dropped connection does not start a second helper, thread or project: the repeated call gets the first result back.

## Abilities

Some providers can do things others cannot: Codex can search the web and, on logins that offer it, make images; Claude can search the web. When a thread's provider lacks one, its agent asks Ramu, which runs just that step on one of your signed-in providers that has it and hands the result back. The thread keeps its own model.

- **Tools:** `generate_image` and `edit_image` (one to four images, saved as attachments of the thread), `web_search` (an answer with cited sources) and `read_long` (one question about files in the thread's folder or pasted text, up to about 1.2 million characters, on the model with the largest context window). Each call is one bounded run with no files, shell, Git or MCP, and only the caller's prompt and the inputs it names are sent. A thread whose own provider has the ability natively does not get the tool and uses its own. `agent_models` lists which provider offers each ability on this host.
- **The row:** each call shows as one row on the desktop and the phone, such as **Image made with Codex**, with the model, time, tokens, what was sent and the result: the image (open it full size), the answer and its sources. **Make another** runs the same request again, and **Use another provider** runs it on a provider other than the one that ran it. When no provider has the ability, the agent is told to carry on without it and say so, and the row offers **Set up a provider**.
- **Settings → Models → Abilities:** each ability is **Auto** (every provider whose check passed, in your fallback order), one provider and model, or **Off**. The phone shows these choices read-only. **Ask before using another provider** (off by default, also on the phone under the **Change settings** permission) turns each call that would run on a provider other than the thread's into an approval card naming the provider and what is sent.
- **Limits:** at a usage limit a call moves to the next provider with the ability, on that provider's chosen login. It never moves to another subscription login on its own, and when every provider is limited the call is refused with a clear message. `web_search` on **Auto** falls back to Ramu's own keyless search. Each call shows in **Activity** while it runs and counts in usage under the provider that ran it.
- **Helpers by ability:** `ramu_agent` takes `needs`, such as `['image_generation']`, and starts the helper on a provider that has every listed ability: a fixed choice in Abilities first, then Sub-agents routing, then the fallback order. If none has them all, it refuses and names what is missing. The helper keeps the thread's access and never gets more.
- **Teammates by ability:** start a message with `@images`, `@search` or `@long` to bring in a teammate on whichever provider and model this host picks for image generation, web search or long documents, chosen the same way as a helper's `needs`. The composer shows which model joins before you send, and the teammate's chip names it. A handle no provider here can serve is not offered.

Which abilities each provider offers on your host is in [Providers](providers.md#abilities).

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
- Asked to build something new, the agent can create the project (`project_create`): a folder beside your other repositories, the framework's own generator (Next.js, Vite, Astro, Expo, a Node or Python service, Rails or Go), a `.gitignore`, the stack in `ramu.json` and a first commit. Asked from a thread with no project, that same thread moves into the new project when the turn ends and continues there with a goal checked by the project's build and tests; the next turn starts a fresh provider session that is handed the conversation, and files written before the move stay in the old folder. Asked from a thread in another project, a linked thread starts in the new project with the brief and that goal. Outside Full access it asks first, naming the folder and the generator.
- Asked to work on a repository that is not a project yet, the agent can add it: a Git URL is cloned beside your other repositories with the host's own Git credentials, and a folder on the host is registered. A project that already has that remote is reused. Outside Full access it asks first.
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

## Continue in a new worktree

**Continue in new thread** (thread menu) offers **In a new worktree, with the uncommitted changes** for a thread on the project's own checkout; on the phone it is **Continue in a new worktree**. The new thread starts on a new branch in its own worktree with this conversation and a copy of every uncommitted change, new files included, so your checkout is free for other work. The original thread and its checkout stay as they are, and the two threads are linked. An agent can do the same when you ask it to move the work off your checkout; outside Full access it asks first.

## Continue on another host

**Continue on ‹host›** (thread menu) copies a stopped thread to another connected host, or up to four with **Also on**. The sheet shows the branch it starts from, what stays behind (uncommitted files, unpushed commits), the project there and the model. It matches the project by Git remote, or clones it there. The conversation travels with secrets removed; files never do. Both threads stay linked, and **Bring back result** queues the other thread's latest reply in the original.

Hosts whose platform or description (**Settings → Threads → Describe this host**) the request mentions are listed first.

## Threads from a terminal

`ramu thread start|status|message|list` lets a terminal agent or script place work on this host. See [Remote hosts](remote-hosts.md#threads-from-a-terminal).

## Artifacts

Agents choose an artifact's kind (`kind`: an `app`, a `doc` in Markdown or a `diagram` in Mermaid or SVG), check it with `artifact_preview`, publish it to keep with `artifact_publish` (`artifact: true`, or an artifact's id for a new version from any thread), find them with `artifact_list` and `artifact_get`, work with an artifact's records through `artifact_records`, start its runs with `artifact_run`, and record where one is live with `artifact_published` (an artifact publishes itself through **Publish to the web**; this records a deploy an agent did from a project). Deleting an artifact stays your action. See [Artifacts](artifacts.md).

## Deploys

Threads in a project check its deployments and logs with `deploy_status` and `deploy_logs`, start a preview with `deploy_preview`, read custom domains with `deploy_domains` and the billing period's usage with `deploy_usage`, and ask you before `deploy_production` (which runs the project's migrations first), `deploy_rollback`, `deploy_domain_add` and `deploy_domain_records`. A project with an Expo app also gets `release_status` and `release_logs`, and `release_start`, which always asks you before building and uploading to TestFlight and Play's internal track. See [Deploying an app](deploy.md#agents).

`ci_setup` writes a CI workflow into the thread's checkout for the agent to review and commit through a pull request. See [Set up CI](git-hosting.md#set-up-ci).

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
