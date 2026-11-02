# GitHub, GitLab and Bitbucket

## GitHub

Ramu uses the [GitHub CLI](https://cli.github.com) sign-ins you already have (`gh auth login`), or a token saved in **Settings → Git → Hosting accounts**. Saved tokens stay in the host's OS credential store and go only to their own server.

- **Start a thread from an issue:** pick an issue on the new-thread screen. Its text becomes the first message, and a pull request from that checkout closes it.
- **Open a pull request:** **Create pull request** in Source Control drafts the title and description from the branch's commits.
- **Follow it:** Source Control shows checks, draft state and review decision. **Fix failing checks** and **Address review comments** send the details to a thread, which commits fixes but never pushes.
- **Watch in a thread:** a thread can watch a pull request and receive new failures and review requests while Ramu runs in the background. **Automatically watch pull requests** (Settings → Git) does this for pull requests you create.

## GitLab

Repositories on gitlab.com, or a server your `glab` is signed in to, get merge requests, pipeline jobs, approvals and issues the same way. **Settings → Git** shows who each sign-in is and can start `glab auth login` for you; `GITLAB_TOKEN` on the host works too.

## Bitbucket Cloud

Bitbucket has no official CLI, so connect it in **Settings → Git** with an Atlassian API token that has Bitbucket scopes and your account email, or with a workspace or repository access token (leave the email empty). Ramu checks the credential before saving it in the host's OS credential store, and agents never see it. `BITBUCKET_EMAIL` with `BITBUCKET_API_TOKEN`, or `BITBUCKET_ACCESS_TOKEN`, on the host works too. Pull requests, build statuses, reviewers, open comments and issues work as on GitHub; Git itself still pushes with the host's own Git credentials.

## Branches and worktrees

**Settings → Git → New threads & worktrees** sets whether new threads use the current checkout or a new worktree, and how branches are named: a fixed prefix (`ramu/<title>`), a short name from your first message, or your own instructions.
