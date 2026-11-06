# Pull requests in Source Control

Source Control lists a repository's pull requests and lets the person act on them: open one in a thread, review someone else's, update the branch and merge. Today it only shows the pull request of the branch that's checked out. Remove work as it lands, document shipped behavior in [GitHub, GitLab, Bitbucket and Azure DevOps](guide/git-hosting.md), and delete this plan when implementation and acceptance are finished. Replying to review comments is a separate plan: [Review replies](PR-REVIEW-PLAN.md).

## The need

A person working with agents has several pull requests open at once, often one per thread or worktree, plus pull requests from teammates waiting on their review. Ramu shows one at a time, and only after switching to its branch. To see what's waiting, pick up a teammate's pull request, or merge a finished one, they go to the browser and then come back to set up a checkout and a thread by hand.

**Easier for the person:** one list per repository answers "what's open and what's waiting on me". Any pull request becomes an agent thread in one click, with the right branch checked out in its own worktree. Finishing (update, merge, delete the branch, archive the thread) is one action, not four.

## Where it lives

- **Source Control → Pull requests**, a tab beside **Commits** and **Stashes** in the Git inspector, for the selected repository. That's where the pull request already is, and it keeps the list next to the branches and worktrees it acts on.
- **The current branch's pull request** stays at the top of Source Control (`PullRequestSection`) as it is, with the [Review replies](PR-REVIEW-PLAN.md) states.
- **Inbox** stays "what needs me": only pull requests that need an action show up in the Brief (**Replies ready**, **Review requested from you**, **Ready to merge**), and each row opens the pull request in Source Control. Inbox gets no list of its own.
- **No new top-level page.** A view across all repositories can come later if people with many repositories ask for it (see Later).

## The list

Three groups, each one only when it has items:

1. **Yours:** pull requests you opened. Each row shows its state from the review-replies plan (Agent working, Replies ready, Checks failing, Waiting on reviewer, Ready to merge), plus the thread watching it.
2. **Review requested:** pull requests where you, or a team you're on, were asked to review.
3. **Other open:** the rest of the open pull requests, collapsed by default.

A row shows the number, title, author, branch, checks, review decision, draft state, and whether it conflicts with its base. A search field filters by title, number, author or branch. **Show closed** adds the last 20 merged and closed ones. The list refreshes with the same polling and `ramu:git-updated` event as `PullRequestSection`, and only while the tab is open.

## Actions

Each row has one main action and a menu with the rest:

| Pull request | Main action | Menu |
| --- | --- | --- |
| Yours, with a thread | **Open thread** | Watch on/off, Update branch, Merge, Open on the forge |
| Yours, no thread | **Open in thread** | Same |
| Review requested | **Review with agent** | Check out in worktree, Open on the forge |
| Other | **Open in thread** | Check out in worktree, Open on the forge |

- **Open in thread** creates a worktree on the pull request's head branch, using the existing worktree and branch settings, starts a thread there with the pull request as context (title, description, linked issue), and watches it when **Automatically watch pull requests** is on. For a pull request from a fork, it fetches the fork's head ref read-only and says that pushing needs the author's permission.
- **Review with agent** opens the pull request read-only in a worktree and asks a read-only agent (the Review teammate's read-only mode) to draft review comments on the diff. The person edits them in the same card as Review replies and posts them as one review (Comment, Approve or Request changes). It never posts anything without the person's action.
- **Update branch** merges or rebases the base into the head branch. The forge's own update is used when it has one (GitHub `updatePullRequestBranch`); otherwise it happens locally in the pull request's worktree. A conflict hands off to the existing **Resolve with AI** flow.
- **Merge** asks for the method (merge, squash or rebase; only the ones the repository allows, with the last one used preselected) and shows what's blocking it (required checks, reviews, conflicts) before the button is enabled. After the merge, **Clean up** is checked by default: it deletes the remote branch when the forge allows it, removes the worktree when it has no uncommitted changes, and archives the thread with a recap. Each of these can be unchecked, and nothing with uncommitted work is removed.
- **Close** and **Reopen** are in the menu, with a confirmation.

Merge and close can't be undone, so they always ask for confirmation and are never available to agents as tools.

## Delivery

### 1. Adapter reads

- `listPullRequests(cwd, { search, includeClosed })` in `workspace/forge/adapter.ts`, returning the existing `PullRequestInfo` plus author, whether it's from a fork, mergeability and requested reviewers, and the group it belongs to for the account in use. Implement it for GitHub (one GraphQL search per group), GitLab, Bitbucket and Azure DevOps.
- `pullRequestStatus(cwd, url)` already reads one pull request by URL; the list's rows reuse that shape, so `PullRequestSection` and the list render the same state.

### 2. Adapter writes

- `updatePullRequestBranch`, `mergePullRequest(method)`, `closePullRequest`, `reopenPullRequest` and `submitReview(event, comments)`, each validated with zod in `ipc/handlers/forge.ts` and checked against the repository's binding and account, like `forge.createPullRequest`.
- A merge that loses its reply reads the pull request again before reporting, so a retry never merges twice and never reports a merge that failed (the same pattern as `createPullRequest`).

### 3. Threads and worktrees

- **Open in thread** reuses `startCheckoutChat`, the worktree creation from the new-thread flow, and `PullRequestWatchService.watchCreated`'s rules for picking the thread to watch. A pull request that already has a thread in a checkout on its branch opens that thread instead of making a second one.
- **Clean up** reuses the existing worktree removal and thread archiving, so their checks (uncommitted changes, running agents) apply.

### 4. Surfaces

- Desktop: the Pull requests tab in `GitInspector`, built from the app's components, keyboard reachable, with every string through `t()` and an Indonesian translation.
- Phone: a pull request list per project in the project view, with Open thread, Merge and Open on the forge. Review with agent and Update branch stay on the desktop until someone asks for them on the phone.
- Inbox Brief rows for **Review requested from you** and **Ready to merge**, next to **Replies ready** from the review-replies plan.

## Services to extend

`workspace/forge/*` adapters and `forge.ts`; `ipc/handlers/forge.ts`; `PullRequestWatchService` for watches and the thread lookup; the worktree and branch-naming code in `workspace/branchNaming.ts` and `isolation.ts`; `startCheckoutChat` and `useResolveWithAi` in `sidebar/scm`; Teammates' read-only Review for **Review with agent**; and the Inbox Brief's needs-you sources. No new settings: the merge method and the clean-up choices remember the last choice per repository.

## Acceptance

- With three pull requests open from three threads, plus one review requested by a teammate, the Pull requests tab shows them in the right groups with correct states, without switching branches.
- **Open in thread** on a teammate's pull request creates a worktree on its branch and a thread with its description. Doing it again opens the same thread.
- **Review with agent** drafts comments read-only. After editing, one **Submit review** posts them as one review with the chosen verdict.
- **Merge** with squash, with clean-up left on, merges, deletes the remote branch, removes the clean worktree, and archives the thread. A worktree with uncommitted changes is kept, and the person is told.
- A merge blocked by a required check is explained, and the button stays disabled.
- The same list and merge on GitLab, Bitbucket and Azure DevOps with live accounts (stays open under [Acceptance](roadmap.md#acceptance) until it's run).
- Representative task: picking up a teammate's pull request, getting an agent's review, and merging their own finished one, all from Ramu, with no browser trip and no manual worktree setup.

Tests: adapter tests for each forge's list mapping, grouping, merge and the double-merge guard; server tests for the thread reuse and clean-up safety; and web tests for grouping, search and the merge dialog's blocked state.

## Later

- A view across all repositories, if people with many repositories need one; it would reuse the same list and rows.
- Stacked pull requests: show the stack, and rebase the whole stack after a merge.
- Labels, assignees and milestones.
