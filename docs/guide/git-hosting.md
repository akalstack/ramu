# GitHub, GitLab, Bitbucket and Azure DevOps

## GitHub

Ramu uses the [GitHub CLI](https://cli.github.com) sign-ins you already have (`gh auth login`), or a token saved in **Settings → Git → Hosting accounts**. Saved tokens stay in the host's OS credential store and go only to their own server.

- **Start a thread from an issue:** pick an issue on the new-thread screen. Its text becomes the first message, and a pull request from that checkout closes it.
- **Open a pull request:** **Create pull request** in Source Control drafts the title and description from the branch's commits.
- **Follow it:** Source Control shows checks, draft state and review decision. **Fix failing checks** and **Address review comments** send the details to a thread, which commits fixes but never pushes.
- **Watch in a thread:** a thread can watch a pull request and receive new failures and review requests while Ramu runs in the background. **Automatically watch pull requests** (Settings → Git) does this for pull requests you create.

## GitLab

Repositories on gitlab.com, or a server your `glab` is signed in to, get merge requests, pipeline jobs, approvals and issues the same way. **Settings → Git** shows who each sign-in is and can start `glab auth login` for you. Without `glab`, **Save token** keeps a personal access token (`api` scope) for one server in the host's OS credential store, checked before it is saved; Ramu uses it for that server before a `glab` sign-in. `GITLAB_TOKEN` on the host works too.

## Bitbucket Cloud

Bitbucket has no official CLI, so connect it in **Settings → Git** with an Atlassian API token that has Bitbucket scopes and your account email, or with a workspace or repository access token (leave the email empty). Ramu checks the credential before saving it in the host's OS credential store, and agents never see it. `BITBUCKET_EMAIL` with `BITBUCKET_API_TOKEN`, or `BITBUCKET_ACCESS_TOKEN`, on the host works too. Pull requests, build statuses, reviewers, open comments and issues work as on GitHub; **Fix failing checks** includes the end of each failed Bitbucket Pipelines step's log. Git itself still pushes with the host's own Git credentials.

## Azure DevOps

Azure Repos remotes (`dev.azure.com`, `*.visualstudio.com` and their SSH forms) connect in **Settings → Git** with a personal access token and its organization. Give the token Code (read and write), Build (read) and Work Items (read). Ramu checks it before saving it in the host's OS credential store, and sends it only to dev.azure.com. `AZURE_DEVOPS_EXT_PAT` on the host (the Azure CLI's) works too.

- **Pull requests:** create them, and follow votes, required reviewers, statuses and build validation policies in Source Control.
- **Fix failing checks** includes the end of each failed pipeline step's log; **Address review comments** sends the active threads.
- **Work items** from Azure Boards stand in for issues on the new-thread screen.

## Branches and worktrees

**Settings → Git → New threads & worktrees** sets whether new threads use the current checkout or a new worktree, and how branches are named: a fixed prefix (`ramu/<title>`), a short name from your first message, or your own instructions.
