# GitHub, GitLab, Bitbucket and Azure DevOps

## GitHub

Ramu uses the [GitHub CLI](https://cli.github.com) sign-ins you already have (`gh auth login`), or a token saved in **Settings → Git → Hosting accounts**, where **Create token on GitHub** opens GitHub's fine-grained token form named Ramu, expiring in 90 days, with the permissions Ramu uses already chosen (contents, pull requests, issues, checks, Actions, secrets, workflows and Pages). You pick the repositories. Saved tokens stay in the host's OS credential store and go only to their own server.

- **Start a thread from an issue:** pick an issue on the new-thread screen (on the phone, **Start from an issue** above the box, once a project with issues is chosen). Its text becomes the first message, and a pull request from that checkout closes it.
- **Commit on the default branch:** **Commit & Push** or **Commit & Sync** on the repository's default branch asks first, on the desktop and the phone (also the phone's one-tap **Commit & push**): **Create feature branch** names a branch from the changes and moves you onto it, or continue on the default branch. Settings → Git → **Commit from default branch** picks which comes first.
- **Open a pull request:** **Create pull request** in Source Control, on the desktop or the phone, drafts the title and description from the branch's commits.
- **Follow it:** Source Control shows the branch's pull request with its checks, draft state and review decision. **Fix failing checks** and **Address review comments** send the details to a thread, which commits fixes but never pushes.
- **Watch in a thread:** a thread can watch a pull request while Ramu runs in the background. New failing checks and new review comments return to it as one round, but only comments from people with write access, requested reviewers, the author and bots. Comments from anyone else show as **From outside the project** and never wake the agent. **Automatically watch pull requests** (Settings → Git) does this for pull requests you create.

### Keeping pull requests current

Ramu reads a branch's pull request straight from GitHub with your `gh` sign-in, and every view on a host shares one read for a few seconds, so an unchanged pull request costs no rate limit. It reads it again when the agent pushes or runs a `gh pr` command, after a push or a pull request action in Ramu, when you come back to the window or the app, and every 30 seconds while an open one is on screen. Merged and closed pull requests are not checked again on their own.

**Live pull request updates** (Settings → Git) makes the rest instant: GitHub tells the computer the moment a review, a check or a merge happens, desktops and phones show it at once, and a watching thread hears of a finished check without waiting for the next check. Each repository uses the best source it can have:

- **The Ramu GitHub App** ([Ramu by Akalstack](https://github.com/apps/ramu-by-akalstack) on GitHub), installed on the repository or its organization. Its events reach the computer through Ramu Link, so it needs no admin rights on the repository and no public address, only a signed-in Ramu account. Ramu Link passes on only which repository changed (with the pull request number and commit), never titles or comments, and only to computers whose GitHub account can read that repository.
- **A webhook** Ramu adds to the repository where the App is not installed. It needs admin rights there (GitHub lets only admins add webhooks) and a public address for the computer, from **Anywhere** under **Reachable from** in **Devices & access** (Ramu Link or another tunnel). Once the App covers a repository, Ramu removes its webhook again.

Settings lists each repository with where its updates come from, or what is missing, and offers installing the App for the rest. Turning the setting off removes Ramu's webhooks. Without either source, the regular checks above keep pull requests current.

### The Pull requests page

**Pull requests**, on the rail along the sidebar's left edge and in the phone's tabs, lists the pull requests of every project's repositories in one place. On the desktop it covers the hosts the sidebar's host filter shows (as Threads, Inbox and Schedules do), and on the phone every paired host. A pull request whose repository several hosts have is listed once and opens where a thread already works on it, otherwise on the host on screen. With several hosts, each row names its host, and the **On …** picker moves the open pull request to another connected host with a checkout. The list and the pull requests you opened reopen on what this device last showed, after a restart too, and refresh from the host at once. A host that is offline says so above the list.

Its tabs are **Needs you** (reviews asked of you, and your own pull requests that are ready to merge, have replies drafted, or are blocked on conflicts, failing checks or requested changes), **Yours**, **To review**, **All open** and **Closed** (merged and closed). The sidebar and the phone's tab show how many need you. Each row has its state icon (open, draft, merged, closed), project and repository, lines added and removed, labels (on GitHub), checks, stage, open review threads, author and the thread working on it. Search matches number, title, author, branch, project and repository, a repository picker narrows the list, and **Sort** orders it by **Recently updated** or **Closest to merging**. The up and down arrow keys move through the list.

Open pull requests on GitHub that involve you in repositories no project holds (yours, or a review asked of you) are listed too. They open in full on the desktop and the phone, read and acted on as the GitHub account that found them: review, comment, update the branch, merge, close and reopen work, while threads and agent reviews wait until **Clone … as a project** adds the repository. On the phone, **Open on GitHub** is in a row's long-press menu.

Repositories that need a sign-in are named at the top of the list, one line per host and service (such as "Bitbucket is not connected" with the repositories it affects). The line opens to the fix and an access check per repository, and can be hidden on this device. Hidden ones fold into one line that shows them again.

Choosing a pull request opens it in full beside the list on the desktop, in two tabs as on the services:

- **Overview** leads with where it stands (checks, reviews, conflicts and unresolved conversations) and the one thing to do next (such as **Merge…**, **Fix failing checks** or **Review with agent**). Then come its description, a timeline of commits, reviews, comments and state changes, and its review threads with filters and an order.
- **Files changed** shows each file's diff with line numbers and the review comments on its lines. Hover a line of the new version and choose **+** to comment on it. Comments wait as pending until **Finish review** submits them as a comment, an approval or a request for changes (only a comment on your own pull request).

The phone has the same two tabs, the Overview's summary, next step, filters and order included. Tap a line to comment on it, or long-press the first line and tap the last for a block of lines. Tap a pending comment to edit or remove it. Files changed draws each diff like a thread's changes, with syntax colours, expands or collapses every file and wraps long lines (remembered on the phone). A change past 25 files or 2,500 lines shows one file at a time, with **Jump to file** to pick one, and **Show all files** lists them all folded. Links in a description or comment open in the app where they can: this pull request's files, another listed pull request, or a file or folder of the repository's checkout. Descriptions and comments render as on the service, with their Markdown, the HTML GitHub allows, folded `<details>` and suggested changes. Your own comments can be edited and deleted where the service allows it.

GitLab, Bitbucket and Azure DevOps list changed files with their diffs and line counts too. Azure DevOps returns no diff text, so Ramu reads each file at the merge base and the latest push and diffs them on the host, leaving a binary file or one over 1 MB without a patch. Every service has the timeline, from its own history: GitLab's notes, Bitbucket's activity and Azure DevOps's threads (votes, reviewers, pushes and status). Force-pushes show on GitHub only, and marking a draft ready on GitHub and GitLab only.

On the desktop, clicking a pull request link anywhere in Ramu (a thread's reply, a card, a description) opens it on this page when the host lists that pull request, open or closed. A pull request Ramu doesn't list opens as any other link does. **Settings → Browser → Pull request links** switches this device to **On the service**, which always opens GitHub, GitLab, Bitbucket or Azure DevOps. Either way, right-clicking the link offers the other one: **Open pull request in Ramu** or **Open in system browser**.

A thread's Source Control shows the checked-out branch's pull request, and **All pull requests in …** opens this page narrowed to that repository. A platform connected to the repository, such as Vercel or Netlify ([Deploying an app](deploy.md)), reports its preview deployment as one of the pull request's checks.

Each pull request has one stage, shown in the same words on rows, in the thread list, in Inbox and on the phone: **Replies ready**, **Agent working**, **Has conflicts**, **Checks failing**, **Changes requested**, **Draft**, **Checks running**, **Waiting on review**, **Ready to merge**, **Merged** or **Closed**. Thread rows show the pull request icon with a dot when it needs attention. Inbox's Brief lists the pull requests whose next step is yours: replies to send, ready to merge, or conflicts. A pull request that waits on people says on whom and for what in place of **Waiting on review** or **Changes requested**, in a thread's pull request line, tooltip and hover card and on its card in Source Control, and beside the stage on the Pull requests page and in a pull request's header, on the desktop and the phone: "needs 1 more approval from @payments-team", "needs a code owner's approval", "changes requested by @bo" or "2 conversations to resolve". Ramu reads this from the service's own rules and keeps none of its own: GitHub's rulesets for the branch (a repository on classic branch protection, or an account that cannot read its rules, names who was asked instead of a count), GitLab's approval rules and merge status, Azure DevOps's required reviewers, and on Bitbucket the reviewers who have not approved.

Opening a pull request shows it in full, with these actions:

- **Open thread** goes to the thread already working on it. **Open in thread** makes a worktree on its branch and starts a thread that catches up on it: what it does, what is left, and the next step.
- **Review with agent** (someone else's pull request) checks it out in a worktree and asks an agent to review it without changing files. Its drafted review (verdict, summary and line comments) waits for you to edit and **Post review**. Pull requests from forks can be reviewed on GitHub and GitLab, but not pushed to.
- **Ready for review**, **Close** and **Reopen**. Bitbucket cannot reopen a declined pull request.
- **Update branch** (when it is behind) merges its base in. GitHub and GitLab do it themselves. For Bitbucket and Azure DevOps, and for any pull request with conflicts (**Resolve conflicts**), Ramu merges the base into the branch in the thread working on it: a clean merge is pushed, and conflicts stay there for [Conflicts](#conflicts).
- **Merge…** offers the methods the repository allows, the last one you used first, and says what still blocks the merge before it can run. It can delete the branch and mark the thread done. **Merge automatically once required checks pass** sets it to merge itself later (GitHub, GitLab and Azure DevOps).
- **Comments** lists the comments on the pull request itself and has a box to add one. Your own comments can be edited and deleted, and any comment can get a reaction the service offers.
- **Reply** under each review thread, in the Overview's threads and under its line in Files changed, on the desktop and the phone; a reply posts at once, outside any pending review, and **Reply and resolve** closes the thread with it. **Resolve** and **Reopen** sit beside **Reply** on each thread you can resolve.
- **More actions** (desktop) and the buttons below the summary (phone): **Reviewers…**, **Labels…** and **Assignees…** as one list each, **Re-run failed checks** when checks fail, and **Back to draft**. Only what the service has is shown; see [What each service can do](#what-each-service-can-do).

### Review replies

When a thread addresses review comments, the agent records an outcome for each thread: **Fixed** (with the commit), **No change** (why the code stays), **Question** (one specific question for the reviewer) or **Skip**. The pull request's **Review replies** card shows each comment beside its draft. Edit any reply or outcome, then **Push and reply**: it pushes first, posts the replies (a Fixed reply names its commit), and asks the reviewers to review again. **Resolve fixed threads** is off by default. If the push fails, nothing is posted. A reply that fails stays in the card with its error, and a reply that already reached the thread is never posted twice. The reviewer's answer comes back to the same thread as the next round.

### Shipping a change

Ask a thread's agent to ship ("ship it", "get this to review", "put it live") and it carries the change to the project's finish line without you pressing each step. It works on a branch, reviews its own diff, pushes and opens the pull request, and Ramu watches it: failing checks come back to the agent, which fixes and pushes them, and review comments come back as rounds, once the reviewer has left no new comment for five minutes, so the agent answers the whole review at once. Ramu tells the agent when the pull request is approved, merged or at the finish line, and the agent says so in one line.

Choose the finish line under **Ship** in the project's **Live app…** sheet, on the desktop or the phone:

- **Pull request:** stops once the pull request is open, out of draft, and its checks pass.
- **Ready for review:** handles fix and reply rounds until the pull request is approved, and never merges.
- **Merged:** asks you to merge once it is approved and its checks pass.
- **Preview deploy:** after the merge, deploys a preview or staging build and checks it.
- **Live in production:** after the merge, deploys to production and checks the live address.

**Suggested** picks one for you: **Ready for review** for a repository that belongs to an organization or someone else, **Live in production** for your own with a live address (**Merged** without one), and **Pull request** without a Git host. An agent can ask for an earlier finish line, never a later one.

Under the finish line, the sheet shows what Ship may do without stopping for you, for the steps that finish line reaches:

- **Send replies that report a fix** (on): after a review round, Ramu pushes the branch and posts the replies that only say what was fixed, and asks the reviewers again once nothing is left to send. A reply that disagrees with the reviewer or asks a question still waits for you in the **Review replies** card.
- **Merge when approved** (off): the agent turns on the Git host's own auto-merge, so the pull request merges when its checks pass and branch protection allows. A plain merge still asks you.
- **Deploy to production without asking again** (on): a project's first production deploy asks. After you allow it, later ones from a thread shipping to **Live in production** run on their own, migrations first, and check the live address.

While a shipped pull request waits on reviewers, the thread does nothing and spends no turns; a review, an approval or new comments wake it. Two things happen once per wait:

- **Nobody was asked:** the agent finds who should review, from `CODEOWNERS` or the people who last changed those files, and asks up to three of them in one request that waits for you in its card.
- **Still waiting after a working day** (weekends don't count): Ramu drafts a short reminder to the people asked. It waits in the thread's card for you to post or dismiss, in every access mode, and is never sent for you.

A choice the repository's `ramu.json` keeps with a person is off and says so. Approving always asks you, as it does anywhere else. Ship runs up to 3 rounds of fixing checks and 5 review rounds by default; when one runs out, the agent asks whether to run more rounds or stop, and the question waits in Inbox's Brief. **Fix failing checks** and **Address review comments** still work by hand and don't count as rounds.

Prepared work waits in Inbox's Brief with the answer first, such as "#42 · 3 replies drafted" or "Review drafted", and **Review and send** opens the pull request where you check and send it. Each check fix Ship pushed and each set of replies it posted without asking is listed under **Done for you** in Inbox's **Done**, with **Undo** (a revert commit for a fix, deleting the replies for replies) ([Learned and Done](inbox.md#learned-and-done)).

A team sets the limit in `ramu.json` on the default branch ([Repository settings](configuration.md#repository-settings)). Ramu reads it from the Git host's copy of that branch, not from the thread's checkout, so an agent can't raise its own limit.

### Agents and pull requests

Ask in a thread ("approve #42 and say thanks", "reply to Ana that it's fixed and resolve her thread", "comment with the test results", "ask Bob to look again", "merge it when checks pass") and the agent uses Ramu's pull request tools, the same on all four services: it reads with `pull_request_list`, `pull_request_view` and `pull_request_threads`, and writes with `pull_request_comment`, `_reply`, `_line_comment` (with a suggested change), `_review`, `_resolve`, `_edit_comment`, `_delete_comment`, `_react`, `_reviewers`, `_withdraw_review`, `_update`, `_merge`, `_state` and `_rerun_checks`. Everything it writes is public and in your name, so:

- **A card shows exactly what goes out:** each write appears in a card in the thread with the text as the service will render it, the file and line, and the account it posts as. Writes from one turn share one card with **Post all**; each has **Post**, **Edit** (for text) and **Dismiss**. A write that fails stays in the card with its error, and one that reached the service is never posted twice.
- **Full access posts conversation writes at once:** comments, replies, line comments, resolving, reactions, reviewers, edits and labels go out when the agent asks, and the card shows them with **Undo** where the service can take them back (deleting the comment, reopening the thread, removing the reaction or reviewer). In the other modes they wait for **Post**.
- **Decisions always wait for you,** in every mode: approving, requesting changes, withdrawing a review, merging (and merging automatically), closing, deleting a branch and changing the base branch.
- **The identity check runs before every post:** when the repository's account belongs to another [identity](identities.md), the card posts nothing until you choose.
- **No posting from the shell:** `gh pr comment`, `gh pr review`, `gh pr merge` and the other `gh pr` and `glab mr` writes stop for your approval even in Full access, naming the tool to use instead.

A service that cannot do something says so in words the agent repeats, such as "Bitbucket has no labels.", and nothing is posted. From a paired phone, the card's buttons follow the device's own access, as the Pull requests page does.

### What each service can do

| Action | GitHub | GitLab | Bitbucket Cloud | Azure DevOps |
| --- | --- | --- | --- | --- |
| Comment, reply, line comment | ✓ | ✓ | ✓ | ✓ |
| Suggested change | ✓ | ✓ | – | ✓ |
| Approve | ✓ | ✓ | ✓ | ✓ |
| Request changes | ✓ | – | ✓ | ✓ |
| Withdraw your own review | ✓ (dismisses it; needs write access) | ✓ | ✓ | ✓ |
| Resolve and reopen threads | ✓ | ✓ | ✓ | ✓, with won't fix, by design and closed |
| Edit and delete your comments | ✓ | ✓ | ✓ | ✓ |
| Reactions | ✓ | ✓ | – | likes only |
| Reviewers | ✓ | ✓ | ✓ | ✓ |
| Labels | ✓ | ✓ | – | ✓ (tags) |
| Assignees | ✓ | ✓ | – | – |
| Draft and ready | ✓ | ✓ | ✓ | ✓ |
| Merge when checks pass | ✓ (if the repository allows it) | ✓ | – | ✓ (auto-complete) |
| Re-run failed checks | ✓ (GitHub Actions) | ✓ (retries the pipeline) | ✓ (starts a new pipeline) | ✓ (re-queues build policies) |

- **Your name on the work:** **Remove agent credits** (Settings → Git, on by default) keeps agents' `Co-authored-by` trailers and "Generated with" lines out of commits and pull requests. Claude Code's attribution is switched off, every other agent is asked to leave them out, and Ramu removes any that remain in the commits and pull requests it makes. Trailers for people and anything inside code blocks stay.

## GitLab

Repositories on gitlab.com, or a server your `glab` is signed in to, get merge requests, pipeline jobs, approvals and issues the same way. **Settings → Git** shows who each sign-in is and can start `glab auth login` for you. Without `glab`, **Connect** saves a personal access token (`api` scope) for one server in the host's OS credential store, after checking it. **Create token on GitLab** opens GitLab's form. Ramu uses a saved token for that server before a `glab` sign-in. `GITLAB_TOKEN` on the host works too.

## Bitbucket Cloud

Bitbucket has no official CLI. Connect it in **Settings → Git** with an Atlassian API token that has Bitbucket scopes and your account email, or with a workspace or repository access token (leave the email empty). Ramu checks the credential before saving it in the host's OS credential store, and agents never see it. `BITBUCKET_EMAIL` with `BITBUCKET_API_TOKEN`, or `BITBUCKET_ACCESS_TOKEN`, on the host works too. Pull requests, the pull request list (with build statuses and open comments for the newest 20), merging, reviewers, review replies and issues work as on GitHub; **Fix failing checks** includes the end of each failed Bitbucket Pipelines step's log. Git itself still pushes with the host's own Git credentials.

## Azure DevOps

Azure Repos remotes (`dev.azure.com`, `*.visualstudio.com` and their SSH forms) connect in **Settings → Git** with a personal access token and its organization. Give the token Code (read and write), Build (read) and Work Items (read). Ramu checks it before saving it in the host's OS credential store, and sends it only to dev.azure.com. `AZURE_DEVOPS_EXT_PAT` on the host (the Azure CLI's) works too.

- **Pull requests:** create them, and follow votes, required reviewers, statuses and build validation policies in Source Control.
- **Fix failing checks** includes the end of each failed pipeline step's log; **Address review comments** sends the active threads.
- **Work items** from Azure Boards stand in for issues on the new-thread screen.

## Set up CI

**Set up CI…** in a project's menu, or **Set up CI** under **Checks** in its **Live app…** sheet, adds a CI workflow to a GitHub or GitLab repository: `.github/workflows/ci.yml` (GitHub Actions) or `.gitlab-ci.yml` (GitLab CI). The sheet first says what it will do, read from the default branch:

- **Install** with the package manager the lockfile names (npm, pnpm, Yarn, Bun, uv, pip, Bundler or Go modules), cached between runs.
- **Then** the lint, typecheck, test and build steps the project has: its `package.json` scripts, the Python tools it declares (Ruff, mypy, pytest, or Django's tests), RuboCop and Rails or RSpec tests, or `go vet`, `go test` and `go build`. The build and test commands in `ramu.json` ([Configuration](configuration.md)) take the place of the detected ones.
- **When:** on every pull request and on pushes to the default branch. GitHub actions are pinned to a major version, and the job can only read the repository.

The file arrives as a pull request from a new `ramu/set-up-ci` branch, made from the default branch on the server, so your checkout, branch and uncommitted work stay as they are. CI runs on that pull request, so you see it pass before merging. A default branch that already has the file is left alone. Pushing a workflow file to GitHub needs the `workflow` permission on the host's Git sign-in; when it is missing, Ramu says how to add it.

**Require CI to pass before merging** makes the CI check required on the default branch through the repository's GitHub account, once the pull request is open; on GitLab it turns on the project's **Pipelines must succeed** merge setting and changes nothing else. It is checked by default for repositories Ramu published and unchecked for others. Existing rules are kept: a branch with required checks gets CI added, and a branch protected without required checks is left alone with a note. Changing protection needs admin access (Maintainer on GitLab), and GitHub allows it on private repositories only on paid plans; when GitHub refuses, the sheet says why and the pull request stays open. Agents cannot change branch protection.

**Keeping the default branch green:** after a thread pushes, or merges a pull request into the default branch, Ramu follows CI on that commit and wakes the thread with the failing jobs and their logs, asking for a fix on a new branch ([After a push](deploy.md#after-a-push)). A sync that only pulls follows nothing. This works on GitHub and GitLab.

A step that needs a secret reads it from the repository's GitHub Actions secrets, which you add on GitHub.

Agents use `ci_setup`: it writes the same file into the thread's checkout (or returns the one already there) for the agent to adjust (monorepo filters, a database service for tests) before it commits on a branch and opens a pull request.

## Conflicts

When a merge, rebase or pull stops on conflicts, Source Control lists the files under **Merge changes**. Opening one shows each conflict as an editor would: **Current** (the branch you are on), **Incoming** (what is being merged in) and the common ancestor when Git recorded it, with a few lines above for context.

- **Accept current**, **Accept incoming** or **Accept both** on one conflict, on the whole file, or on every conflicted file at once (after a confirmation). Changes Git merged cleanly stay as they are.
- A file with no markers (binary, or deleted on one side) takes one side as a whole.
- **Resolve with AI** hands every conflicted file, or only the one you choose, to an agent thread that edits and stages them without committing.
- **Edit in the editor** for anything else, then mark the file resolved.

A file is staged once none of its conflicts are left, and the view moves on to the next conflicted file. Continue or abort the merge or rebase from Source Control.

## Branches and worktrees

**Settings → Git → New threads & worktrees** sets whether new threads use the current checkout or a new worktree, and how branches are named: a fixed prefix (`ramu/<title>`), a short name from your first message, or your own instructions.
