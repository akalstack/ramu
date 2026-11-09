# Identities and moving settings

## The need

People who use Ramu for paid work and for their own projects keep two sets of accounts on one computer: a work Claude or Codex login and a personal one, a company GitHub or Enterprise account and their own, a client's Vercel team and their hobby account. Today each of these is chosen in a different place (the first enabled provider login, the selected forge connection per origin with per-repository overrides, the connected hosting account), and the commit email comes from whatever Git config the host has. Ramu leaves the person to keep all of that matched by hand. Getting it wrong is costly and hard to undo: work code committed with a personal email, a personal subscription spending its limit on company code, a deploy to the wrong team, or company notes in memory reaching a personal project.

The same people set Ramu up on more than one machine. A second host starts from defaults, and they redo theme, models, abilities, commit style and notification choices from memory.

Profiles switched by hand would copy every setting and add one more thing to remember, and an account cannot carry credentials or workspace state, which never leave the host. This plan does both jobs without a switcher and without requiring an account; an optional Ramu account adds encrypted backups ([Ramu account](ramu-account.md)).

## Delivery

### 1. Identities that follow the project

An **identity** names the accounts that belong together, and nothing else:

- Git author name and email, and optionally a signing key reference.
- One login per provider (references to the logins in **Settings → Providers**).
- A Git hosting connection per origin (GitHub, GitHub Enterprise, GitLab, Bitbucket, Azure DevOps).
- Hosting accounts for deploys, databases and store releases.
- A browser profile (**Default**, or one made with **Import…**), so an agent browsing in a work project opens the work sign-ins.
- A memory level of its own ([Memory](#memory-three-levels)).

Theme, layout, keybindings, models, abilities, rules and every other setting stay host-wide. Shared MCP servers and skills are available under every identity unless their **Applies to** limits one to an identity. An identity holds only references to accounts already connected on the host; no credential is copied or moved.

**Inferred, not switched.** Each identity has match rules: folders (`~/work/**`), and repository remotes by origin and owner (`github.com/acme/*`). Ramu picks a project's identity from them when the project is added; a project that matches nothing uses the default identity. The first time a project has a remote whose owner matches a connected work account, Ramu offers to create the rule ("Projects from github.com/acme use Work?"). A project's menu and thread header show a small identity chip; choosing another identity there pins it for that project.

**Applied where Ramu acts.** For processes Ramu starts in a project (agents, terminals, actions and its own Git calls) the identity sets `GIT_AUTHOR_*` and `GIT_COMMITTER_*`, selects the provider login for new threads, and selects the forge and hosting accounts. The identity is looked up when the action runs, not stored on the thread, schedule or page, so pinning a project to another identity takes effect everywhere at once. Ramu does not edit the person's global Git config. A person who wants commits made outside Ramu to match gets **Write to this repository's Git config**, which sets `user.name` and `user.email` locally and says so.

**Mismatch guardrail.** Before a commit, push, pull request, merge, deploy or store release, Ramu compares the account it is about to use with the project's identity. If they differ (a thread whose login was changed by hand, an account removed, a repository moved to another owner), the approval card or button names both and offers **Use Work** or **Continue as Personal**. Agents see the same refusal through their tools and cannot pick another identity. A schedule run has nobody to ask, so a mismatch stops the run and puts it in the Inbox with both accounts named.

**No borrowing between identities.** Provider fallback and abilities pick only from the logins in the project's identity. A work thread at its limit moves to another Work login or stops with the existing message; it never moves to a personal subscription. A provider the identity has no login for offers **Connect ‹provider› for Work** instead of using another identity's.

**Everything in a project follows it.** Anything that runs inside a project uses that project's identity; anything outside a project uses the default identity:

- Threads, and the helpers and teammates they start.
- Schedules, at each run; a webhook made with **Create on…** uses the identity's forge account.
- Pull request lists, reviews, replies and merges, through the identity's forge account.
- Deploys, databases and store releases, through its hosting accounts.
- Artifact pages: a page's AI and runs use its project's identity; sharing and **Open to anyone** are host features and do not change.
- Terminals and actions, through the Git author environment and account selection.

Inbox, notifications and usage stay host-wide with the chip on each item; usage stays per login.

**Projects stay one list.** Projects belong to the host, and the identity is a property of each project: matched by a rule or pinned from its menu, stored on the host. The sidebar shows every project with its chip; nothing is hidden behind a switch, and moving a project to another identity changes only that field.

**One identity is no change.** With a single identity nothing new appears. **Settings → Identities** shows up once a second login, forge connection or hosting account exists, with **Add identity** prefilled from it.

**More than two works the same way.** Work and Personal are the case to design for; further identities are more entries in the same list, with no extra screens. Each has a name and a color for its chip. **Add identity** starts from the accounts not yet in one, and **Remove** asks which identity its projects move to. One identity is the default for projects no rule matches. When two rules match, the more specific one wins (a remote owner over a folder, a deeper folder over a shallower one), and the identity's rules list shows which projects each rule catches.

**Each host has its own.** Identities are host settings that reference that host's accounts, and a project's identity is resolved and applied on the host that holds it, memory scope included. A person who keeps work on one machine and personal projects on another needs no identities at all.

#### Memory: three levels

Memory today has project notes and global notes. Identities add one level between them, so company context stays with the company while preferences about the person follow them everywhere:

- **Project:** seen in that project only, as today.
- **Identity:** seen in every project under that identity. Facts about an employer or client (`reference` notes, company conventions) default here.
- **Everywhere:** today's global notes, seen under every identity. Preferences about the person (`user` and `feedback` notes) default here.

The identity level appears only once a second identity exists; until then memory works as it does today. A note's menu offers **Move to Everywhere**, **Move to ‹identity›** and **Move to this project**, as skills move between user and project scope. The agent is told the three levels and picks one when it saves; a note it saves in a project stays there unless it says otherwise.

### 2. Identities between hosts

**Each host has its own.** Identities are host settings that reference that host's accounts, and a project's identity is resolved and applied on the host that holds it, memory included. A person who keeps work on one machine and personal projects on another needs no identities at all.

**The receiving host decides.** A thread that arrives on another host, through **Continue on ‹host›**, an agent starting a thread there, or Home's **Auto** routing, runs under that host's identity for its project, with that host's accounts. Credentials never travel. When **Continue on ‹host›** clones the repository there, that host's rules pick the new project's identity, and the sheet shows it before cloning.

**Compared by Git author email.** Identity names belong to each host, so hosts are compared by the Git author email, which means the same everywhere and is set even on a host with only its default identity. The Continue sheet, the approval for an agent's start on another host and Home's routing show the target's chip, and when the emails differ they say so before anything crosses: "This thread is you@acme.com. On home-server it would run as you@gmail.com." with **Continue anyway** and **Cancel**. Agents get this as a refusal only the person can approve. **Bring back result** returns only a reply and needs no check.

**Memory does not cross.** A copied conversation is evidence for that thread only. Notes its agent saves go to the receiving host's memory under that host's identity.

### 3. Copy settings between hosts

Settings already edits several hosts at once (`SettingsScope` with `commonSettings` and `portableSettings` in `packages/shared/src/settingsCompatibility.ts`). Add **Copy settings from…** to a host's row in **Settings → Remote access** and to the first-run setup of a new host when another host is paired:

- Groups to bring over, all checked: appearance, models and abilities, agent defaults, Git and commit style, notifications, rules, identities (their match rules and Git author; account references only where the same login, by sign-in email, is connected on this host, otherwise listed as **Connect on this host**). Identities start unchecked when the source host has only its default identity, so a work machine's Git author does not reach a personal one unasked. One more group, unchecked by default, copies **Everywhere** `user` and `feedback` notes; identity and project notes never move.
- A review list of every value that would change, then **Copy**. The copy is one batch through `applySettingEdits`, so a setting changed elsewhere stops it with the existing message.
- Only portable fields move. Executable paths, credentials, account tokens, workspace state and device permissions never do.

**Export settings** and **Import settings** beside it write and read the same portable groups as a JSON file, for a new machine with no paired host. Import shows the same review list.

### 4. Backups

Encrypted backups to a Ramu account or to your own GitHub are planned in [Ramu account and encrypted settings backup](ramu-account.md); they carry the same portable export.

## Existing services to extend

- Provider logins and per-thread login choice: `apps/server/src/providers` and **Settings → Providers**.
- Forge connections, per-origin selection and per-repository overrides: `apps/server/src/workspace/forgeAccounts.ts`.
- Hosting accounts: `apps/server/src/workspace/deploy/accounts.ts`.
- Memory scopes and Shared MCP and skill **Applies to** exceptions: `apps/server/src/memory`, `apps/server/src/mcp`.
- Provider fallback and abilities: `apps/server/src/agent/fallbackRouter.ts`, `apps/server/src/agent/abilities.ts`.
- Schedules, webhooks and pull request watches: `apps/server/src/background/schedules.ts`, `webhookSetup.ts`, `pullRequestWatches.ts`.
- Browser profiles: `apps/server/src/browser/browserProfiles.ts`.
- Threads on other hosts and **Continue on ‹host›**: `apps/server/src/remote/agentHosts.ts`, `apps/server/src/background/remoteThreads.ts`.
- Host settings and their cross-host scope: `apps/server/src/settings/settingsStore.ts`, `apps/server/src/sharedSettings.ts`, `apps/web/src/settings/SettingsScope.tsx`.
- Project configuration: `apps/server/src/workspace/projectConfig.ts`; `ramu.json` never names an identity, since accounts are personal.

## Acceptance

- Representative task: a person with a work and a personal Claude login, a company GitHub organization and their own account adds `~/work/api` and `~/code/blog`. Without choosing anything, a thread in each uses the right login, commits with the right email, opens pull requests and deploys with the right account. Before, they had to switch the login per thread, set Git config per repository and check the forge selection.
- A thread in a work project with its login changed by hand to the personal one is stopped at its next push with both accounts named; **Use Work** pushes as Work.
- A company note saved at the Work level is not recalled in a personal project; a preference saved **Everywhere** ("prefer pnpm") is recalled in both.
- A work thread at its Claude limit never moves to the personal Claude or Codex login; with no other Work login it stops and offers **Connect Codex for Work**.
- A scheduled run in a work project whose forge account was removed stops before pushing and appears in the Inbox naming both accounts.
- An agent browsing in a work project opens Work's browser profile.
- With a work laptop and a personal home server and no identities set up, **Continue on home-server** for a work thread warns with both Git emails before copying; continuing between two hosts with the same email shows nothing new.
- Removing an identity moves its projects to the identity chosen in **Remove**, and they act with its accounts from the next thread.
- On a second Mac paired with the first, **Copy settings from…** brings over appearance, models and identities with one review, and lists the logins still to connect there; no credential appears on the second host.
- An exported file contains no paths, tokens or account secrets, and importing it on a fresh host gives the same review.
- Server tests for identity matching, environment applied to started processes, the guardrail on each action and on schedule runs, fallback limited to the identity's logins, the three memory levels, the cross-host email check and the portable export; web tests for the chip, the mismatch card, the Continue warning and the copy review; strings translated to Indonesian.

## Later options

- Identities on the phone beyond the read-only chip, once people ask to change them away from the desktop.
- Filtering or grouping the sidebar by identity, once people with many projects ask for it.
- Keeping the same identities in step on several hosts (a stable id across hosts, editing them with **Apply settings to**), once people who mix accounts on several machines ask for it.
