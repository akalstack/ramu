# Pull requests and issues

Ramu works with GitHub through the [GitHub CLI](https://cli.github.com) (`gh`), so it uses your existing sign-in and never stores a token. Install `gh` and run `gh auth login` once. Repositories that are not on GitHub simply don't show these controls.

## Start a thread from an issue

On the new thread screen of a project with a GitHub repository, pick an open issue from the issue chip beside the project (it reads **No issue** until you pick one). Its title, description, labels and comments become the opening message, which you can edit before sending. The thread remembers the issue, and a pull request opened from the same checkout closes it.

## Open a pull request

In **Source Control**, a branch other than the default branch shows **Create pull request**. Ramu drafts the title and description from the branch's commits (a single commit's subject and body, or the branch name and a list of commits) and adds `Closes #N` for a linked issue. Edit anything, optionally open it as a draft, and confirm: Ramu publishes the branch if needed and opens the pull request.

## Follow checks and reviews

Once a pull request exists, Source Control shows it with its checks (the latest run of each), draft state and review decision. Open pull requests refresh every 30 seconds while the window is in front, and after every commit or push.

- **Fix failing checks** sends each failing check and the part of its GitHub Actions log around the first error to the watched thread. With watches off, it starts a thread in the same checkout.
- **Address review comments** sends the open (unresolved) review threads and review summaries to the watched thread, or starts one when watches are off.

Both threads commit their fixes on the branch but never push or reply on GitHub; review the result and push from Source Control.

## Watch in a thread

**Settings → Git → Automatically watch pull requests** is off by default. Turn it on to watch new PRs created through Ramu from an existing thread, returning feedback to that same thread. It does not start watches for PRs you merely view, or guess a thread when you create a PR from a project view. Turning it off prevents future automatic watches; existing watches remain under the controls below.

Choose an existing thread in the same checkout from **Watch in thread**. The background service checks the PR every minute, including while the window is closed. New failing check runs and requested changes enter that thread's normal input queue; they wait for a running turn to finish. Unchanged feedback is delivered once, and both watches and delivery receipts survive a service restart.

A thread waiting for input or failed, or with a paused queue stays under your control. Automatic feedback waits until you continue it. Stopping the thread ends its watches. Switching branches suspends delivery, and queued feedback checks its branch again before sending. If that check fails, the queue pauses with an explanation: switch back and resume it, or remove the pending message.

Select **Watch off** to stop future polling. Already queued feedback remains visible and can be removed from the thread. Closing or merging the PR, archiving or deleting its thread, or removing its checkout ends the watch. GitHub authentication and network failures retry on the next poll.

You can also ask a main-thread agent to watch the checked-out PR or stop watching. Ramu provides `watch_pull_request` and `unwatch_pull_request`; with several repositories the agent must choose one. Helpers do not own watches. These tools use the same persisted watches and Source Control controls, including the rule that fixes are never pushed automatically.
