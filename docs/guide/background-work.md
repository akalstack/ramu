# Background work

The desktop app connects to a local service that owns threads, terminals and schedules. Closing the window leaves them running; reopening reconnects. The host must stay awake. **Settings → Background & updates** controls the service and starting at login.

## Messages while an agent works

Enter uses your Steer or Queue choice; Cmd/Ctrl+Enter uses the other. **Steer** adds your message to the running turn; **Queue** waits for the turn to end. A steered message waits for running tools to finish. To redirect the agent sooner, choose **Stop turn and send now** from a queued message's menu, or tap its send button on the phone: the turn stops, that message starts the next one, and the rest of the queue follows. Agents can ask questions and keep working on independent parts while they wait for your answer.

## Restart recovery

**Continue threads after restart** (on by default) resumes unfinished threads after the service restarts. Finished, failed and stopped threads stay stopped, and queued messages are kept.

## Schedules

Schedules run once, daily, weekly, monthly or every few minutes (at least five). **Run now** runs one immediately; **Pause** stops future runs. Missed runs either run once or are skipped. Each run records how it ended: completed, failed, needs input, cancelled, interrupted or missed. Three failed runs in a row pause the schedule so a broken task stops spending tokens.

With several hosts connected, **Runs on** saves a schedule on another host, and Schedules lists each host's schedules. A schedule always runs on its own host.

### When a request arrives

A schedule can start from a webhook instead of a clock: choose **When a request arrives** as its frequency, then what starts it.

- **Presets:** GitHub (CI failed on a pull request, review comment on a pull request, issue labeled `ramu`), GitLab (pipeline failed), Sentry (new error), or any request. A preset fills in the filters, what the agent reads, how the sender signs requests, and a first prompt.
- **Address and secret:** the card's **Address and requests** shows where to send requests, one address per route (Ramu Link first, then the host's own network addresses), and the secret to paste into the sender. **New address** replaces both. For a GitHub preset in a project with a GitHub repository, **Create on…** makes the repository webhook with the right address, secret and events, using the account Ramu already has for that repository. The webhook is updated on **New address** and removed with the schedule. Sentry gives you its own secret; paste it on the card.
- **What runs:** a request must carry a valid signature and match every filter (a field such as `body.action` is, is not, starts with, is one of, or is present). The run's thread is titled after the request. Its prompt is the schedule's prompt followed by the fields you chose, fenced as untrusted data the agent is told not to follow. A delivery the sender retries is ignored, and requests about the same subject within two minutes (the same commit, pull request or issue) join one waiting run. At most five runs wait behind a running one, and an address takes 30 requests a minute.
- **While the host is offline:** through Ramu Link, requests are held for up to a day and delivered when the host reconnects (Plus, or your own service). **If the host was offline** decides how old a held request may be and still run.
- **Requests:** each one is listed with what came of it: started, joined a run, filtered out (and which filter), repeat, too old, bad signature or not run. **Replay** starts a run from one anyway, and **Send test** starts a run from a sample request shaped like the preset expects.

On the phone, webhook schedules can be renamed, edited, paused and run. Their trigger, address and secret are set up on a computer.

## Recaps

Recaps summarize what threads did and what is left. Inbox's Brief lists items that need a decision; **Inbox → Recaps** lists the rest. Mark items done, dismiss or snooze them, with **Undo**. Recaps use model tokens only when something changed. A phone can get one daily "Your daily recap is ready" notification.

## Reviews and undo

A changed-files summary opens the recorded diff. Add comments in **Changes** and send them with your next message. **Undo** (or **Edit → Preview restore** on a message) shows the reverse change before applying it; conflicting files are skipped.
