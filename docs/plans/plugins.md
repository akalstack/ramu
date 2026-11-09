# Plugins

## The need

Every outside service Ramu supports today is Ramu code: a Git host, a deploy platform, a media service or a platform CLI is an adapter or a spec in `apps/server`, released with the app. Someone who wants Ramu to work with a service it does not know (Render, a company's internal deploy tool, a new image service) has to wait for a release or wire it up by hand in every project: add an MCP server under **Agent setup**, install a skill, find where the token goes, and remember which commands are safe to let an agent run. Each person repeats those steps on each host, and nothing tells them which pieces belong together.

Claude Code and Codex already package this work as plugins: a folder with a manifest, skills and MCP servers, installed from a Git repository and listed in a marketplace. Many such plugins exist. Ramu has every piece a plugin is made of (Shared MCP across providers, installed skills with approval, rules, abilities that run on an MCP tool, and `platform_cli`, which keeps a platform's token away from the agent), but no way to install them as one unit.

This plan makes a plugin the one unit for adding a service: one install brings its skills, MCP servers, credential, safe commands and abilities, shared with every provider. The person is asked for the token once, in the right place, and approves what will run. A developer builds a plugin from a template, tests it in a real thread from a folder, and gets it listed through one pull request, with no change to Ramu. Ramu's long tail of integrations moves out of the core the same way.

## Delivery

### 1. One plugin format, shared with Claude Code and Codex

A plugin is a Git repository or folder in the layout Claude Code and Codex already use, so one repository works in all three:

- A manifest: `plugin.json` at the root, or `.claude-plugin/plugin.json`, or `.codex-plugin/plugin.json`, read in that order. Name, version, description, author, homepage and license come from it.
- `skills/<name>/SKILL.md`, installed as **Installed skills** that name the plugin as their source.
- `.mcp.json`, added as Shared MCP servers owned by the plugin. `${CLAUDE_PLUGIN_ROOT}` and Codex's equivalent resolve to the installed copy.
- `agents/<name>.md`, offered as **Custom agents** (name, when to use it, instructions, read-only when it asks for no edit tools).
- `AGENTS.md` at the root, offered as a rule.

Ramu-only parts go in the manifest under `extensions["dev.getramu"]`, following the `extensions` block Codex uses for OpenAI's own fields, so other tools ignore them:

- **Credentials:** one or more slots, each with a label, the page where the token is made and the scope to pick, the environment variable a CLI or MCP server reads it from, and an optional check: one HTTPS GET with the token, saying who it belongs to. The token goes in the host's OS credential store, like every account in **Settings → Deploy**. It reaches only that plugin's MCP servers and CLI, in their environment, never in arguments, a transcript or a phone, and is replaced with `[token]` in anything they print.
- **A CLI:** binary names, an optional npm package run through `npx`, and the argument prefixes that only read. The agent gets `platform_cli` for it: reads run straight away and every other command asks with a card naming it, also from a phone. The CLI gets a home folder of its own, so the person's own CLI login is not read or changed.
- **Abilities:** which MCP tool runs image generation, image editing, web search, long reads, music, sound effects, speech or video, so **Settings → Models → Abilities** offers it with no mapping by hand. The ability's live check runs before the first use, as for any Shared MCP tool.
- **Stacks:** the project stacks the plugin suits (`nextjs`, `django`, `fastapi`, `go`, ...), so the deploy sheet and **New project** can suggest it.
- **Requirements:** the oldest Ramu version it works with.

Claude Code hooks, commands, LSP servers, monitors and output styles, and Codex app connectors, are listed on the plugin's card as **Not used in Ramu**, never run. Arbitrary code execution inside Ramu stays deferred ([roadmap](../roadmap.md#decisions-and-deferred-scope)); a plugin's code runs only as an MCP server or a CLI, under the approvals those already have.

The manifest is validated with a zod schema in `packages/shared`, bounded like every other input (sizes, counts, names, URLs). A JSON Schema generated from it is published at `getramu.dev/schema/plugin.json`, so editors check a manifest as it is written.

### 2. Installing, updating and removing

**Settings → Plugins** (beside **Agent setup**) lists installed plugins and **Browse**. **Install** takes a listed plugin, a Git URL or a folder, and shows one review before anything is saved:

- What it adds: skills (with their files), MCP servers (with the exact command, arguments and URL each runs), custom agents, rules, credentials asked for, the CLI and which commands run without asking, and abilities.
- Its source, pinned to a commit, and its license.
- **Applies to:** all projects (the default) or one project, as Shared MCP servers and skills already choose.

Scripts in skills take the second approval installed skills already need. After **Install**, each credential slot asks for its token right there, checked before it is kept; **Later** leaves the plugin installed and says what is missing on its card. MCP servers from a plugin follow the same approvals and access as any Shared MCP server.

**Updates** follow the pinned commit. Ramu checks a plugin's source once a day; the card shows **Update** with what changed, and a change to an MCP command, a credential slot, a read-only prefix or a script asks for approval again. Nothing updates by itself. **Remove** takes out its skills, MCP servers, agents, rules and credentials together, and names any thread using them.

The agent can suggest a plugin when a task needs a service Ramu does not know ("deploy this to Render"): `plugin_search` reads the index, and `plugin_install` shows the person the same review as a card, on the desktop or phone. The agent cannot approve it, and a token is always pasted by the person on the host's own computer.

The phone lists installed plugins read-only with what is missing, and shows the install and command cards.

### 3. Where plugins live

Ramu hosts no plugins and runs no registry service.

- **The plugin** is its author's Git repository (GitHub, GitLab, or anywhere `git` can clone), or a folder.
- **The index** is `akalstack/ramu-plugins`: a public repository whose `.claude-plugin/marketplace.json` lists each plugin's name, description, source repository and pinned commit. The same file works as a Claude Code marketplace. Adding or updating a plugin is a pull request. CI runs `ramu plugin check` on the pinned commit, and a maintainer reviews the manifest, MCP commands and credential use before merging. Plugins Akalstack maintains are marked **By Ramu**.
- **Other indexes:** **Settings → Plugins → Indexes** adds any marketplace repository or URL, such as a company's internal list, and Browse shows each index by name. Claude Code marketplaces work as indexes too.
- **getramu.dev/plugins** is a static page built from the index when the site builds: search, each plugin's description, what it adds and the services it needs, and an **Open in Ramu** link (`ramu://plugin/install?source=…`) that opens the install review.

### 4. Building a plugin

The goal is a first working plugin in under 30 minutes for someone who has written an MCP server or a skill before.

- `ramu plugin new <name>` writes a working plugin folder: the manifest with the schema link, one skill, a commented `extensions["dev.getramu"]` block and a README, with `--mcp` for a TypeScript MCP server skeleton and `--cli` for a CLI-driven platform.
- `ramu plugin check [folder]` validates the manifest, parses every skill, starts each MCP server and lists its tools, checks that ability mappings name real tools and that read-only prefixes are not empty, and prints each problem with the file and the fix. The index repository's CI runs the same command.
- `ramu plugin dev [folder]` installs the folder as a **Development** plugin on this host, skipping the commit pin, and reloads its skills, servers and manifest when a file changes. A thread uses it right away. Its card says **Development** and it is never offered to Auto for abilities until installed normally.
- A template repository, `akalstack/ramu-plugin-template`, with the same files and a CI workflow running `ramu plugin check`.
- A guide page, `docs/guide/plugins.md`, for people installing plugins and for authors: the format, the Ramu extension fields with an example each, credentials and what Ramu guarantees about them, how to test with `plugin dev`, and how to get listed.

### 5. First-party integrations move to plugins

Ramu's own long tail proves the format and gives authors real plugins to copy:

- **Railway, Fly.io, Cloudflare and Supabase** become plugins in `akalstack/ramu-plugins`: credential slot, CLI spec and read-only prefixes from `CLI_PLATFORM_SPECS` (`apps/server/src/workspace/deploy/cliPlatforms.ts`), and a skill with each platform's setup files. `CLI_PLATFORM_SPECS`, their per-platform code and their rows in **Settings → Deploy** are removed. Saved tokens for them are not carried over; the deploy sheet's stack suggestion offers the plugin, and its install asks for the token once.
- **Later, by evidence:** the roadmap's comparison of Ramu's deploy flow against a plain agent with the platform CLIs decides which deploy adapters stay. The same comparison, run for Bitbucket and Azure DevOps against an agent with their CLIs and a plugin's skill, decides whether those forges stay first-party. GitHub, Vercel, Netlify and Neon stay in Ramu: the Pull requests page, the deploy sheet, deploy watch, uptime and phone approvals are where Ramu's own UI clearly wins, and a plugin cannot carry UI.
- **Media services** move when a service ships an MCP server that makes the file (an ElevenLabs plugin mapping speech, music and sound effects to its tools). The `MediaConnector` for that service is removed once its plugin passes the same live checks.

## Existing services to extend

- Skill installation, preview and second approval for scripts: `apps/server/src/memory/externalSkills.ts`, `apps/server/src/memory/skillFiles.ts`.
- Shared MCP servers, their storage, policy and approvals: `apps/server/src/mcp/service.ts`, `storage.ts`, `policy.ts`.
- Token-in-environment CLI runs, read-only prefixes and command cards: `platform_cli` in `apps/server/src/workspace/deploy/tools.ts` and `cliPlatforms.ts`; token storage in `apps/server/src/workspace/deploy/accounts.ts`.
- Abilities on a Shared MCP tool and their live checks: `apps/server/src/agent/abilities.ts`.
- Custom agents and rules: `apps/server/src/agent/customAgents.ts`, `apps/server/src/rules`.
- Stack suggestions: `apps/server/src/workspace/projectCreate.ts` and the deploy sheet.
- The host CLI for the `ramu plugin` commands: `apps/server/src/cli.ts`.
- Settings UI under **Agent setup**, and the site in `apps/site`.

## Acceptance

- Representative task: someone with a FastAPI app asks to deploy it to Railway. The deploy sheet suggests the Railway plugin; one review installs it, they paste the token once, and the app is live with `railway up`, with no command typed and the token in no transcript. Before, it took connecting Railway in Settings plus Ramu code for Railway; with a service Ramu has never heard of, it took adding an MCP server, a skill and a token by hand.
- Someone outside the team runs `ramu plugin new`, builds a plugin for a service with an MCP server, tests it with `ramu plugin dev` in a thread on Claude and on Codex, and gets it listed through a pull request whose CI passes, without changing Ramu.
- A Claude Code plugin from an existing marketplace installs in Ramu unchanged, its skills and MCP servers work on a Codex thread, and its hooks are listed as **Not used in Ramu**.
- An update that changes an MCP server's command asks for approval again; one that changes only a skill's wording shows the change and updates on **Update**.
- **Remove** leaves no skill, MCP server, agent, rule or credential behind.
- A plugin's token never appears in a CLI argument, MCP server argument, transcript, log or phone payload.
- `ramu plugin check` rejects a manifest with an ability mapped to a missing tool, an empty read-only prefix, an oversized file or an unknown credential variable, naming each.
- The agent's `plugin_install` card cannot be approved by the agent, and works from a phone.
- Server tests for manifest parsing across the three layouts, bounds, install, update re-approval, removal, credential injection and redaction; web tests for the review, the card states and Browse; strings translated to Indonesian.

## Later options

- Identity-scoped plugins, once [Identities](identities-and-settings.md) ships: a client's internal plugin only in that client's projects.
- A plugin carrying a dashboard **named service** (Grafana, Amplitude, Salesforce today are Ramu code), if the table query shape can be declared without code.
- Signed plugins, if the index grows beyond what review of a pinned commit covers.
