# Agents

How a thread's agent works, how to bring in other models, and how work spreads across threads and hosts.

## Changing the model

Pick another model while a turn runs and Ramu waits five seconds (**Apply now** or **Cancel**). Idle threads switch at once. When the new model can't resume the old session, Ramu hands it the conversation so far (a **Context handoff**). A change the provider can't take leaves the current model running.

Codex models and the Claude models that have fast mode (Opus and Fable) offer **Standard** and **Fast** in the model picker. Fast answers sooner at a higher usage cost. On Claude it's Claude Code's fast mode, set per thread: a thread on Standard never picks up a fast mode saved in Claude Code's own settings.

## Suggested next message

After a turn ends, the empty message box shows a likely next message in grey, such as "Run the tests" or "Commit this and open a pull request". **Tab** puts it in the box to edit or send. It is never sent by itself. Up to two other suggestions sit above the box as chips. Typing anything, or **Escape**, hides them until the next turn. On the phone all of them are chips above the message box, and tapping one puts it in the box.

- It is asked of the thread's own session, which already has the conversation, so it costs a small cached request. A provider that can't do that gets the end of the conversation read by your maintenance model instead. Either way the request also says what Ramu knows: the thread's goal and whether there are uncommitted changes.
- It is made only for a thread you have open, once per turn, and the desktop and the phone show the same suggestions.
- Nothing is suggested while the agent works or waits on you, after a turn that failed, was stopped or hit a usage limit, while messages are queued, or when no next step is clear.
- **Settings → Threads → Suggest next message** turns it off.

## Compacting a long Claude thread

Claude keeps a thread's conversation in its prompt cache for an hour on a subscription and five minutes on an API key. Once a Claude thread over 200K tokens has sat idle longer than that, its next message re-reads the whole conversation at full cost. The composer then shows **Compact · 240K** beside Send, and Send becomes **Compact and send**: Ramu sends `/compact` and your message runs right after it, against the summary. Select the chip to switch to **Keep · 240K** and send with the full history. The choice applies to that one message.

Ramu uses the cache lifetime Claude reported for the thread's last reply, or an hour when it has none. The chip doesn't show while a turn runs or waits for your answer, for a command, an edited message or a model change still to apply, or for other providers. The host keeps each thread's last reading, so the chip still shows after Ramu restarts. It works the same on the desktop and the phone.

## Usage limits and fallback

**Settings → Models → Provider fallback** is an ordered list of provider and model pairs, best first. When a model hits its limit, the thread moves to the next one with room, carrying the visible conversation (never private reasoning). Switch at the limit (default) or earlier at 80, 90 or 95%. Once a usage reading shows the model it left has room again, the thread switches back before your next message (never mid-turn) and gets what happened in between. A model or login you picked yourself, or a provider held in the composer, is never switched back.

**When a usage limit is reached** offers **Switch to another model**, **Wait on this model** or **Stop and let me decide**. When every option is limited, the thread waits with **Limit reached · resumes around …**, keeps your queued messages and continues at the reset, even after a restart. **Try again** checks right away. A limit is never a failure.

Every enabled account of a provider is tried before another model.

## Sub-agents

The agent can start helpers for parts of a task. Helper cards show progress. Open one to read, message or stop it. Stopping the thread stops its helpers.

- **Helpers use** (Settings → Goals & delegation → Sub-agents) picks their model:
  - **The thread's model** (default) keeps each provider's own helpers.
  - **A model chosen for each task** runs each helper on the thread's provider with the model and effort that provider picks for it, after one short selection request.
  - **A model I pick** runs every helper on one model, on any provider.

  At a usage limit, helpers follow the thread's fallback order and threshold, and a provider's own helper that stops at a limit continues on the next model with what it had done. Up to three helpers run at once per thread. More wait for a slot.

- A helper that would write beside other work gets its own copy of the checkout. That covers one running in the background while the thread goes on, and one started alongside another writing helper (including two the agent starts in the same step). Its changes come back when it finishes, and any that conflict stay in its copy for review. A helper the thread waits for alone and a read-only helper work in the thread's own checkout, so their edits show as they happen. A helper card says **Own copy** when it has one.
- The agent can also choose for one helper:
  - a **model** by its handle, such as `opus-5.5` (the `agent_models` tool lists each provider's current models)
  - **isolation**: `worktree` for its own copy with the thread's uncommitted changes, or `shared` to work in the thread's checkout unless another helper is writing there
  - a **role**: research and review helpers read and report and never edit. Implementation and test helpers may edit.

  A helper keeps the thread's access and never gets more.

- With `host`, a helper runs as a thread on another host your agents can use ([On another host](#on-another-host)), after you approve it like any start there. It always runs in the background. Its card says **On ‹host›** and follows its latest step every few seconds, its report arrives as a message, and `ramu_agent_stop` stops it there.
- The agent can check its own helpers and stop one that went off track (`ramu_agent_status`, `ramu_agent_stop`). It can't reach another thread's helpers. Reports arrive as messages, so the agent is told to end its turn instead of checking in a loop.
- If a provider sends a call again after a dropped connection, Ramu doesn't start a second helper, thread or project. The repeated call gets the first result back.

## Abilities

Some providers can do things others can't. Codex can search the web and, on logins that offer it, make images. Claude can search the web. When a thread's provider lacks an ability, its agent asks Ramu, which runs just that step on one of your signed-in providers that has it and hands the result back. The thread keeps its own model.

- **Tools:**
  - `generate_image` and `edit_image`: one to four images, saved as attachments of the thread.
  - `web_search`: an answer with cited sources.
  - `read_long`: one question about files in the thread's folder or pasted text, up to about 1.2 million characters, on the model with the largest context window.
  - `make_music`, `make_sound`, `speak` and `make_video`: background music, a sound effect, a scene's narration in a voice for a motion, or a 3 to 15 second video clip with sound. No signed-in provider here makes these, so they run on a media account (below), a plugin's service (the Higgsfield plugin makes video on your Higgsfield account), or a Shared MCP tool you map to music, sound effects, speech or video. A plugin's service spends its credits, so the first call to it in a thread asks on a card naming it. A Shared MCP tool's license words stay on the row.
  - `read_image`: one question about one to four images from the thread's folder or attachments, on Codex or Claude, for a thread whose own model can't see images. Its live check sends a small picture of one color and asks which color it is.

  Each call is one bounded run with no files, shell, Git or MCP, and only the caller's prompt and the inputs it names are sent. A thread whose own provider has the ability natively doesn't get the tool and uses its own. `agent_models` lists which provider offers each ability on this host.

- **In artifacts:** a deck, design, doc or app can use an image made or edited this way. The agent names the image's attachment for one of the artifact's files and the host embeds its bytes. Only an image attachment that thread holds (one you sent or one an ability made there) can be named.
- **The row:** each call shows as one row on the desktop and the phone, such as **Image made with Codex**. It has the model, time, tokens, the reported cost, **chosen as the cheapest good enough** when Auto picked it over a pricier provider, what was sent, and the result: the image (open it full size), or the answer and its sources. **Make another** runs the same request again, and **Use another provider** runs it on a different provider. When no provider has the ability, the agent is told to carry on without it and say so. The row then offers **Set up a provider**, or **Add a media key** (opening **Media** under **Settings → Providers**) for video, speech, music and sound effects.
- **Settings → Models → Abilities:** each ability is **Auto**, one provider and model, or **Off**.
  - **Auto** tries every provider whose check passed, cheapest good-enough one first. Each check scores the provider on fixed sample tasks with known answers: five sites to find, five notes to recall from a document of about 50,000 tokens, and three pictures to make (such as three blue circles), which the same login then reads back with no tool and answers two questions about. A provider within 20 points of the best score counts as good enough.
  - A subscription with room comes before an API key, and an API key before one whose cost was never reported. An API key's cost is the middle of what its recent calls reported. Image editing has no scored sample, so every provider that passed counts as good enough for it, and ties keep your fallback order. Each provider's row shows its score and **Subscription** or its typical cost per call.
  - The phone shows these choices read-only. **Ask before using another provider** (off by default, also on the phone under the **Change settings** permission) turns each call that would run on a provider other than the thread's into an approval card naming the provider and what is sent.
- **Media:** video, speech, music and sound effects run on a media service with your own API key, billed to that account: **Google Gemini** (video with Omni Flash, speech, music with Lyria) and **ElevenLabs** (speech, music, sound effects). Save a key under **Media** in **Settings → Providers** (**Add a key** under **Settings → Models → Abilities** opens it). The key is checked against the service before it's kept, stays in the host's OS credential store and goes only to that service. Each ability then offers the service by name. **Auto** uses the first connected one that makes it, after your signed-in providers and before a Shared MCP tool offered to Auto. The row says **Video made with Google Gemini** and that it ran on your key. **Ask before using another provider** asks first, naming the service and that the call is billed to that account. Only the prompt or words are sent. The phone's **Providers** page shows which services are connected. Keys are pasted only on the host's own computer. When Antigravity signs in with a Gemini API key, Gemini shows as connected with **Uses your Antigravity key**, so the key is entered once for both. A key saved under **Media** first signs Antigravity in under **Gemini API key** with nothing typed.
- **Limits:** at a usage limit, a call moves to the next provider with the ability, on that provider's chosen login. It never moves to another subscription login on its own, and when every provider is limited the call is refused with a clear message. `web_search` on **Auto** falls back to Ramu's own keyless search. Each call shows in **Activity** while it runs and counts in usage under the provider that ran it.
- **3D models:** `make_model` makes a GLB model from a description or an image (concept art from `generate_image`, a photo of a sketch), with `detail` (`low` about 5,000 triangles, `medium`, `high`), `textured` and `rigged`.
  - It runs on a 3D service a plugin maps to **3D models**, such as the Meshy or Tripo plugin. No signed-in provider makes models, so with none installed the agent offers to find one with `plugin_search`.
  - Each call spends the service's credits, so Auto uses the plugin's tool only after you approve the first model in a thread, on a card naming the service. Later models in that thread don't ask again.
  - The service works on a task for one to five minutes. Ramu asks its status tool every few seconds (Stop ends the wait, which gives up after ten minutes), downloads the file only from an origin the plugin declares, up to 100 MB, and keeps it only when it's glTF.
  - The model is an attachment of the thread with the service's preview image. In a project it's also written to `assets/models/<name>.glb`.
  - Its check reads the account's balance instead of making anything. A call stops with the service's own words (and **Open plugins**) when the account has no credits, and the row shows the credits left. Rigging, animation and retexturing are the service's own tools, approved like any Shared MCP call.
- **Helpers by ability:** `ramu_agent` takes `needs`, such as `['image_generation']`, and starts the helper on a provider that has every listed ability: a fixed choice in Abilities first, then Sub-agents routing, then the fallback order. If none has them all, it refuses and names what's missing. The helper keeps the thread's access and never gets more.
- **On a Shared MCP tool:** image generation, image editing, web search and long reads can run on a tool of a Shared MCP server you connected (an image, search or document service) instead of a provider. Choose it in **Settings → Models → Abilities**, where approved tools are listed.
  - Ramu sends the tool only the prompt or query. For a long read that's the question with the files' text. For an edit it also sends the images as data URLs in the tool's `image`, `images`, `image_url`, `input_image` or `file` field, and a tool without one is refused. The call goes through the thread's own Shared MCP access with its usual approvals, and the row names the server.
  - With the ability on **Auto**, **also try in Auto** offers one such tool after your signed-in providers. Auto reaches it only when no provider could run the call.
  - Before its first use, the first thread that needs it runs the ability's sample through the tool, with the same access and approvals (a sample image, or the five sample sites to find, which gives search tools a score). A tool whose check failed isn't used and is checked again a day later. Settings shows the result.
- **Per project:** a project's `ramu.json` can override these choices, for example to keep a client's project to one provider or turn image generation off there ([Repository settings](configuration.md#repository-settings)).
- **Asking by ability:** start a message with `@images`, `@search` or `@long` to have the agent start a helper on whichever provider and model this host picks for image generation, web search or long documents, chosen the same way as a helper's `needs`. The mention shows which model that is before you send. A handle no provider here can serve isn't offered.

Which abilities each provider offers on your host is in [Providers](providers.md#abilities).

## Asking for a helper by name

Start a message with `@` to ask for a particular helper (desktop and phone):

- **A model** from the model menu, such as `@opus-5.5 review the last commit`, for a second opinion from another model or provider.
- One of your **custom agents**, such as `@security-reviewer`.
- An **ability**: `@images`, `@search` or `@long` ([Abilities](#abilities)).

The mention shows as that model's icon and name. The message goes to the main agent, which starts that helper with your request and passes on its report. A request that asks for a change (`@opus-5.5 fix the failing test`, `@gpt-5.5 take over and finish this`) starts a helper that does the work and may edit; one that asks for a look (`review`, `check`, `why…`) starts a read-only one. A custom agent keeps its own read-only switch. The helper's card works like any other: open it to read, message or stop it.

On the desktop, live work above the message box is one row of chips: **Agents**, **Browser**, **Computer**, **Servers**, **Terminals**, **Goal** and **Queued**. A chip opens its card above the row, one at a time, and chips that don't fit move into **⋯ +N**. Things that need you, such as a question or a usage-limit wait, stay full rows above the chips. **Auto-resume** sits beside the model and access pickers until a limit is near, when the chip above the message box says so.

**Agents** above the composer lists the helpers still running beside the main agent, each with its role, status and **Stop**. Commands an agent moves to the background are in [Background terminals](background-work.md#background-commands). Its list button, or **All agents** in the thread's ⋯ menu, shows every agent the thread has had, finished ones included. On the phone the same agents are in the active-agents pill above the composer.

## Custom agents

**Settings → Goals & delegation → Custom agents** keeps reusable agents: a name, when to use it, instructions, an optional model and a read-only switch. A new host starts with four you can use right away, edit or delete: `@security-reviewer`, `@test-writer` (may edit), `@second-opinion` and `@simplifier`. Give `second-opinion` a model from another provider for an independent look. **New agent** opens an empty one to fill in. A custom agent is for work that needs its own context, model or read-only switch; instructions any agent should follow belong in a skill. The thread's agent uses one when a task fits, and its helper card shows **custom: ‹name›**. Start a message with `@name` to ask for one directly.

## Threads started by agents

An agent can start separate threads you own: a follow-up, the matching change in another project, or several parts in parallel. They appear in the sidebar, report back when they finish or need you, and keep running if the starting thread stops. A report, or a message one thread's agent sends another, shows in the receiving thread as a card naming the sending thread, with what it said folded and **Open thread** beside it, never as a message from you. The receiving agent reads it in full.

- In Full access, one thread in the same project starts at once. Anything wider shows one approval card.
- Started threads can start one more level, and a thread can start 8 an hour.
- Asked to build something new, the agent can create the project (`project_create`): a folder beside your other repositories (or in the folder you name), the framework's own generator (Next.js, Vite, Astro, Expo, a Node or Python service, Rails, Go, Rust, Swift, Tauri, Electron or Flutter, or any other framework whose official create command the agent looks up on the web; you always approve those commands, shown with their sources), a `.gitignore`, the stack in `ramu.json` and a first commit.
  - Asked from a thread with no project, that same thread moves into the new project when the turn ends and continues there with a goal checked by the project's build and tests. The next turn starts a fresh provider session that is handed the conversation. Files written before the move stay in the old folder.
  - Asked from a thread in another project, a linked thread starts in the new project with the brief and that goal.
  - Outside Full access it asks first, naming the folder and the generator.
- Asked to work on a repository that isn't a project yet, the agent can add it. A Git URL is cloned beside your other repositories (or in the folder you name) with the host's own Git credentials, and a folder on the host is registered. A project that already has that remote is reused. Outside Full access it asks first. A repository cloned straight into a project's folder, by that tool or by the agent's own `git clone`, joins that project when the turn ends. The Explorer shows it once, as its own checkout, not also as a folder inside the project folder.
- **Let agents start threads** (Settings → Threads) turns this off.

### On another host

Under **Linked hosts** in **Settings → Devices & access**, turn on **Agents here can start threads on** a host to let this host's agents start threads there. Every such start asks you first, needs an exact project name, and gets at most that host's access ceiling for the pairing (default **Allow edits**). The agent sees each host's platform and architecture next to its projects, so it can pick a host that can build the task, such as a Mac for an iOS build. See [Security](../security-model.md#host-pairing).

## Acting on several threads

In the sidebar, Cmd/Ctrl-click adds a thread to the selection and Shift-click selects a range, starting from the open thread when nothing is selected yet. The bar above the list pins, finishes, archives or deletes them together. **Delete** or **Backspace** deletes them, and **Esc** clears the selection. Archive and done can be undone. Delete still reviews each thread so a running command is never lost. **Archived** at the foot of the thread list (also **Show archived threads** in the command menu, or "archived" in Settings search) lists archived threads with search, each row's own actions and **Delete all archived threads**. On the phone, the Threads list's **Archived** filter does the same.

A thread marked done leaves its project and moves to **Done** at the bottom of the list, newest first, on the desktop and the phone. Marking it done stops what it still runs and gives back what it holds: running helpers, background commands and the servers they run, computer use, its browser tabs, a test device and file watching. When something is still running, Ramu asks first and lists what will stop. A done thread takes no turn you didn't start. Its goal and queue pause, and messages from other threads, helpers, pull request watches and deploy checks wait in its paused queue. Its transcript says it's done and how many messages are held, with **Reopen** beside it. Sending it a message, resuming its goal or queue, or **Reopen** brings it back.

On the phone, long-press a thread and choose **Select**, then tap more threads. The header marks them done, archives or deletes them, and **×** cancels. Deleting several at once keeps any thread with a background command for its own review.

In a thread on iPhone, long-press a word to select it and drag the handles to select more, as on the desktop. The bar above the message box quotes, starts a thread with, asks aside about or copies the selection. **More** has the whole message's actions. On Android, long-press a message to select its text.

A quote, a tagged file or another reference in the message box opens when you press it. A quote shows in full with **Show in conversation** (which scrolls to the message it came from and marks it) and **Remove**. A file offers **Open** and **Copy path**. On the phone a quote opens from its chip above the message box, and a tagged file offers **Open** while the cursor is in it.

## Projects on other hosts

With **Auto** as the destination, Home also weighs the projects on your other connected hosts. A request that belongs to one of them starts there, in that project's default checkout, and the thread opens. When more than one project could fit, Home asks. For work that spans several repositories, add them to one project: a folder that holds them all gives one thread every repository.

## Threads sharing a checkout

Threads on the same checkout work at the same time, and each thread's **Changes** shows only what it wrote:

- Ramu reads which files each agent edits from its edit tools. A command's writes (a formatter, a code generator, an install) belong to the thread that ran it: while two threads' turns overlap, Ramu watches the checkout, or, where the system can't watch a folder that large, reads its changed files before and after each command.
- Claude Code's commands that can change files take turns in one checkout, so whatever a command writes has one author. Commands that only read, such as `ls`, `grep` or `git status`, never wait and never hold another thread back. A command held for more than a few seconds shows **Held a command until "…" finished its own** in the thread. It waits at most two minutes, and a command moved to the background no longer holds others back.
- What another thread wrote shows below this thread's diff, folded, as **Changed by "…"** with **Open thread**. What you saved in Ramu's editor shows as **Changed by you**. A change nobody can be credited with, such as an edit in another app or a background command, shows as **Changed outside this thread**. None of them is undone, restored or committed with this thread's changes. **Add to this thread's changes** moves a **Changed by you** or **Changed outside this thread** group into the thread's own.
- A file both threads edited stays in each thread's changes, marked **Also changed by "…"**, and one you also saved during the turn is marked **Also edited by you**. Undo and restore leave such a file for you to settle, so nobody's edits are thrown away.
- When two threads edit the same file at once, both threads say so with **Open thread** and **Move to a new worktree**, which continues this thread in its own worktree.
- **Commit** with nothing staged leaves out the files another thread in the checkout changed last. The commit window lists them unticked, marked **Another thread**, and ticking one adds it. Agents are told to stage only their own files too.

Undoing a turn waits only for that thread to finish. Switching branches while threads work in the checkout asks first: **Switch when they finish** waits for them, and new messages there wait until it has switched. Creating a branch from another and merging still need every thread in the checkout to have stopped.

## Continue in a new worktree

**Continue in new thread** (thread menu) offers **In a new worktree, with the uncommitted changes** for a thread on the project's own checkout. On the phone, the thread's menu has **Continue in new thread** (same checkout, opening the new thread) and **Continue in a new worktree**. The new thread starts on a new branch in its own worktree with this conversation and a copy of every uncommitted change, new files included, so your checkout is free for other work. The original thread and its checkout stay as they are, and the two threads are linked. An agent can do the same when you ask it to move the work off your checkout. Outside Full access it asks first.

## Continue on another host

**Continue on ‹host›** (thread menu) copies a stopped thread to another connected host, or up to four with **Also on**. The sheet shows the branch it starts from, what stays behind (uncommitted files, unpushed commits), the project there and the model. It matches the project by Git remote, or clones it there. **Change…** picks the folder the clone goes in. The conversation travels with secrets removed, and files never do. Plugins, skills and MCP servers the thread used (servers it called, skills it opened, plugin command lines it ran) that the other host lacks are listed as **Not on ‹host›**, and **Install there** sends them for review on that host ([On your other hosts](plugins.md#on-your-other-hosts)). Both threads stay linked, and **Bring back result** queues the other thread's latest reply in the original.

Hosts whose platform or description (**Settings → Threads → Describe this host**) the request mentions are listed first.

## Copy and paste in a terminal

Select text with the mouse and press ⌘C on a Mac. On Windows and Linux, Ctrl+C copies while text is selected and interrupts the running command when nothing is, and Ctrl+Shift+C always copies. ⌘V, Ctrl+Shift+V, or Ctrl+V on Windows, pastes. A program that asks for bracketed paste, such as your shell, gets the pasted text as one paste rather than as typed commands. Right-click for **Copy**, **Paste** and **Select all**.

Right-click a command's output and choose **Copy command and output** to copy that command with everything it printed, without selecting it. Ramu finds where each command starts from the prompt marks your shell prints with shell integration (OSC 133, as set up for iTerm2, VS Code, WezTerm or Ghostty). Without them, each command you press Enter on in that window starts a new block, and the prompt waiting for your next command is left out. Output from before the terminal was shown again, such as after Ramu restarts, has no blocks unless the shell marked its prompts.

On the phone, select text in the terminal as you do in a chat: hold a word and lift your finger. Drag the handles at either end to select more, then tap **Copy** in the bar above it. **Select all** takes the whole terminal, and **Select command** takes the command the selection is in, with its output. Tap anywhere else to let the selection go. Holding and dragging without lifting still moves the cursor. The **Copy** button in the terminal's bar copies one of the last five commands with its output, the rows on screen, or the text you select from recent output with the phone's own selection handles. **Paste into terminal** on the key rail pastes the clipboard, and asks first when the text has more than one line.

## Terminal output in a message

To show an agent what a terminal printed, select the lines and click **Add to chat** in the terminal's corner, or right-click and choose **Add selection to chat**. With nothing selected, **Add screen to chat** takes the rows on screen. The output waits above the message box as a chip naming the terminal and its lines: click it to check the text, or × to take it off. It goes to the agent with your next message, and you can send it without typing anything. The thread's chat takes it; a project's own terminal starts **New chat** with the output in the box.

Agents can also read your terminals in the thread themselves. When you write "fix the error in my terminal", the agent lists your terminals and reads the recent output of the one that printed last, or the one it needs. It only reads, never types into them, and values that look like secrets are redacted. Commands the agent started in the background are in [Background terminals](background-work.md#background-commands) instead.

## Threads from a terminal

`ramu thread start|status|message|list` lets a terminal agent or script place work on this host. See [Remote hosts](remote-hosts.md#threads-from-a-terminal).

## Artifacts

Agents work with artifacts through tools:

- `kind` picks the artifact's kind: an `app`, a `doc` in Markdown, a `diagram` in Mermaid or SVG, `slides`, a `dashboard` over tables that can read the project's uptime checks, threads, pull requests or a file in it, a `design` of fixed-size frames, or a `motion` of timed scenes.
- The words you edited are kept in a version marked "Edited by you".
- `artifact_preview` checks it. `artifact_publish` publishes it to keep (`artifact: true`, or an artifact's id for a new version from any thread).
- `artifact_list` and `artifact_get` find artifacts, `artifact_records` works with an artifact's records, and `artifact_run` starts its runs.
- `artifact_published` records where one is live after an agent deployed it from a project. An artifact publishes itself through **Publish to the web**.

Deleting an artifact stays your action. See [Artifacts](artifacts.md).

## Cards in a thread

For a quick choice, a short form, a confirmation or a status summary, the agent shows a **card** in the thread instead of building an artifact. Cards appear at once and use the app's own buttons, fields, checkboxes, choices, tabs and lists on the desktop and the phone, in your theme and language. They run no code and load nothing from the web.

- What you type or pick stays on your device as a draft until you press a button on the card. The button goes to the agent as your message, shown in the thread as what you did (**From a card**).
- A button stays off until the fields it needs are filled in correctly, and a field that isn't valid says why.
- When the agent changes a card, it moves to the newest point in the thread, and what you entered stays unless the agent changed that same value.
- A phone paired as a viewer sees cards but can't press their buttons.
- A card with a link opens it in your browser. Only web addresses open.

Cards are for things you use once in the conversation. **Keep as artifact** on a card asks the agent to make it a [Card artifact](artifacts.md#kinds): kept under **Artifacts**, drawn the same way, and saving what you enter as records without waking the agent. Ask for an [artifact](artifacts.md) for anything else to keep, share or open later.

Agents draw cards with `show_ui`, which takes [A2UI](https://a2ui.org) v1.0 messages (`createSurface`, `updateComponents`, `updateDataModel` and `deleteSurface`) against the `getramu.dev:inline/v1` catalog. The catalog is A2UI's basic catalog without images, video, audio, modals and `regex` checks. Ramu checks a call as a whole and changes nothing when part of it is invalid, telling the agent what to fix. A button's action reaches the agent as A2UI's action message, with its context resolved. A thread shows up to 20 cards with up to 200 parts each.

## Deploys

Threads deploy with the platform's own plugin: its MCP tools, the platform's CLI in their shell, or `platform_cli` for a plugin whose CLI Ramu signs in with a saved token. Ramu recognises a production deploy from the action itself on every path. It always asks you, with **Allow production deploys in this thread** as the widest choice, and runs the project's migrations first. A preview follows the thread's access mode. After a push, the thread is woken once when the commit's checks (the platform's deploy included) finish. See [Deploying an app](deploy.md#deploying).

`ci_setup` writes a CI workflow into the thread's checkout for the agent to review and commit through a pull request. See [Set up CI](git-hosting.md#set-up-ci).

## Rules and MCP

- **Settings → Agent setup → Rules** holds your own instructions. **Always** rules reach every new thread (24,000 characters per scope). **Manual** rules stay stored. A rule for every project shows **On your other hosts** in its editor: each connected host with **Same text there**, **Different text there** or **Not there**, and **Copy there** or **Replace there** to save it on that host. Ramu also lists the instruction files providers read (`AGENTS.md`, `CLAUDE.md` and rules folders), read-only.
- **When files match** applies a rule only to work on files matching its patterns, one per line and relative to each repository (`src/api/**`, `**/*.test.ts`; up to 20, no absolute paths or `..`).
  - Claude Code applies it natively. Ramu writes it as `ramu-<name>.md` with `paths:` frontmatter. A project rule goes into `.claude/rules` in each of the project's repositories, where it can be committed and shared. A host-wide rule goes into the `rules` folder of your Claude config home (`~/.claude`, or `CLAUDE_CONFIG_DIR`), which Ramu's Claude accounts share. Ramu rewrites or removes only the files it wrote: when you edit, turn off, rescope or delete the rule, when a project's repositories change, and at startup. A folder it can't write shows on the rule. Threads in an isolated worktree see a project rule's file once it's committed on the branch the worktree starts from.
  - Other providers, and Claude when the rule is limited to other providers, receive it at the start of a thread with a line naming its patterns. It counts toward the same 24,000 characters as Always rules.
- **Customize → MCP servers** holds the servers you add for every agent.
  - **Turn on** checks a server once and gives it to every signed-in login of each agent it's offered to, in one step. There is no review per provider or account.
  - Each tool asks before every call unless you choose **Allow** for it (a tool the server marks read-only starts on **Allow**, and you see that before saving) or turn it **Off**. **Check connection** reads its tools again. A tool's approval card in the thread offers **Allow once** and **Always allow**, which switches that tool to **Allow** here, where it can be set back to **Ask**.
  - **Recommended** lists services' hosted servers (Context7, DeepWiki, Linear, Sentry, Notion, Atlassian, Figma, Stripe, Supabase, Vercel). Clicking one, or **Add**, opens a short review with **Agents** and **Projects** (every agent and all projects by default). A service that needs your account asks you to sign in in the browser after adding. A service with its own plugin in Claude's directory (Sentry, Notion, Atlassian, Figma, Stripe, Supabase, Vercel) is marked **Plugin**, and its review offers **Review plugin**, which brings the same server with the service's skills.
  - A server's details change its agents and projects the same way, and **Check with AI** reads its command or address and its tools' descriptions for anything risky. A server a plugin added shows the plugin's name and **Open plugin**. **Advanced** at the bottom keeps the full manager: accounts per identity, sign-in by pasting the address, disconnecting.
- **Settings → Agent setup → MCP servers** and **Skills** list what your provider folders and projects declare, and open on **All projects**: your own servers and skills, with one switch each that shares it with every provider and account in every project. Each says how many projects chose differently. Choose a project under **Applies to** to see its own servers and skills too. A switch there makes an exception for that project, and **Use the all-projects setting** drops it. **Connect through Ramu** is offered in a project. The phone shows the same lists read-only. **Customize → Skills** and **Customize → MCP servers** end with **Open Agent setup**, and the Customize sidebar has an **Agent setup** link, so these lists are one click from where you add skills and servers.
- **/mcp** in a thread shows each MCP server's status. Repository `.mcp.json` files and Claude's local entries are shared with every provider.
- **Many MCP calls in one step:** when a task needs many calls to your MCP servers, such as paging through issues and opening each one, the agent writes a short script with `run_script` instead of spending a turn on every call. The script can only call the thread's MCP tools: it has no files, network or shell, and each call asks for approval exactly as a direct call does. Its row reads **Ran a script** with the tools it called, how many calls it made and why it failed if it did; Stop ends it. It stops after 5 minutes or 500 calls. OpenCode threads use OpenCode's own `execute` tool for this instead.

## Secrets agents ask for

When an agent needs a token, password, PIN or pairing code only you can give, it asks with a masked card in the thread instead of in chat, on the desktop and the phone. When a page gives the value, such as a token settings page, the card has a button that opens it. **Save** sends the value to the host, which writes it to a private file only your user can read and gives the agent that file's path, never the value. The agent reads it inside the command that needs it. The value isn't stored in the thread, and the file is deleted after a day. **Decline** tells the agent to go on without it. A card left unanswered for ten minutes, or still open when the run stops, closes, and the agent asks again only if it still needs it.

When the agent names the variable a tool reads, such as `VERCEL_TOKEN`, the card on the host offers **Keep as VERCEL_TOKEN for later threads**. That adds it to [**Settings → Agent setup → Environment variables**](providers.md#environment-variables) for all providers, so new threads have it and don't ask again.

## Thread titles

A thread is named from its first message, then once more after the first reply. **Rename** always wins, and **Rename with AI** regenerates. A thread's hover card (and the phone's rename sheet) says where its title came from (your first message, Ramu, the provider, or you) and whether Ramu may still change it.

## Asides and advice

Select text in a thread to quote it or ask a read-only Aside, or type `/aside` (or `/btw`) and a question in the message box to ask about the whole thread; the agent keeps working and never sees it. A thread has one aside: every question, with the passage it was about, continues the same side conversation until you delete it. It is answered by the model chosen in that thread, or by one model for every aside when you pick it under **Settings → Models → Models for Ramu’s own work**; the model menu in the aside’s message box changes it for that aside while it stays open. Attach files or images to a question as in the thread’s message box, and the answering model reads them with it. **Continue in a new thread** opens a new thread with the aside in its message box. The optional advisor asks a second model for an opinion ([Providers](providers.md#advisor)).
