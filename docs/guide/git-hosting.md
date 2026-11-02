# GitHub and GitLab

## GitHub

Ramu uses the [GitHub CLI](https://cli.github.com) sign-ins you already have (`gh auth login`), or a token saved in **Settings → Git → Hosting accounts**. Saved tokens stay in the host's OS credential store and go only to their own server.

- **Start a thread from an issue:** pick an issue on the new-thread screen. Its text becomes the first message, and a pull request from that checkout closes it.
- **Open a pull request:** **Create pull request** in Source Control drafts the title and description from the branch's commits.
- **Follow it:** Source Control shows checks, draft state and review decision. **Fix failing checks** and **Address review comments** send the details to a thread, which commits fixes but never pushes.
- **Watch in a thread:** a thread can watch a pull request and receive new failures and review requests while Ramu runs in the background. **Automatically watch pull requests** (Settings → Git) does this for pull requests you create.

## GitLab

Repositories on gitlab.com, or a server your `glab` is signed in to, get merge requests, pipeline jobs, approvals and issues the same way.

## Branches and worktrees

**Settings → Git → New threads & worktrees** sets whether new threads use the current checkout or a new worktree, and how branches are named: a fixed prefix (`ramu/<title>`), a short name from your first message, or your own instructions.
