# Identities and moving settings

## The need

People who use Ramu for paid work and for their own projects keep two sets of accounts on one computer: a work Claude or Codex login and a personal one, a company GitHub or Enterprise account and their own, a client's Vercel team and their hobby account. Today each of these is chosen in a different place (the first enabled provider login, the selected forge connection per origin with per-repository overrides, the connected hosting account), and the commit email comes from whatever Git config the host has. Ramu leaves the person to keep all of that matched by hand. Getting it wrong is costly and hard to undo: work code committed with a personal email, a personal subscription spending its limit on company code, a deploy to the wrong team, or company notes in memory reaching a personal project.

The same people set Ramu up on more than one machine. A second host starts from defaults, and they redo theme, models, abilities, commit style and notification choices from memory.

Account sign-in (Google or GitHub with a Ramu backend) solves neither: it needs a hosted service, which Ramu does not run, and credentials and workspace state must never leave the host anyway. Profiles switched by hand would copy every setting and add one more thing to remember. This plan does both jobs without a Ramu account and without a switcher.

## Delivery

### 1. Identities that follow the project

An **identity** names the accounts that belong together, and nothing else:

- Git author name and email, and optionally a signing key reference.
- One login per provider (references to the logins in **Settings → Providers**).
- A Git hosting connection per origin (GitHub, GitHub Enterprise, GitLab, Bitbucket, Azure DevOps).
- Hosting accounts for deploys, databases and store releases.
- A memory scope: notes saved under one identity are not recalled in projects under another. Shared MCP servers and skills can be limited to an identity the same way.

Theme, layout, keybindings, models, abilities and every other setting stay host-wide. An identity holds only references to accounts already connected on the host; no credential is copied or moved.

**Inferred, not switched.** Each identity has match rules: folders (`~/work/**`), and repository remotes by origin and owner (`github.com/acme/*`). Ramu picks a project's identity from them when the project is added; a project that matches nothing uses the default identity. The first time a project has a remote whose owner matches a connected work account, Ramu offers to create the rule ("Projects from github.com/acme use Work?"). A project's menu and thread header show a small identity chip; choosing another identity there pins it for that project.

**Applied where Ramu acts.** For processes Ramu starts in a project (agents, terminals, actions and its own Git calls) the identity sets `GIT_AUTHOR_*` and `GIT_COMMITTER_*`, selects the provider login for new threads, and selects the forge and hosting accounts. Ramu does not edit the person's global Git config. A person who wants commits made outside Ramu to match gets **Write to this repository's Git config**, which sets `user.name` and `user.email` locally and says so.

**Mismatch guardrail.** Before a commit, push, pull request, merge, deploy or store release, Ramu compares the account it is about to use with the project's identity. If they differ (a thread whose login was changed by hand, an account removed, a repository moved to another owner), the approval card or button names both and offers **Use Work** or **Continue as Personal**. Agents see the same refusal through their tools and cannot pick another identity.

**One identity is no change.** With a single identity nothing new appears. **Settings → Identities** shows up once a second login, forge connection or hosting account exists, with **Add identity** prefilled from it.

### 2. Copy settings between hosts

Settings already edits several hosts at once (`SettingsScope` with `commonSettings` and `portableSettings` in `packages/shared/src/settingsCompatibility.ts`). Add **Copy settings from…** to a host's row in **Settings → Remote access** and to the first-run setup of a new host when another host is paired:

- Groups to bring over, all checked: appearance, models and abilities, agent defaults, Git and commit style, notifications, rules, identities (their match rules and Git author; account references only where the same login, by sign-in email, is connected on this host, otherwise listed as **Connect on this host**).
- A review list of every value that would change, then **Copy**. The copy is one batch through `applySettingEdits`, so a setting changed elsewhere stops it with the existing message.
- Only portable fields move. Executable paths, credentials, account tokens, workspace state and device permissions never do.

**Export settings** and **Import settings** beside it write and read the same portable groups as a JSON file, for a new machine with no paired host. Import shows the same review list.

### 3. Back up settings to your own GitHub

Optional, off until chosen: **Back up to GitHub** in **Settings → Remote access** saves the export file to a private gist (or a `ramu-settings` repository) in an account the host is already signed in to with `gh` or a saved token. Each change to a portable setting updates it after a short delay, so history shows what changed and when. **Restore from GitHub** on another host lists the backups that account holds and opens the import review. Ramu stores nothing itself.

## Existing services to extend

- Provider logins and per-thread login choice: `apps/server/src/providers` and **Settings → Providers**.
- Forge connections, per-origin selection and per-repository overrides: `apps/server/src/workspace/forgeAccounts.ts`.
- Hosting accounts: `apps/server/src/workspace/deploy/accounts.ts`.
- Memory scopes and Shared MCP and skill **Applies to** exceptions: `apps/server/src/memory`, `apps/server/src/mcp`.
- Host settings and their cross-host scope: `apps/server/src/settings/settingsStore.ts`, `apps/server/src/sharedSettings.ts`, `apps/web/src/settings/SettingsScope.tsx`.
- Project configuration: `apps/server/src/workspace/projectConfig.ts`; `ramu.json` never names an identity, since accounts are personal.

## Acceptance

- Representative task: a person with a work and a personal Claude login, a company GitHub organization and their own account adds `~/work/api` and `~/code/blog`. Without choosing anything, a thread in each uses the right login, commits with the right email, opens pull requests and deploys with the right account. Before, they had to switch the login per thread, set Git config per repository and check the forge selection.
- A thread in a work project with its login changed by hand to the personal one is stopped at its next push with both accounts named; **Use Work** pushes as Work.
- A memory note saved in a work project is not recalled in a personal one.
- On a second Mac paired with the first, **Copy settings from…** brings over appearance, models and identities with one review, and lists the logins still to connect there; no credential appears on the second host.
- An exported file contains no paths, tokens or account secrets, and importing it on a fresh host gives the same review.
- A GitHub backup restores on a third host signed in to the same account.
- Server tests for identity matching, environment applied to started processes, the guardrail on each action, memory scoping and the portable export; web tests for the chip, the mismatch card and the copy review; strings translated to Indonesian.

## Later options

- **Sign-in with a Ramu account** (Google or GitHub with a Ramu service) for sync without a paired host or a GitHub account: only if a hosted service becomes fundable. It still would not carry credentials.
- Identities on the phone beyond the read-only chip, once people ask to change them away from the desktop.
