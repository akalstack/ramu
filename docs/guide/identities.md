# Identities and moving settings

## Identities

An **identity** names the accounts that belong together, such as Work and Personal: a Git author (name and email), and which of this host's connected accounts it uses. Ramu picks a project's identity from its folder or remote, so nothing is switched by hand. With one account of each kind nothing new appears and nothing changes.

**Settings → Identities** lists each identity with its name, color, Git author and rules, the connected accounts it can hold, and which identity each project uses. **Add identity** starts one; one identity is the default for projects no rule matches.

### Which identity a project uses

- **Rules** pick it: a folder (`~/work/**`) or a remote (`github.com/acme`, or `gitlab.acme.com/*` for a whole server). The more specific rule wins: a remote owner over a whole server, a remote over a folder, a deeper folder over a shallower one.
- **Pinning** a project from its menu (**Identity** on the desktop, **Use ‹identity› for this project** in its actions on the phone, or **Projects** in Settings) overrides the rules; **Follow its rules** clears the pin.
- When a project's remote owner matches no rule yet, Settings offers **Projects from github.com/acme use…** with **Add rule** or **Not now**, once per project.

The identity is looked up when an action runs, never stored on a thread, schedule or page, so pinning a project takes effect everywhere at once. With two or more identities, a project's row and its threads' headers show a small chip in the identity's color, on the desktop and the phone.

### Accounts: shared unless split

Every account is for all identities until it is put in one. Under **Accounts** in Settings, each connected account (provider logins, GitHub connections, hosting and media accounts, Shared MCP servers, plugins and browser profiles) has **Which identities is it for?**, with **All identities** first. An identity uses its own account of a kind when it has one, otherwise one that is for all identities, and never one put in another identity. A person with one Claude login and two identities uses it in both; putting a second Claude login in Personal changes Claude only.

### One service, an account per identity

Some services need a separate sign-in per identity under one setup:

- **Shared MCP servers:** **Add an account for…** on a server's card in **Agent setup** adds that identity's own account on the same server, shown as "Linear for Personal". It is signed in, or given its secrets, on its own, and its tools are checked and approved on their own, since a work workspace can offer tools a personal one does not. A project of that identity uses it in place of the original; its agent still sees one `linear` server and never chooses the account. Removing the server removes its accounts too.
- **Plugin credentials:** a plugin's card offers **For** beside a token: the first value is for every identity, and a value kept for one identity splits the slot. That identity's projects use their own value (in the plugin's CLI, data sources and MCP servers, which get an account for that identity); the others keep the shared one.
- **Hosting accounts:** **Add an account for an identity** in **Settings → Deploy** keeps a further token of a platform for one identity, such as a client's Vercel team beside your own. Deploys, databases and store releases in that identity's projects use it, and every other project uses the account for every identity. Media keys work the same way for abilities run from a project of that identity.

### What follows the project's identity

- **Commits:** agents, terminals and Ramu's own Git calls in the project run with `GIT_AUTHOR_*` and `GIT_COMMITTER_*` set to the identity's Git author. Ramu never edits your Git config; **Write to this repository's Git config** (`identities.writeGitConfig`) sets `user.name` and `user.email` in the project's repositories for commits made outside Ramu.
- **Provider logins:** a new thread starts on the identity's own login, or one for every identity, and a thread at its limit moves only to another login its identity may use; it never moves to another identity's login. A provider with no login for the identity says so when the thread starts. Abilities a thread calls on another provider use that provider's login for the same identity.
- **GitHub:** Ramu's own GitHub calls for a repository use the account put in its project's identity, unless you chose an account for that repository. Agents and terminals in the project get that account's token as `GH_TOKEN` and as Git's credential for `github.com`, so a push an agent runs itself goes as the identity too.
- **Shared MCP servers and plugins** put in one identity reach only that identity's projects.
- **Browser:** an agent browsing in a project opens the browser profile put in its identity.
- **Knowledge,** below.

### The guardrail

Before Ramu pushes, opens a pull request, merges, deploys to production or releases to the stores, it compares the account it is about to use (the repository's GitHub account, the thread's provider login, the hosting account) with the project's identity. If the account belongs to another identity, the action stops and a card opens on the desktop and the phone naming both: **Continue as ‹other›** lets the action run once within ten minutes, and **Use ‹project's identity›** opens Settings → Identities to put the right account in place.

### Knowledge: three levels

Once a second identity exists, what agents know has a middle level:

- **Project:** that project only.
- **Identity:** every project under that identity, such as "Acme's tickets are in Linear".
- **Everywhere:** every project under every identity, such as "prefer pnpm".

Memory notes take the level the agent picks; without one, user and feedback notes go everywhere, and reference notes saved in a project go to its identity. An identity's notes are stored in `identities/<id>/MEMORY.md` beside the project files. A skill learned from a project's thread starts at its identity's level. `session_search` across projects searches only the projects of the thread's identity. A rule can be limited to an identity: it reaches only that identity's projects, and Claude path rules are written into each of those projects' repositories rather than Claude's home folder.

### Between hosts

Identities belong to each host and reference that host's accounts; a thread runs under the identity of the host it is on. Hosts are compared by Git author email, which is the same everywhere (a host with no identities uses its Git config's `user.email`). **Continue on ‹host›** shows "This thread is you@acme.com. On home-server it would run as you@gmail.com." when they differ, and the host is used only after **Continue anyway**. When an agent starts threads on another host, the approval card carries the same warning.

## Moving settings

**Copy settings from…** in **Settings → Remote access** brings settings from a paired host; **Export settings** writes them to a file and **Import settings** reads one, for a new machine with no paired host. The groups are appearance, models and abilities, agent defaults, Git and commit style, notifications, rules (those for every project, or limited to an identity), identities (their Git author, rules and which accounts they hold, matched on this host by sign-in email), and **Everywhere notes** (user and feedback notes), which starts unchecked. Identities start unchecked when the source has only its default.

Before anything changes, a review lists every value that would change, and accounts an identity names that this host has not connected are listed as **Connect on this host**. **Copy** applies them as one batch; a setting changed since the review stops it. Executable paths, credentials, account tokens, workspace state and device permissions never move. Copying again updates identities in place, since each keeps its id.
