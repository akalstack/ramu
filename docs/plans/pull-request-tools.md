# Agents manage pull requests

## The need

A person working with an agent says "approve #42", "tell Ana it's fixed and resolve her thread", "leave a comment on the pull request with the test results", "ask Bob to look again" or "merge it when checks pass". Today the agent can only draft two things: replies to review threads on the person's own pull request (`review_reply`) and a review of someone else's (`draft_review`), each sent by the person from a card (`apps/server/src/background/pullRequestDrafts.ts`). For anything else:

- **On GitHub** the agent runs `gh` in a shell with the identity's `GH_TOKEN`. It works, but there is no card, no identity check, no record on the Pull requests page, and nothing to undo.
- **On GitLab, Bitbucket and Azure DevOps** it has no way at all unless the person has that service's CLI set up.
- **The person** switches to the Pull requests page or the website to do what they just asked for in words.

Every action already exists for the person on the Pull requests page, through one `ForgeAdapter` (`apps/server/src/workspace/forge/adapter.ts`) with GitHub, GitLab, Bitbucket and Azure DevOps behind it: reply, resolve, request reviews, submit a review with line comments, merge, close, reopen, ready for review and update branch. The plan gives agents the same actions as typed tools, adds the actions neither the person nor the agent has yet, and keeps the person in charge of what is posted in their name.

## What agents can do

Each tool takes a pull request URL (or a number in the thread's repository), works the same on every service, and says plainly when a service cannot do something. Reads never need approval.

**Read**

- `pull_request_list`: the project's pull requests with their stage, as the Pull requests page shows them.
- `pull_request_view`: title, body, state, checks, merge options and what blocks a merge, reviewers and their verdicts, labels, and the changed files.
- `pull_request_threads`: review threads with ids, file and line, resolved or outdated, and every comment with its author and id; and the conversation comments that are on no file.

**Write**

| Tool | Does |
| --- | --- |
| `pull_request_comment` | A comment on the pull request itself, on no file. |
| `pull_request_reply` | A reply in a review thread or under a conversation comment. |
| `pull_request_line_comment` | One comment on a line or range of the new or old version, outside a review, optionally with a suggested change. |
| `pull_request_review` | One review: verdict (comment, approve, request changes), summary and line comments with suggestions. Replaces `draft_review`'s post step. |
| `pull_request_resolve` | Resolve or unresolve a thread. On Azure DevOps, also its other statuses (won't fix, by design, closed). |
| `pull_request_edit_comment` / `pull_request_delete_comment` | Only comments the same account wrote. |
| `pull_request_react` | Add or remove a reaction on a comment. |
| `pull_request_reviewers` | Request or remove reviewers, and ask past reviewers to review again. |
| `pull_request_withdraw_review` | Take back the account's own approval or change request. |
| `pull_request_update` | Title, body, draft or ready, labels, assignees, base branch. |
| `pull_request_merge` | Merge with an allowed method, optionally deleting the branch; or merge automatically once checks pass. |
| `pull_request_state` | Close, reopen, update branch. |
| `pull_request_rerun_checks` | Run failed checks again. |

`review_reply` stays: answering a review round is still drafted per thread and sent together by **Push and reply**, because that push-then-post order is what keeps replies from naming commits the reviewer cannot see.

## By service

What each service offers, from its public API. Cells marked **check** are confirmed or corrected against a live account in step 1 before anything is built on them.

| Action | GitHub | GitLab | Bitbucket Cloud | Azure DevOps |
| --- | --- | --- | --- | --- |
| Comment on the pull request | ✓ | ✓ (note) | ✓ | ✓ (thread with no file) |
| Reply in a thread | ✓ | ✓ (discussion note) | ✓ (reply to comment) | ✓ |
| Line comment outside a review | ✓ | ✓ (diff discussion) | ✓ (inline comment) | ✓ |
| Suggested change | ✓ | ✓ | check | check |
| Approve | ✓ (review) | ✓ (approval) | ✓ | ✓ (vote 10, or 5 with suggestions) |
| Request changes | ✓ (review) | check | ✓ | ✓ (vote −5 wait for author, −10 reject) |
| Withdraw own verdict | dismiss is admin only; a new comment review does not clear it: **check** | ✓ (unapprove) | ✓ | ✓ (vote 0) |
| Resolve / unresolve | ✓ | ✓ | check | ✓ (thread status) |
| Edit / delete own comment | ✓ | ✓ | ✓ | ✓ |
| Reactions | ✓ | ✓ (award emoji) | none | like only |
| Reviewers | ✓ | ✓ | ✓ | ✓ (required and optional) |
| Labels | ✓ | ✓ | none | ✓ (tags) |
| Draft ↔ ready | ✓ | ✓ | check | ✓ |
| Auto-merge when checks pass | ✓ (if the repository allows it) | ✓ (when pipeline succeeds) | none | ✓ (auto-complete) |
| Re-run failed checks | ✓ (Actions) | ✓ (retry pipeline) | check (Pipelines) | ✓ (re-queue build) |

A tool asked for something a service lacks returns that, in words the agent repeats ("Bitbucket has no labels"), never a silent no-op. The same support map tells the Pull requests page which buttons to show.

## Who decides what is posted

Everything a tool writes is public and in the person's name, so it follows the thread's mode the way other outward actions do, with three rules on top:

1. **A card shows exactly what goes out.** Each write posts a **pull request card** in the thread: the action, the text as it will appear (Markdown rendered as the service shows it), the file and line, and the account and identity it posts as. **Post**, **Edit** and **Dismiss**. Several writes from one turn share one card with **Post all**.
2. **Full access posts conversation writes directly.** Comments, replies, line comments, resolve and unresolve, reactions and reviewers post at once and the card shows what went out with **Undo** where the service can take it back (delete the comment, unresolve, remove the reaction or reviewer).
3. **Decisions always wait for the person**, in every mode: approve, request changes, withdraw a verdict, merge (and auto-merge), close, deleting a branch, and changing the base branch. These are judgments the reviewer's team relies on, and most cannot be undone.

The existing identity check runs before every write: if the repository's account belongs to another identity, the card says so and posts nothing until the person picks the account. From a paired phone, **Post** follows the device's existing permissions like the Pull requests page does.

Agents keep `GH_TOKEN` for Git, but the thread's guidance points pull request work at these tools, and `gh pr comment`, `gh pr review` and `gh pr merge` run in a shell are refused with a note naming the tool, so every post shows in a card.

## Delivery

1. **Confirm the table.** For each **check** cell, read the service's current API docs and try it on a test repository with a live account (already listed under live accounts in the roadmap's Acceptance). Correct the table here before writing code.
2. **Adapter.** Extend `ForgeAdapter` with `comment`, `lineComment`, `editComment`, `deleteComment`, `unresolveThread` (and Azure statuses), `react`, `removeReviewers`, `withdrawReview`, `updatePullRequest`, `rerunChecks`, and `PullRequestAction` with `draft` and `auto-merge`; extend `submitReview` with suggestions and line ranges. Each adapter declares what it supports in one map, shared with the client (`packages/shared/src/types/forge.ts`).
3. **Tools and card.** Register the tools beside `review_drafts` and `draft_review` (`pullRequestDrafts.ts`), with `zod` limits on every input. The card reuses **Review replies**' rendering and failure handling: a write that fails stays in the card with its error, and a write that reached the service is never posted twice.
4. **The person gets the same actions.** The Pull requests page and the phone add what the adapter now offers: **Comment** on the conversation, edit and delete their own comments, unresolve, reactions, reviewers, labels and assignees, draft, auto-merge and **Re-run failed checks**. Agent and person use the same server calls.
5. **Docs.** `docs/guide/git-hosting.md` replaces "Agents never push, post or merge on their own" with the rules above, and gains the by-service table.

## Services to extend

- `apps/server/src/workspace/forge/adapter.ts` and `github.ts`, `githubPulls.ts`, `gitlab.ts`, `bitbucket.ts`, `azure.ts`; `apps/server/src/workspace/forge.ts` for routing.
- `apps/server/src/background/pullRequestDrafts.ts` for the tools and cards; the identity check used before pushes and merges.
- `apps/web/src/git/PullRequestView.tsx`, `PullRequestTimeline.tsx`, `pullRequestThreads.ts`; `apps/mobile/src/components/PullRequestSections.tsx` and `ReviewDrafts.tsx`.
- The thread guidance that tells agents which tools to use, and the shell rules that refuse `gh pr` writes.

## Acceptance

- "Approve #42 and say thanks" in Full access: one card with the approval and the comment, nothing posted until **Post all**; on each of the four services.
- "Reply to Ana that it's fixed in the last commit and resolve her thread" in Full access: the reply and the resolve post at once, the card shows them with **Undo**, and **Undo** deletes the reply and reopens the thread.
- "Comment on the pull request with the test results": a conversation comment with no file, rendered on the service as it was in the card.
- "Add the `bug` label" on Bitbucket: the agent says Bitbucket has no labels and posts nothing.
- A repository whose account belongs to another identity: the card posts nothing until the account is chosen.
- `gh pr merge` in the agent's shell is refused with a note naming `pull_request_merge`.
- The person does each new action from the Pull requests page on the desktop and the phone.

Representative task: after a review round, the person says "reply to everyone, resolve what's fixed, ask Bob to look again, and approve Sara's PR while you're at it". Today that is the Review replies card plus three trips to the website. With this it is one card for the replies and reviewers and one **Post** for the approval.

## Later options

- Issues the same way: comment, label, assign and close from a thread.
- Suggested changes the person applies from the Pull requests page as commits.
- A per-project rule letting agents approve their own team's dependency-update pull requests when checks pass.
