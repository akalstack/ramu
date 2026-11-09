# Plugins

A plugin adds a service to Ramu in one install: its skills, MCP servers, custom agents, a rule, the credential it needs, the CLI an agent may run with it and which of its commands are safe, the abilities its tools provide, and tables a dashboard can read. Every part is shared with every provider. Plugins use the folder layout Claude Code and Codex already use, so one repository works in all three.

## Installing

**Settings → Plugins** lists what is installed and what each plugin still needs, **Browse** searches the indexes, and **Install from a source** takes a Git address (GitHub, GitLab, or anywhere `git` can clone) or a folder on the host. [getramu.dev/plugins](https://getramu.dev/plugins) lists the same plugins; **Open in Ramu** there opens the install review in the app.

Nothing is saved until you have seen the review. It lists:

- The skills, with their files; scripts in a skill are copied only if you tick them, and Ramu never runs them.
- Each MCP server with the exact command and arguments it runs, or its address.
- Custom agents, and a rule from the plugin's `AGENTS.md`.
- The credentials it asks for, its CLI and the commands that run without asking, the abilities it maps and the dashboard data it provides.
- Its source pinned to a commit, its license, and **Signed by ‹author›** or **Unsigned**.
- Parts Claude Code or Codex use that Ramu does not (hooks, slash commands, language servers, output styles, monitors and app connectors), as **Not used in Ramu**. They are never run.
- **Applies to:** all projects (the default) or one project, so a client's plugin reaches only that client's project. To limit a plugin to an [identity](identities.md), put it in one with the identity chip on its card.

After **Install**, each credential asks for its value on the plugin's card. A token is checked with the service before it is kept, and the card shows whose it is; a sign-in opens the service's page in your browser and comes back to Ramu on this computer. **Later** leaves the plugin installed, and its card says what is missing. Credentials are pasted and signed in only on the computer running the host.

MCP servers from a plugin are Shared MCP servers like any other: they appear under **Agent setup** and need the same approval for their tools. An ability a plugin maps (an image generator, a search tool) is offered in **Settings → Models → Abilities**, and Auto tries it for an ability you have not chosen once its live check passes.

### Updates and removal

Ramu checks each plugin's source once a day (and on **Check for updates**). The card shows **Update** with what changed; updating opens the review again, and a change to an MCP server's command, a credential, the commands that run without asking, or a script asks for approval again. Nothing updates by itself.

**Remove** takes out the plugin's skills, MCP servers, custom agents, rule and saved credentials together. **Turn off** keeps the plugin and its credentials but stops its MCP servers, skills, CLI and dashboard data until you turn it on again.

### When an agent needs a service

An agent that needs a service Ramu does not know ("deploy this to Render") can call `plugin_search`, and `plugin_install` shows you the same review as an approval card, on the desktop or a phone. The agent cannot approve it, and it never handles the credential: it asks you to add it in **Settings → Plugins**. A plugin's CLI is run through `platform_cli` with its name, in threads started after the install.

### On the phone

**Settings → Plugins** on the phone lists each host's plugins with what each still needs. Installing, credentials and removal stay on the host; an agent's install card and every CLI command card reach the phone like any approval.

## Where plugins come from

Ramu hosts no plugins. A plugin is its author's Git repository or a folder. An **index** lists plugins with their source and pinned commit in `.claude-plugin/marketplace.json`, the same file Claude Code reads as a marketplace.

- [akalstack/ramu-plugins](https://github.com/akalstack/ramu-plugins) is listed by default. Plugins Akalstack maintains are marked **By Ramu**: Railway, Fly.io, Cloudflare and Supabase (their CLIs, with a skill each), and Grafana, Amplitude and Salesforce (dashboard data). Every commit in that index is signed with Akalstack's key, which ships in Ramu; a clone it did not sign is refused before anything in it is read.
- **Indexes** under **Settings → Plugins** adds any other marketplace repository, such as a company's own list. Claude Code marketplaces work as indexes too.
- An index entry can name its author's signing key (an SSH public key or an armored GPG key). Ramu then installs only a pinned commit signed by that key, checked against that key alone, and an update signed by another key asks for approval again and says so.

## Building a plugin

```sh
ramu plugin new render-deploy --cli     # or --mcp for an MCP server skeleton
cd render-deploy
ramu plugin dev .                        # install this folder as a Development plugin
ramu plugin check .                      # validate everything, naming each problem and its file
```

`ramu plugin dev` installs the folder without pinning a commit and reloads it whenever a file changes, so the next thread uses your edits; its card says **Development**, and Auto does not try its abilities. `ramu plugin check` validates the manifest, parses every skill, starts each local MCP server and lists its tools, checks that ability mappings name real tools and that every `${VAR}` a server reads comes from a credential, and says whether the latest commit is signed. The [template repository](https://github.com/akalstack/ramu-plugin-template) has the same files and a CI workflow that runs the check.

### Layout

| Path | Becomes |
| --- | --- |
| `plugin.json`, `.claude-plugin/plugin.json` or `.codex-plugin/plugin.json` (read in that order) | The manifest: `name` (lowercase words joined by dashes), `version`, `description`, `author`, `homepage`, `license`, `keywords` |
| `skills/<name>/SKILL.md` | Installed skills naming the plugin as their source; the folder's name and the skill's `name` match |
| `.mcp.json` (or `mcpServers` in the manifest) | Shared MCP servers; `${CLAUDE_PLUGIN_ROOT}` is the installed copy |
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

The agent runs it with `platform_cli` and the plugin's name. Reads run straight away; every other command asks the person with a card naming it. The CLI gets a home folder of Ramu's own, so the person's own CLI login is neither read nor changed. `credential` names the slot that signs it in when there are several.

**Abilities** map an ability to a server and tool: `{ "image_generation": { "server": "images", "tool": "generate" } }`. Image generation and editing, web search, long reads, music, sound effects and speech can be mapped.

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

**Stacks** (`nextjs`, `django`, `fastapi`, `go`, ...) let the deploy sheet and **New project** suggest the plugin, `keywords` help Browse find it, and `requires.ramu` names the oldest Ramu version it works with.

### Getting listed

Sign the commit you want listed (`git config gpg.format ssh`, `git config user.signingkey ~/.ssh/id_ed25519.pub`, `git commit -S`), then open a pull request adding an entry to [akalstack/ramu-plugins](https://github.com/akalstack/ramu-plugins) with your source, the signed commit and your public signing key. CI runs `ramu plugin check`, and a maintainer reviews the manifest, the MCP commands and how the credential is used before merging.
