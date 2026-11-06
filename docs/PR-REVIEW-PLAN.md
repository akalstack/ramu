# Review replies and the pull request loop

An agent answers review comments on a pull request: it fixes what it agrees with, explains what needs no change, and asks the reviewer when a comment is unclear. The person checks the drafts and sends everything with one action. Remove work as it lands, document shipped behavior in [GitHub, GitLab, Bitbucket and Azure DevOps](guide/git-hosting.md), and delete this plan when implementation and acceptance are finished.

## The need

Today **Address review comments** and **Watch in thread** send open review threads to an agent, which commits fixes and explains the rest in chat. The person then pushes from Source Control, opens the pull request in a browser, finds each comment again, writes a reply that repeats what the agent said, resolves threads and re-requests review. When the reviewer answers, nothing comes back unless they choose **Request changes**: a plain comment or an answer to the agent's question is missed.

**Easier for the person:** a review round is one look and one click instead of a push plus one reply per comment. The agent's reasoning reaches the reviewer without copying. A reviewer's follow-up returns to the same thread with its context. The pull request says what it is waiting on: you, the agent, the reviewer, checks, or merge.

## The flow

1. **Open:** **Create pull request** stays as it is, and **Automatically watch pull requests** watches it in the originating thread.
2. **Feedback arrives:** the watch picks up new review comments, reviews of any state (not only Changes requested), replies in threads that are already open, and failing checks. A round holds whatever arrived since the last delivery, so five comments from one review make one round, not five.
3. **Triage:** for each thread the agent records one outcome with a draft reply:
   - **Fixed:** commits the change; the reply says what changed and links the commit after the push.
   - **No change:** leaves the code as it is and explains why (already handled elsewhere, out of scope, intended behavior).
   - **Question:** the comment is unclear or needs a decision; the reply asks the reviewer one specific question.
   - **Skipped:** not for the agent (praise, an FYI, a thread for someone else); nothing gets posted.
4. **Review:** a **Review replies** card in the thread and in Source Control lists each thread with its comment, outcome, draft reply and the commit's diff. The person can edit a reply, change its outcome, uncheck it, or tell the agent "redo this one" in the composer.
5. **Send:** **Push and reply** pushes the branch, posts the checked replies, and re-requests review from reviewers who requested changes (on by default, can be unchecked). **Resolve fixed threads** is off by default, because many teams let the reviewer resolve. **Reply only** sends the replies without pushing, for rounds with nothing but No change and Question replies.
6. **Wait:** the pull request shows **Waiting on reviewer** and the watch keeps going. Answers to a Question come back with the thread's history, and the agent continues from there.
7. **Finish:** when it's approved, the checks pass and there are no open threads, the pull request shows **Ready to merge** in Source Control and Inbox. Merging and updating the branch belong to [Pull requests in Source Control](PR-MANAGEMENT-PLAN.md).

Every post needs that person action; the agent never posts or pushes by itself. That keeps the loop safe without a round limit: each round costs one click.

## Pull request states

One state in Source Control, the thread header, Inbox and the phone, worked out from what is already read plus the draft batch:

| State | Meaning | Next action |
| --- | --- | --- |
| **Agent working** | Feedback is in the thread's queue or turn | Watch or stop |
| **Replies ready** | A draft batch is waiting | **Push and reply** |
| **Checks failing** | Unchanged | **Fix failing checks** |
| **Waiting on reviewer** | Replies posted, review requested | None |
| **Ready to merge** | Approved, green, no open threads | **Merge** ([Pull requests in Source Control](PR-MANAGEMENT-PLAN.md)) |

**Replies ready** counts as "needs you" in Inbox and on Home, and sends a push notification on the phone like other needs-you items.

## Who can start a round

Review comments are untrusted input. When the watch delivers on its own, only these count:

- people with write access (GitHub `OWNER`/`MEMBER`/`COLLABORATOR`, and the equivalent role on GitLab, Bitbucket and Azure), reviewers requested on the pull request, and its author;
- review bots (GitHub `Bot` accounts, and bot or service users elsewhere), labeled as bots in the card.

Other comments show up in the card as **From outside the project** with **Include**, and never wake the agent. The existing "treat as external feedback" preamble stays.

## Delivery

### 1. Shared review threads

- New adapter methods in `workspace/forge/adapter.ts`: `reviewThreads(cwd, url)` returns one shared shape (thread id, path, line, outdated, resolved, comments with id, author, author role, bot flag, body, time), `postReviewReplies(cwd, url, replies)`, `resolveReviewThreads` and `requestReviews`. Implement them for GitHub (GraphQL `addPullRequestReviewThreadReply`, `resolveReviewThread`, `requestReviews`; plain issue comments for top-level review bodies), GitLab (discussion notes, resolve), Bitbucket (comments with a `parent`, resolve) and Azure (thread comments, thread status).
- `pullRequestFeedback(..., 'reviews')` builds its prompt from that shape in one shared function. It replaces the four per-adapter prompt builders (`reviewFeedbackPrompt`, `discussionsPrompt`, `commentsPrompt` and Azure's), and includes thread ids so the agent can refer to them.
- The prompt's ending changes from "Do not push or reply" to "Record an outcome and draft reply for each thread with `review_reply`; Ramu posts after the person reviews."

### 2. Draft batch and agent tool

- A `review_reply` tool for the thread's lead, registered next to `watch_pull_request` in `PullRequestWatchService.register`, takes `{ threadId, outcome, reply, commit? }`. It checks the thread id against the round it was given and keeps the reply under a size limit (zod). Calling it again for the same thread replaces the draft.
- The batch is stored per watch in app state: the pull request URL, branch, head commit at draft time, and the drafts. It's cleared when posted or when the branch moves to a different pull request.
- The draft batch is a typed resource through `packages/shared/src/api.ts`, so the desktop and the phone read the same thing.

### 3. Send

- `forge.sendReviewReplies(taskId, repoId, batchId, { push, resolveFixed, requestReview, edits })` runs on the server in this order: push (reusing `git.push` with the expected-branch check), then post replies, then resolve, then request reviews. After the push, a Fixed reply's commit reference becomes a link to the pushed commit.
- Posting cannot be retried blindly. Each reply's posted comment id is recorded as soon as it's posted. A retry, or a restart in the middle of a batch, reads the threads again and skips the replies already posted. A reply whose outcome is unknown is shown as such, not posted twice.
- If the push fails, nothing gets posted. If one post fails, the rest still go out, and the failed one stays in the card with **Retry**.
- **Remove agent credits** also applies to replies: they're posted in the person's voice, without a "Generated with" line.

### 4. Watch changes

- `PullRequestWatchService.poll` stops relying on `reviewDecision === 'changes-requested'`. It keeps the last comment id it saw in each thread (and the newest review id), and delivers only what's new from authors that pass "Who can start a round", together with the earlier comments of the threads it touches.
- Comments the person posted (their own replies, including ones Ramu posted for them) never start a round.
- While a batch is still waiting, new comments go into the next round instead of interrupting the agent: the card says **2 new comments** and offers **Include now**.
- Existing behavior stays: delivery pauses when the thread needs input, is stopped or failed, when the queue is paused, or when the branch changed. Rate-limit backoff and account checks also stay.
- **Ready to merge** and **Waiting on reviewer** come from the same poll, so they need no extra requests.

### 5. Surfaces

- **Desktop:** the Review replies card is built with the app's components in the thread timeline (where the round's feedback message appears) and in `PullRequestSection`. The PR row shows the state chip from the table. **Address review comments** keeps working when there's no watch, using the same tool and card.
- **Phone:** an Inbox item for **Replies ready**, and the same card in the thread, with edit, uncheck and **Push and reply**. A push notification goes out when the replies are ready.
- Every new string goes through `t()` and gets an Indonesian translation.

## Services to extend

`workspace/forge/*` adapters and `forge.ts` for reads and writes; `background/pullRequestWatches.ts` for polling, delivery receipts and the tool; `agents.enqueueBackground` for rounds; `git.push` and the branch checks in `ipc/handlers/git.ts`; `ipc/handlers/forge.ts` for the send action; the Inbox's needs-you sources; `PullRequestSection` and the mobile thread view. No new setting other than the two checkboxes in the send action; they remember their last choice per repository.

## Acceptance

- GitHub: a reviewer leaves three comments (one valid bug, one style preference the code already follows, one ambiguous). The agent drafts Fixed, No change and Question. One **Push and reply** pushes, posts three replies under the right threads, re-requests review, and the pull request shows **Waiting on reviewer**.
- The reviewer answers the Question with a plain comment, not Request changes. It comes back to the same thread with the earlier context, and the next batch has one reply.
- A comment from an account without write access on a public repository doesn't wake the agent, and it shows up with **Include**.
- Killing the server in the middle of a send and retrying never posts a reply twice.
- A failed push posts nothing. One rejected reply leaves the rest posted and offers **Retry**.
- The same round on GitLab, Bitbucket and Azure DevOps with live accounts (stays open under [Acceptance](roadmap.md#acceptance) until it's run).
- The round's **Replies ready** item and **Push and reply** work from a physical phone.
- Representative task: a pull request with five review comments goes from review to approved with the person touching only Ramu: one review of the drafts per round, and no copying between Ramu and the browser.

Tests: adapter tests for each forge's thread mapping and reply calls (in the style of `forgeAdapter.test.ts` and `githubApi.test.ts`); watch tests for delta delivery, author filtering, the person's own comments, and queueing while a batch waits; send tests for push-then-post ordering, partial failure and replay after a restart; and web tests for the card's edit, uncheck and send.

## Later

- **Auto-send Question replies** for people who want clarifying questions posted without review, if asked for.
- Suggested-change blocks (GitHub `suggestion` fences) applied directly when the reviewer wrote the exact change.
