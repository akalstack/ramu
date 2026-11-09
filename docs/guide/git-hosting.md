# GitHub, GitLab, Bitbucket and Azure DevOps

## GitHub

Ramu uses the [GitHub CLI](https://cli.github.com) sign-ins you already have (`gh auth login`), or a token saved in **Settings → Git → Hosting accounts**, where **Create a fine-grained token on GitHub** opens GitHub's form named Ramu, expiring in 90 days, with the permissions Ramu uses already chosen (pull requests, issues, checks, Actions, secrets, workflows and Pages); you pick the repositories. Saved tokens stay in the host's OS credential store and go only to their own server.

- **Start a thread from an issue:** pick an issue on the new-thread screen (on the phone, **Start from an issue** above the box, once a project with issues is chosen). Its text becomes the first message, and a pull request from that checkout closes it.
- **Open a pull request:** **Create pull request** in Source Control, on the desktop or the phone, drafts the title and description from the branch's commits.
- **Follow it:** Source Control shows the branch's pull request with its checks, draft state and review decision. **Fix failing checks** and **Address review comments** send the details to a thread, which commits fixes but never pushes.
- **Watch in a thread:** a thread can watch a pull request while Ramu runs in the background. New failing checks and new review comments return to it as one round, but only comments from people with write access, requested reviewers, the author and bots. Comments from anyone else show as **From outside the project** and never wake the agent. **Automatically watch pull requests** (Settings → Git) does this for pull requests you create.

### The Pull requests page

**Pull requests**, on the rail along the sidebar's left edge and in the phone's tabs, lists the pull requests of every project's repositories in one place, on every paired host on the phone. Its tabs are **Needs you** (reviews asked of you, and your own pull requests that are ready to merge, have replies drafted, or are blocked on conflicts, failing checks or requested changes), **Yours**, **To review**, **All open** and **Closed** (merged and closed); the sidebar and the phone's tab show how many need you. Each row has its state icon (open, draft, merged, closed), project and repository, lines added and removed and labels (on GitHub), checks, stage, open review threads, author and the thread working on it. Open pull requests on GitHub that involve you in repositories no project holds (yours, or a review asked of you) are listed too, and open on GitHub. The search matches number, title, author, branch, project and repository, a repository picker narrows the list, and **Sort** orders it by **Recently updated** or **Closest to merging**. A repository that needs a sign-in says so at the top of the list, with the fix. Choosing a pull request opens it in full beside the list on the desktop, in two tabs as on the services: **Conversation** (its description, a timeline of commits, reviews, comments and state changes, and its review threads) and **Files changed** (each file's diff with line numbers and the review comments on its lines). Hover a line of the new version and choose **+** to comment on it; comments wait as pending until **Finish review** submits them as a comment, an approval or a request for changes (only a comment on your own pull request). The phone has the same two tabs, with each file's diff and its comments. GitLab and Bitbucket list changed files with their diffs too, and Azure DevOps lists them without diffs. Every service has the timeline, from its own history: GitLab's notes, Bitbucket's activity and Azure DevOps's threads (votes, reviewers, pushes and status). Force-pushes show on GitHub only, and marking a draft ready on GitHub and GitLab.

A thread's Source Control shows the checked-out branch's pull request, and **All pull requests in …** opens this page narrowed to that repository.

Each pull request has one stage, shown in the same words on rows, in the thread list, in Inbox and on the phone: **Replies ready**, **Agent working**, **Has conflicts**, **Checks failing**, **Changes requested**, **Draft**, **Checks running**, **Waiting on review**, **Ready to merge**, **Merged** or **Closed**. Thread rows show the pull request icon with a dot when it needs attention. Inbox's Brief lists the pull requests whose next step is yours: replies to send, ready to merge, or conflicts.

When the project is linked to Vercel or Netlify ([Deploying an app](deploy.md)), the card of the checked-out branch's pull request, in Source Control and on the phone, shows its preview deployment: **Preview at …** opens it once it is ready, and **Preview building…** or **Preview failed** show before that.

Opening a pull request shows it in full, with these actions:

- **Open thread** goes to the thread already working on it. **Open in thread** makes a worktree on its branch and starts a thread that catches up on it: what it does, what is left, and the next step.
- **Review with agent** (someone else's pull request) checks it out in a worktree and asks an agent to review it without changing files. Its drafted review (verdict, summary and line comments) waits for you to edit and **Post review**. Pull requests from forks can be reviewed on GitHub and GitLab, but not pushed to.
- **Ready for review**, **Close** and **Reopen**. Bitbucket cannot reopen a declined pull request.
- **Update branch** (when it is behind) merges its base in. GitHub and GitLab do it themselves. For Bitbucket and Azure DevOps, and for any pull request with conflicts (**Resolve conflicts**), Ramu merges the base into the branch in the thread working on it: a clean merge is pushed, and conflicts stay there for [Conflicts](#conflicts).
- **Merge…** offers the methods the repository allows, the last one you used first, and says what still blocks the merge before it can run. It can delete the branch and mark the thread done.

### Review replies

When a thread addresses review comments, the agent records an outcome for each thread: **Fixed** (with the commit), **No change** (why the code stays), **Question** (one specific question for the reviewer) or **Skip**. The pull request's **Review replies** card shows each comment beside its draft. Edit any reply or outcome, then **Push and reply**: it pushes first, posts the replies (a Fixed reply names its commit), and asks the reviewers to review again. **Resolve fixed threads** is off by default. If the push fails, nothing is posted. A reply that fails stays in the card with its error, and a reply that already reached the thread is never posted twice. The reviewer's answer comes back to the same thread as the next round.

Agents never push, post or merge on their own. Only these person actions do.

- **Your name on the work:** **Remove agent credits** (Settings → Git, on by default) keeps agents' `Co-authored-by` trailers and "Generated with" lines out of commits and pull requests. Claude Code's attribution is switched off, every other agent is asked to leave them out, and Ramu removes any that remain in the commits and pull requests it makes. Trailers for people and anything inside code blocks stay.

## GitLab

Repositories on gitlab.com, or a server your `glab` is signed in to, get merge requests, pipeline jobs, approvals and issues the same way. **Settings → Git** shows who each sign-in is and can start `glab auth login` for you. Without `glab`, **Save token** keeps a personal access token (`api` scope) for one server in the host's OS credential store, checked before it is saved; Ramu uses it for that server before a `glab` sign-in. `GITLAB_TOKEN` on the host works too.

## Bitbucket Cloud

Bitbucket has no official CLI, so connect it in **Settings → Git** with an Atlassian API token that has Bitbucket scopes and your account email, or with a workspace or repository access token (leave the email empty). Ramu checks the credential before saving it in the host's OS credential store, and agents never see it. `BITBUCKET_EMAIL` with `BITBUCKET_API_TOKEN`, or `BITBUCKET_ACCESS_TOKEN`, on the host works too. Pull requests, the pull request list (with build statuses and open comments for the newest 20), merging, reviewers, review replies and issues work as on GitHub; **Fix failing checks** includes the end of each failed Bitbucket Pipelines step's log. Git itself still pushes with the host's own Git credentials.

## Azure DevOps

Azure Repos remotes (`dev.azure.com`, `*.visualstudio.com` and their SSH forms) connect in **Settings → Git** with a personal access token and its organization. Give the token Code (read and write), Build (read) and Work Items (read). Ramu checks it before saving it in the host's OS credential store, and sends it only to dev.azure.com. `AZURE_DEVOPS_EXT_PAT` on the host (the Azure CLI's) works too.

- **Pull requests:** create them, and follow votes, required reviewers, statuses and build validation policies in Source Control.
- **Fix failing checks** includes the end of each failed pipeline step's log; **Address review comments** sends the active threads.
- **Work items** from Azure Boards stand in for issues on the new-thread screen.

## Set up CI

**Set up CI…** in a project's menu, or **Set up CI** under **Checks** in the [deploy sheet](deploy.md#deploy-a-project), adds a CI workflow to a GitHub or GitLab repository: `.github/workflows/ci.yml` (GitHub Actions) or `.gitlab-ci.yml` (GitLab CI). The sheet first says what it will do, read from the default branch:

- **Install** with the package manager the lockfile names (npm, pnpm, Yarn, Bun, uv, pip, Bundler or Go modules), cached between runs.
- **Then** the lint, typecheck, test and build steps the project has: its `package.json` scripts, the Python tools it declares (Ruff, mypy, pytest, or Django's tests), RuboCop and Rails or RSpec tests, or `go vet`, `go test` and `go build`. The build and test commands in `ramu.json` ([Configuration](configuration.md)) take the place of the detected ones.
- **When:** on every pull request and on pushes to the default branch. GitHub actions are pinned to a major version, and the job can only read the repository.

The file arrives as a pull request from a new `ramu/set-up-ci` branch, made from the default branch on the server, so your checkout, branch and uncommitted work stay as they are. CI runs on that pull request, so you see it pass before merging. A default branch that already has the file is left alone. Pushing a workflow file to GitHub needs the `workflow` permission on the host's Git sign-in; when it is missing, Ramu says how to add it.

**Require CI to pass before merging** makes the CI check required on the default branch through the repository's GitHub account, once the pull request is open; on GitLab it turns on the project's **Pipelines must succeed** merge setting and changes nothing else. It is checked by default for repositories Ramu published and unchecked for others. Existing rules are kept: a branch with required checks gets CI added, and a branch protected without required checks is left alone with a note. Changing protection needs admin access (Maintainer on GitLab), and GitHub allows it on private repositories only on paid plans; when GitHub refuses, the sheet says why and the pull request stays open. Agents cannot change branch protection.

**Keeping the default branch green:** when a thread's checkout pushes the default branch (**Push** or **Sync** in Source Control, or a `git push` its agent runs in the thread's folder), Ramu follows CI on the pushed commit for up to three hours. **Merge…** on a pull request into the default branch does the same for the commit the merge made, for the thread working on that pull request. If a check fails, the failing jobs and the end of their logs go to that thread's queue, asking for a fix committed on a new branch; the thread wakes like a [watched pull request](#github). A sync that only pulls follows nothing. This works on GitHub and GitLab.

A step that needs a secret reads it from the repository's GitHub Actions secrets; **Sync** under **Environment variables** in the [deploy sheet](deploy.md#deploy-a-project) writes the ones this host has.

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
