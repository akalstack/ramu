# GitHub, GitLab, Bitbucket and Azure DevOps

## GitHub

Ramu uses the [GitHub CLI](https://cli.github.com) sign-ins you already have (`gh auth login`), or a token saved in **Settings → Git → Hosting accounts**. Saved tokens stay in the host's OS credential store and go only to their own server.

- **Start a thread from an issue:** pick an issue on the new-thread screen. Its text becomes the first message, and a pull request from that checkout closes it.
- **Open a pull request:** **Create pull request** in Source Control drafts the title and description from the branch's commits.
- **Follow it:** Source Control shows the branch's pull request with its checks, draft state and review decision. **Fix failing checks** and **Address review comments** send the details to a thread, which commits fixes but never pushes.
- **Watch in a thread:** a thread can watch a pull request while Ramu runs in the background. New failing checks and new review comments return to it as one round, but only comments from people with write access, requested reviewers, the author and bots. Comments from anyone else show as **From outside the project** and never wake the agent. **Automatically watch pull requests** (Settings → Git) does this for pull requests you create.

### Pull requests in Source Control

**Source Control → Pull requests**, next to Commits and Stashes, lists the repository's pull requests in three groups: **Yours**, **Review requested** and **Other open**. Each row has its state icon (open, draft, merged, closed), checks, open review threads, author, and the thread working on it. A search field filters by number, title, author or branch, and **Show merged and closed** adds recent finished ones.

Each pull request has one stage, shown in the same words on rows, in the thread list, in Inbox and on the phone: **Replies ready**, **Agent working**, **Has conflicts**, **Checks failing**, **Changes requested**, **Draft**, **Checks running**, **Waiting on review**, **Ready to merge**, **Merged** or **Closed**. Thread rows show the pull request icon with a dot when it needs attention. Inbox's Brief lists the pull requests whose next step is yours: replies to send, ready to merge, or conflicts.

Opening a pull request shows it in full, with these actions:

- **Open thread** goes to the thread already working on it. **Open in thread** makes a worktree on its branch and starts a thread that catches up on it: what it does, what is left, and the next step.
- **Review with agent** (someone else's pull request) checks it out in a worktree and asks an agent to review it without changing files. Its drafted review (verdict, summary and line comments) waits for you to edit and **Post review**. Pull requests from forks can be reviewed on GitHub and GitLab, but not pushed to.
- **Ready for review**, **Update branch** (when it is behind or conflicts), **Close** and **Reopen**.
- **Merge…** offers the methods the repository allows, the last one you used first, and says what still blocks the merge before it can run. It can delete the branch and mark the thread done.

### Review replies

When a thread addresses review comments, the agent records an outcome for each thread: **Fixed** (with the commit), **No change** (why the code stays), **Question** (one specific question for the reviewer) or **Skip**. The pull request's **Review replies** card shows each comment beside its draft. Edit any reply or outcome, then **Push and reply**: it pushes first, posts the replies (a Fixed reply names its commit), and asks the reviewers to review again. **Resolve fixed threads** is off by default. If the push fails, nothing is posted. A reply that fails stays in the card with its error, and a reply that already reached the thread is never posted twice. The reviewer's answer comes back to the same thread as the next round.

Agents never push, post or merge on their own. Only these person actions do.

- **Your name on the work:** **Remove agent credits** (Settings → Git, on by default) keeps agents' `Co-authored-by` trailers and "Generated with" lines out of commits and pull requests. Claude Code's attribution is switched off, every other agent is asked to leave them out, and Ramu removes any that remain in the commits and pull requests it makes. Trailers for people and anything inside code blocks stay.

## GitLab

Repositories on gitlab.com, or a server your `glab` is signed in to, get merge requests, pipeline jobs, approvals and issues the same way. **Settings → Git** shows who each sign-in is and can start `glab auth login` for you. Without `glab`, **Save token** keeps a personal access token (`api` scope) for one server in the host's OS credential store, checked before it is saved; Ramu uses it for that server before a `glab` sign-in. `GITLAB_TOKEN` on the host works too.

## Bitbucket Cloud

Bitbucket has no official CLI, so connect it in **Settings → Git** with an Atlassian API token that has Bitbucket scopes and your account email, or with a workspace or repository access token (leave the email empty). Ramu checks the credential before saving it in the host's OS credential store, and agents never see it. `BITBUCKET_EMAIL` with `BITBUCKET_API_TOKEN`, or `BITBUCKET_ACCESS_TOKEN`, on the host works too. Pull requests, the pull request list, merging, build statuses, reviewers, review replies and issues work as on GitHub; **Fix failing checks** includes the end of each failed Bitbucket Pipelines step's log. Git itself still pushes with the host's own Git credentials.

## Azure DevOps

Azure Repos remotes (`dev.azure.com`, `*.visualstudio.com` and their SSH forms) connect in **Settings → Git** with a personal access token and its organization. Give the token Code (read and write), Build (read) and Work Items (read). Ramu checks it before saving it in the host's OS credential store, and sends it only to dev.azure.com. `AZURE_DEVOPS_EXT_PAT` on the host (the Azure CLI's) works too.

- **Pull requests:** create them, and follow votes, required reviewers, statuses and build validation policies in Source Control.
- **Fix failing checks** includes the end of each failed pipeline step's log; **Address review comments** sends the active threads.
- **Work items** from Azure Boards stand in for issues on the new-thread screen.

## Branches and worktrees

**Settings → Git → New threads & worktrees** sets whether new threads use the current checkout or a new worktree, and how branches are named: a fixed prefix (`ramu/<title>`), a short name from your first message, or your own instructions.
