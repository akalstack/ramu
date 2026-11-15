# Plan: the same tools on every host

## The need

Someone with a laptop, a home server and a work Mac installs a plugin, adds a Shared MCP server or installs a skill on one host. Today the others never learn about it. **Copy settings from…**, **Export settings** and the account backup move rules, identities and preferences, but not skills, MCP servers or plugins ([Moving settings](../guide/identities.md#moving-settings)). So the person repeats each install on each host, has to remember which host has what, and finds out a tool is missing only when a thread moved with **Continue on ‹host›** can no longer use it.

Claude's connectors and ChatGPT's plugins belong to one account on one backend, so they never meet this problem, and they cannot reach a person's own machines either. Ramu runs agents on several hosts the person owns, so it can do better: it copies the **setup** to each host and leaves keys on the host where they were entered.

After this work:

- Installing a tool once and choosing **All hosts** puts it everywhere: one review per host, with no repeated searching, choosing tools or copying addresses.
- Restoring a new machine brings tools back with the theme and rules. All that is left is adding keys, and each host shows what it is missing.
- A thread moved to another host warns before the move that a tool it used is missing there, and offers **Install there**.

## Principles

- **No account required.** Syncing works between paired hosts and through an export file, the way **Copy settings from…** does today. Signing in to a Ramu account only makes it automatic: **All hosts** reaches every host listed under **Your hosts**, and the backup carries tools too.
- **What moves is the setup, never secrets.** A plugin's source and pinned commit, a skill's source, and a Shared MCP server's address or command, its tool choices and its approvals. Keys, sign-in tokens, OAuth clients, local paths and workspace state never move.
- **Each host reviews and installs from the source.** A receiving host clones the pinned commit and checks its signature as a normal install does. It shows the same review, and scripts still need their second approval. Nothing installs without someone approving it on that host or on a device allowed to approve there.
- **The account stays a sealed relay.** It gets no tools list, connector page or logic of its own. Every manifest is sealed with the backup key before it leaves the host, so the account cannot read plugin names, MCP addresses or tool choices.
- **The host owns it.** Whether a tool is synced, and the list of what a host should have, live on the server behind the typed API, next to the plugin, MCP and skill services. The desktop and phone only display it and send approvals.

## Delivery

### 1. Portable tool setup in the settings format

Extend `packages/shared/src/settingsTransfer.ts` with three groups, all checked by default: **Skills**, **MCP servers** and **Plugins**.

- `portablePlugin`: index name and URL (or Git address), plugin name, pinned commit, the signing key when the index names one, enabled state, and per server: tools turned on, **Allow**/**Ask**/**Off** per tool, and the identity it belongs to. No credential values, only which credential slots exist.
- `portableSkill`: for installed skills, the source (skills.sh name, repository, URL) and the version that was approved; for **Your skills**, the SKILL.md text and its files, within size limits and with scripts marked. Learned **Ramu's skills** move only when they are pinned or the person checks them, since learning on each host keeps its own set. Skills scoped to projects carry the project's Git remote, not its id.
- `portableMcpServer`: name, transport (`http` URL, or `stdio` command and arguments), the environment variable names it needs (never values), tool choices and approvals, the identity it belongs to and which providers it is offered to. Servers that come from a plugin travel with the plugin, not on their own.
- Every new field is bounded and validated with `zod`, like the existing `rule` and `note` schemas. The version of `settingsExportSchema` goes up, and the old version is dropped (no backward compatibility).

`apps/server/src/ipc/handlers/settingsTransfer.ts` already receives `plugins` and `getSharedMcp` in `TransferSources`. Export reads from the plugin service (`apps/server/src/plugins/service.ts`), the MCP service (`apps/server/src/mcp/service.ts`) and installed skills (`apps/server/src/memory/externalSkills.ts`).

### 2. Reviewing and applying on the receiving host

`transferChanges` lists one row per tool: **New**, **Update to ‹commit›**, **Same** (hidden) or **Not portable**:

- A `stdio` command that does not exist on this host's `PATH`, or an absolute path, is listed as **Connect on this host** with the command shown. Copy leaves it off until the person fixes it.
- A plugin from a folder on the source host, with no Git address, is **Not portable: it lives in a folder on ‹host›**, with **Publish it to Git first** pointing to `ramu plugin` authoring.
- A plugin whose index this host does not trust is shown with the index, and adding the index is part of the same review.

**Copy** applies the setup in one batch per kind through the existing install paths: `plugins/source.ts` clones and verifies the pinned commit, the external skill installer fetches the source, and the MCP service adds the server and checks it once. Scripts and plugin CLI commands still ask on their own cards. If the source changed since the review, it stops, as it does today.

After Copy, the existing cards in **Customize → Plugins** and **Customize → MCP servers** show what each item still needs (**Needs a key**, **Sign in**, **Connect on this host**). The page lists them first, as it already does for plugins.

### 3. Available on: a host-level choice on each card

In **Customize → Plugins**, **Customize → MCP servers** and **Customize → Skills**, each card gets **Available on**: **This host** (default), specific connected hosts, or **All hosts**.

- Picking a host sends it the item's portable setup over host pairing. The receiving host puts it in **Waiting for you** in its Customize page and in Home's needs-you list. **Review** opens the install review with the source host named ("From laptop"). The phone can approve it if it is allowed to approve on that host.
- **All hosts** saves a host-level list of synced items. **Update** on the source host offers to update the others with the new commit; each host reviews the change before it applies.
- **Remove** on a synced item asks **Remove from all hosts** or **Only here**.
- Each card shows a small row of the hosts that have the item, and which of them still need a key. The phone shows the same in **Customize** for each host.

New components are composed in `apps/web/src/components` on top of the existing card and sheet wrappers, never in `components/ui/`. Every string goes through `t()` with an Indonesian translation.

### 4. With a Ramu account: every listed host, and restore

- **All hosts** means paired hosts plus every host under **Your hosts**. A listed host that is offline gets the update the next time it checks in at the account. The sealed manifest waits in the account's relay, as pairing requests do.
- The sealed settings backup includes the three new groups by default, so **Restore** on a new machine lists tools to install alongside the theme, rules and identities, in one review.
- A host listed later, or a fresh install, is offered the **All hosts** set once in first-run setup (**Restore your settings?**) and after that in **Waiting for you**.
- No new account endpoints beyond what the relay and backups already have. If the backup size limit (256 KB) is too small for **Your skills** with files, those skills' files go to their own sealed slot. That has to be measured first, not assumed.

### 5. Continue on ‹host› checks tools first

In the **Continue on ‹host›** sheet (and the card for an agent starting threads on another host), the server compares the tools the thread used (plugin MCP calls, Shared MCP calls and loaded skills in its record) with the target host's tools, and lists the missing ones under **Not on ‹host›** with **Install there**. That sends the same setup as step 3, and the sheet waits for the review there or continues without the tools on **Continue anyway**. Tools that are on the target but need a key are named with **Needs a key on ‹host›**.

### 6. Agent tools

`plugin_install` and the skill installer get an optional `hosts` input (`this`, a host name, or `all`), so "install the Linear plugin on all my hosts" works from a thread. It produces one approval card on each host, with no new path that widens access. **Available on** is not a typed setting agents can change: an agent proposes it and the person confirms.

## Later options

Each one waits until the base delivery is used and people ask for it:

- **Send this key to ‹host›:** copying a plugin's or MCP server's credential to another host, sealed to that host's device key and relayed by pairing or the account, with a matching six-digit number on both screens as backup-key approval does today. It reopens the deferred "credential synchronization" decision in [the roadmap](../roadmap.md#decisions-and-deferred-scope) and needs the same security review as [host pairing](../../SECURITY.md#host-pairing). Do it only if adding keys again turns out to be the main friction.
- **One sign-in reused by OAuth tools:** for MCP servers and plugins that sign in with OAuth, letting the second host start sign-in from the phone (where the browser is) instead of the host's desktop. This matters for headless home servers.
- **Sets of tools per identity:** **All hosts** limited to an identity, so a work plugin syncs only to hosts where the Work identity exists, matched by Git author email as identities already are between hosts.
- **Provider config files:** offering to bring in skills and MCP servers found in provider folders (`~/.claude`, `~/.codex`) as Ramu's own before syncing, instead of syncing provider files directly. That stays deferred.
- **Rules folders of Claude written on each host:** rules already move. A later option is showing on each rule card which hosts have it, using the same row as step 3.
- **A team share:** handing a tool set (plugins, servers and choices, no keys) to another person as a link or file they review and install. It uses the same portable format and is only built when a team asks for it.

## Tests

- `packages/shared/test/settingsTransfer.test.ts`: the three groups export and parse, oversized and malformed entries are refused, no credential value or absolute path appears in an export, and `transferChanges` labels New, Update, Same, Not portable and Connect on this host.
- `apps/server` tests: export from a host with a plugin, a Shared MCP server and an installed skill gives the setup without secrets. Import installs the plugin from its pinned commit, refuses an unsigned commit when the index names a key, keeps a `stdio` server with a missing command off, and stops when the source changed after the review. Continue on ‹host› lists a missing plugin.
- `apps/web` tests: **Available on** sends to the chosen hosts, **Waiting for you** lists the received item, and **Remove from all hosts** asks first.
- Typechecks for shared, server, web and mobile. Desktop-facing changes run `pnpm build` then `pnpm test:desktop-smoke`.

## Acceptance

- With two paired hosts and no Ramu account, installing the Linear plugin on the laptop with **All hosts**, reviewing it on the home server and adding its key there takes one search, two reviews and one key, compared with two searches, two installs, two rounds of choosing tools and two keys today. A Linear call on a home-server thread works.
- A Shared MCP server with a URL and three allowed tools, copied to another host, has the same tools allowed with no extra choices.
- A `stdio` server whose command is missing on the target shows **Connect on this host** and stays off.
- Signed in to a Ramu account, a wiped Mac restored from backup lists the plugins, servers and skills from before, reinstalls them in one review, and asks only for keys. The account's stored data holds no readable plugin or server name.
- **Continue on ‹host›** for a thread that used a plugin the target lacks shows **Not on ‹host›**, and **Install there** makes it available before the thread starts there.
- From the phone, a received item is approved and its key is added on a headless host.
