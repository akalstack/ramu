# Plugins

A plugin adds a service to Ramu in one install: its skills, MCP servers, custom agents, a rule, the credential it needs, the CLI an agent may run with it and which of its commands are safe, the abilities its tools provide, and tables a dashboard can read. Every part is shared with every provider. Plugins use the folder layout Claude Code and Codex already use, so one repository works in all three.

## Installing

**Customize → Plugins** (the rail's Customize button on the desktop; **Settings → Plugins** on the phone) lists the plugins that need a key first, then what is installed, then **Recommended** (Ramu's own, signed), **Claude plugins** (Claude's plugin directory, filtered by category, a page at a time until **Show all**) and **More plugins** from other indexes, each with its service's mark. A plugin listed in two indexes shows once, from Ramu's index first, and its review offers the other listing with **Review that one**. The search filters all of them, **+** opens the install review, and **Add → From a GitHub address or folder** takes a Git address (GitHub, GitLab, or anywhere `git` can clone) or a folder on the host. [getramu.dev/plugins](https://getramu.dev/plugins) lists the same plugins; **Open in Ramu** there opens the install review in the app.

Nothing is saved until you have seen the review. It lists:

- The skills, with their files; scripts in a skill are copied only if you tick them, and Ramu never runs them.
- Each MCP server with the exact command and arguments it runs, or its address.
- Custom agents, and a rule from the plugin's `AGENTS.md`.
- The credentials it asks for, its CLI and the commands that run without asking, the abilities it maps and the dashboard data it provides.
- Its source pinned to a commit, its license, and **Signed by ‹author›** or **Unsigned**.
- Parts Claude Code or Codex use that Ramu does not (hooks, language servers, output styles, monitors and app connectors), as **Not used in Ramu**. They are never run. A plugin with nothing else cannot be installed, and the review says why.
- Slash commands (`commands/*.md`) as skills of the same name, which every agent reads; `$ARGUMENTS` stands for what the person asks with them.
- An MCP server that already exists at the same address, added by hand: the plugin takes it over instead of adding a second copy, and its tools are turned on again after installing.
- **Applies to:** all projects (the default) or one project, so a client's plugin reaches only that client's project. To limit a plugin to an [identity](identities.md), put it in one with the identity chip on its card.

The review groups what the plugin adds one kind per row (its skills, MCP servers, the key it asks for, the commands that run without asking, abilities, dashboard data, a rule), showing the first few of a long list and the rest on demand. After **Install**, a plugin that needs a key opens on it straight away; each credential asks for its value there. A variable a plugin's MCP server reads from the environment (`${GITHUB_TOKEN}` in a Claude Code plugin's `.mcp.json`) that no declared credential fills is asked for the same way, named after the variable. A plugin that needs no key opens its first MCP server's tools next, so you choose which ones ask before they run. A token is checked with the service before it is kept, and the card shows whose it is; a sign-in opens the service's page in your browser and comes back to Ramu on this computer. **Later** leaves the plugin installed, and its card says what is missing. Credentials are pasted and signed in only on the computer running the host.

MCP servers from a plugin are Shared MCP servers like any other: they appear under **Customize → MCP servers** marked with the plugin, turned on and their tools chosen the same way, and **Choose tools** on the plugin's card opens each one. Removing or changing what one runs belongs to its plugin, so its server shows **Open plugin** instead of **Remove** and **Edit**. A plugin's local command is saved with its lasting path, so a version manager's per-shell folder (fnm's) going away after a restart does not break it. An ability a plugin maps (an image generator, a search tool) is offered in **Settings → Models → Abilities**, and Auto tries it for an ability you have not chosen once its live check passes.

### Updates and removal

Ramu checks each plugin's source once a day (and on **Check for updates**). The card shows **Update** with what changed; updating opens the review again, and a change to an MCP server's command, a credential, the commands that run without asking, or a script asks for approval again. Nothing updates by itself.

**Remove** takes out the plugin's skills, MCP servers, custom agents, rule and saved credentials together. **Turn off** keeps the plugin and its credentials but stops its MCP servers, skills, CLI and dashboard data until you turn it on again.

### When an agent needs a service

An agent that needs a service Ramu does not know ("deploy this to Render") can call `plugin_search`, and `plugin_install` shows you the same review as an approval card, on the desktop or a phone. The agent cannot approve it, and it never handles the credential: it asks you to add it in **Customize → Plugins**. A plugin's CLI is run through `platform_cli` with its name, in threads started after the install.

### A plugin made by asking

For a service no index lists ("connect Rodin for 3D models"), the agent offers `plugin_create`: it starts a folder in `~/Ramu Plugins/<name>`, writes the manifest, the MCP server and a skill from the service's own documentation, runs the same check as `ramu plugin check` until it passes, and then shows you the usual review card. Approving installs it as a Development plugin whose abilities are used at once. The agent never sees the key: you paste it on the plugin's card.

### On your other hosts

A plugin, skill or MCP server you set up once can be on every host you use. **Available on** in its details (**Customize → Plugins**, **Skills** or **MCP servers**) lists your other connected hosts with whether each has it (**Installed**, **Waiting for review there**, **Not there**). Ticking a host sends it the setup, and **All your hosts** also reaches hosts you connect later, including those listed in your [Ramu account](account.md#your-hosts), whenever the desktop app is connected to both. No account is needed: paired hosts work the same.

What travels is the setup: a plugin's source and pinned commit, an installed skill's source (or the text of one you wrote), a server's address or command, and which tools are on and which ask before they run. Keys, sign-ins, header and variable values, and folders never travel. A plugin from a folder, or one for a single project, stays on its host and says so.

On the receiving host the item waits under **From your other hosts** at the top of its Customize section, and a notice says it is ready to review. **Review** opens the same review as an install from there; a plugin installs through its index when that host has it, else from the same commit, and one kept for an identity there is offered for the same identity's projects when this host has it. Once installed, its servers' tools are turned on as they are on the other host, and the plugin card asks for its key, which you add on that host. A server that needs a header or variable opens its editor first and turns on with the other host's tools whenever you turn it on, even later; one whose command that host lacks is added turned off, marked with the command to install. A server of the same name already there is changed to the new address rather than added twice, keeping the secrets it still needs. **Dismiss** drops an item until a newer version is sent. Installing still happens on the computer running the host, as any install does.

On a host with no desktop app, `ramu tools` lists what is waiting, and `ramu tools install <name>` shows the same review in the terminal, asks before installing (and again for skill scripts), and takes any key it needs without showing it. `ramu tools remove <name>` and `ramu tools dismiss <name>` answer the rest.

Removing a tool offers **Also ask your other hosts to remove it**, checked when it is kept on other hosts. Each of them lists it as **Removed on ‹host›** with **Remove here** or **Keep it here**; a host that connects later is asked then. Unticking a host in **Available on** only stops sending to it.

If a host refuses what the desktop app sends (it has not allowed **Change settings** for this device), a notice says which host and what to allow.

An agent can do the same: `plugin_install` and `skill_install` take `hosts: "all"` when you ask for a tool on all your hosts, and the approval card says so. **Copy settings from…** and **Export settings** also carry Plugins, Skills and MCP servers groups ([Moving settings](identities.md#moving-settings)).

### On the phone

**Customize → Plugins** on the phone lists each host's plugins with what each still needs, and what other hosts sent it to review. Installing, credentials and removal stay on the host; an agent's install card and every CLI command card reach the phone like any approval.

## Where plugins come from

Ramu hosts no plugins. A plugin is its author's Git repository or a folder. An **index** lists plugins with their source and pinned commit in `.claude-plugin/marketplace.json`, the same file Claude Code reads as a marketplace.

- [akalstack/ramu-plugins](https://github.com/akalstack/ramu-plugins) is listed by default. Plugins Akalstack maintains are marked **By Ramu**: `fly-cli` (flyctl with your saved token, for Fly.io, which Claude's directory has no plugin for), `grafana-data`, `amplitude-data` and `salesforce-data` (dashboard data), Meshy and Tripo (3D models) and Godot. They hold only what Ramu adds; where the service has its own plugin in Claude's directory, Ramu's names it as its `companion`, the service's skills teach agents the service, and Ramu's short skill says how to run it here. Installing either one offers the other's review next (**Also review … next**, on by default), and each card shows **Pairs with** and whether the other is installed. Every commit in that index is signed with Akalstack's key, which ships in Ramu; a clone it did not sign is refused before anything in it is read.
- [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official), Claude's plugin directory, is listed by default too. Its plugins are their authors' (Atlassian, Notion, Figma, Stripe, Vercel, Unity and hundreds more), pinned to a commit in the directory, and reviewed like any other before they install. A listing Ramu cannot fetch (one installed by running a command) is left out rather than hiding the rest of the index.
- **Indexes** under **Customize → Plugins** adds any other marketplace repository, such as a company's own list. Claude Code marketplaces work as indexes too.
- An index entry can name its author's signing key (an SSH public key or an armored GPG key). Ramu then installs only a pinned commit signed by that key, checked against that key alone, and an update signed by another key asks for approval again and says so.

## Building a plugin

```sh
ramu plugin new render-deploy --cli     # or --mcp for an MCP server skeleton
cd render-deploy
ramu plugin dev .                        # install this folder as a Development plugin
ramu plugin check .                      # validate everything, naming each problem and its file
```

`ramu plugin dev` installs the folder without pinning a commit and reloads it whenever a file changes, so the next thread uses your edits; its card says **Development**, and Auto does not try its abilities. **Share** on a Development plugin's card pushes its folder to a private repository on your own GitHub account through your `gh` sign-in, so you can open a pull request to an index from there. `ramu plugin check` validates the manifest, parses every skill, starts each local MCP server and lists its tools, checks that ability mappings name real tools and that every `${VAR}` a server reads comes from a credential, and says whether the latest commit is signed. The [template repository](https://github.com/akalstack/ramu-plugin-template) has the same files and a CI workflow that runs the check.

### Layout

| Path | Becomes |
| --- | --- |
| `plugin.json`, `.claude-plugin/plugin.json` or `.codex-plugin/plugin.json` (read in that order) | The manifest: `name` (lowercase words joined by dashes), `version`, `description`, `author`, `homepage`, `license`, `keywords` |
| `skills/<name>/SKILL.md` | Installed skills naming the plugin as their source, named by the skill's `name`; a folder without a `SKILL.md` is ignored |
| `commands/*.md` | Slash commands, installed as skills of the same name |
| `.mcp.json` (or `mcpServers` in the manifest) | Shared MCP servers, with or without the `mcpServers` wrapper; `${CLAUDE_PLUGIN_ROOT}` is the installed copy |
| `agents/<name>.md` | Custom agents; one whose `tools` lists no editing tool is read-only |
| `AGENTS.md` | A rule for every project the plugin applies to |

Editors check a manifest against [getramu.dev/schema/plugin.json](https://getramu.dev/schema/plugin.json) when it names it in `$schema`.

### Ramu's fields

Ramu-only parts go under `extensions["dev.getramu"]` in the manifest, which other tools ignore.

**Credentials** are one to four slots. Each has an `id`, a `label`, the environment variable (`env`) a CLI or MCP server reads it from, and a `kind`:

```json
{
  "id": "token",
  "label": "Render API key",
  "env": "RENDER_API_KEY",
  "kind": "token",
  "page": "https://dashboard.render.com/u/settings#api-keys",
  "scope": "Read and deploy, for one workspace",
  "pattern": "^rnd_",
  "fields": [{ "id": "region", "label": "Region", "env": "RENDER_REGION", "values": ["oregon", "frankfurt"] }],
  "check": { "request": { "url": "https://api.render.com/v1/owners" }, "identity": "0.owner.email" }
}
```

- `fields` are values a service needs beside the token: `text`, `secret`, or `url` (an https address, which becomes an origin the plugin's requests may call, such as a Grafana stack's address). `values` makes a field a menu.
- `check` is one HTTPS request made with the value before it is kept; `identity` is a path in the answer naming whose it is.
- A `sign-in` slot runs OAuth with PKCE through the person's own client, whose id they paste: `signIn` names `authorizeUrl`, `tokenUrl`, `scopes`, an optional `sandbox` pair of URLs, the `clientPage` where the client is made, and `instanceField` when the token answer names the address later calls go to (Salesforce's `instance_url`, then usable as `{field.instance}`). The client registers `http://localhost:7417/plugin/callback`. Ramu renews the token before it expires.

What Ramu guarantees: every value is kept in the host's OS credential store and reaches only that plugin's MCP servers, CLI and data sources, in their environment or request headers. It is never put in an argument, a transcript or a phone's payload, and it is replaced with `[token]` in anything the CLI prints.

**A CLI** names its `binaries`, an optional `npx` package for when none is installed, and the argument prefixes that only read:

```json
{ "binaries": ["render"], "npx": "@render/cli", "reads": [["whoami"], ["services", "list"], ["logs"]] }
```

The agent runs it with `platform_cli` and the plugin's name. Reads run straight away; every other command asks the person with a card naming it. Deploys need no marking: Ramu recognises them from the command itself, so a preview deploy runs without a card and a production one asks with **Allow production deploys in this thread** as its widest choice and runs the project's migrations first ([Deploying an app](deploy.md#deploying)). The CLI gets a home folder of Ramu's own, so the person's own CLI login is neither read nor changed. `credential` names the slot that signs it in when there are several. A plugin with no credential slot runs a local tool that signs nothing in (a game engine such as Godot): it keeps the person's own home folder, where the tool's settings live.

**Abilities** map an ability to a server and tool: `{ "image_generation": { "server": "images", "tool": "generate" } }`. Image generation and editing, web search, long reads, music, sound effects, speech and 3D models can be mapped. A 3D service works in the background and links to its file, so its mapping says more:

```json
{
  "model_3d": {
    "server": "meshy",
    "tool": "meshy_text_to_3d",
    "fromImage": "meshy_image_to_3d",
    "refine": "meshy_text_to_3d_refine",
    "status": "meshy_get_task_status",
    "balance": "meshy_check_balance",
    "downloads": ["https://assets.meshy.ai", "https://*.meshy.ai"]
  }
}
```

- `status` is asked with the task id the first call returned (and `wait: false` when it takes one) until the result links to a GLB; `fromImage` takes an image instead of words, as a local `file_path` when the tool reads one; `refine` textures a text preview, given the preview's task id.
- `balance` is what the live check calls, so checking costs nothing; `downloads` lists the https origins a model may come from (`https://*.domain` for a CDN's subdomains), and a link anywhere else is refused.

**Data sources** are tables a Dashboard artifact reads by `id`, declared without code:

```json
{
  "id": "render",
  "label": "Render services",
  "credential": "token",
  "request": { "url": "https://api.render.com/v1/services?limit={query.limit}" },
  "query": [{ "name": "limit", "type": "number", "min": 1, "max": 100, "default": 20 }],
  "rows": { "shape": "objects", "path": "" }
}
```

- `request` is one GET, or a POST to an endpoint that only reads (say so with `"readOnly": true`), to an https origin fixed in the template or taken from a `url` field. With no `headers`, the value goes as `Authorization: Bearer`. Templates fill `{token}`, `{field.<id>}`, `{query.<name>}`, `{basic.<id>}` (Basic credentials from the token and that field), `{date.today}` and `{date.since.<name>}` (YYYYMMDD); `:json` writes a value as JSON, and in a body `"...": "{query.x}"` merges an object field in.
- `query` declares each field a table fills in: `type` (`string`, `number`, `boolean` or `object`), `values`, `default`, `min`, `max`, `maxLength`, `pattern` (such as `^\s*select\s` for a SOQL query that only reads) and `required`. A field the source does not declare is refused.
- `rows` turns the answer into rows: `objects` (a list, columns read by path, so `Account.Name` follows a relationship), `columns` (names at one path, values as one list per column, as Grafana returns frames) or `series` (dates and series, as `date`, `series` and `value`).

Ramu bounds the answer's size and time, and a dashboard reads a source only after its **Allow**.

**Stacks** (`nextjs`, `django`, `fastapi`, `go`, ...) let **New project** suggest the plugin, `keywords` help Browse find it, and `requires.ramu` names the oldest Ramu version it works with. `companion` names the service's own plugin in Claude's directory when yours only connects it to Ramu, so installing yours offers that one too.

### Getting listed

Sign the commit you want listed (`git config gpg.format ssh`, `git config user.signingkey ~/.ssh/id_ed25519.pub`, `git commit -S`), then open a pull request adding an entry to [akalstack/ramu-plugins](https://github.com/akalstack/ramu-plugins) with your source, the signed commit and your public signing key. CI runs `ramu plugin check`, and a maintainer reviews the manifest, the MCP commands and how the credential is used before merging.
