# Pull requests and issues

Ramu works with GitHub through the [GitHub CLI](https://cli.github.com) (`gh`), so it uses your existing sign-in and never stores a token. Install `gh` and run `gh auth login` once. Repositories that are not on GitHub simply don't show these controls.

## Start a chat from an issue

On the new chat screen of a project with a GitHub repository, pick an open issue from the issue chip beside the project (it reads **No issue** until you pick one). Its title, description, labels and comments become the opening message, which you can edit before sending. The chat remembers the issue, and a pull request opened from the same checkout closes it.

## Open a pull request

In **Source Control**, a branch other than the default branch shows **Create pull request**. Ramu drafts the title and description from the branch's commits (a single commit's subject and body, or the branch name and a list of commits) and adds `Closes #N` for a linked issue. Edit anything, optionally open it as a draft, and confirm: Ramu publishes the branch if needed and opens the pull request.

## Follow checks and reviews

Once a pull request exists, Source Control shows it with its checks (the latest run of each), draft state and review decision. Running checks refresh every 30 seconds while the window is in front, and after every commit or push.

- **Fix failing checks** starts a chat in the same checkout with each failing check and the part of its GitHub Actions log around the first error.
- **Address review comments** starts a chat with the open (unresolved) review threads and review summaries.

Both chats commit their fixes on the branch but never push or reply on GitHub; review the result and push from Source Control.
