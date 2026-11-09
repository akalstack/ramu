# Background work

The desktop app connects to a local service that owns threads, terminals and schedules. Closing the window leaves them running; reopening reconnects. The host must stay awake. **Settings → Background & updates** controls the service and starting at login.

## Messages while an agent works

Enter uses your Steer or Queue choice; Cmd/Ctrl+Enter uses the other. **Steer** adds your message to the running turn; **Queue** waits for the turn to end. A steered message waits for running tools to finish. To redirect the agent sooner, choose **Stop turn and send now** from a queued message's menu, or tap its send button on the phone: the turn stops, that message starts the next one, and the rest of the queue follows. Agents can ask questions and keep working on independent parts while they wait for your answer.

On the phone, **Settings → Threads** sets the choice, and the warning before changing model, for **All devices** (the host's own setting), **All mobile devices** (every phone paired with that host) or **This phone**. The narrowest one set wins, and the page shows where the current value comes from.

## Background commands

Agents can start a development server, watcher or long test run that keeps going after their reply. It runs on the thread's host, in its checkout; outside Full access you approve each exact command first, and Full access still asks before a command that can destroy work or the machine. Background terminals, above the composer on the desktop and as a pill on the phone, lists the ones still running, with their output and **Stop**; a command leaves it when it ends, and the thread says how it ended.

**Servers**, above the composer on the desktop, lists what the thread's agents, terminals and commands are listening on, such as `localhost:5173 · npm run dev · node`. Click one that serves pages to open it in the browser pane; ⌘-click (Ctrl-click) opens it in your own browser when the host is this device. **Stop** ends that server only. A server started with `nohup` or `&` still shows under the thread that started it, and one that outlived its terminal or agent says so. On the phone, servers are listed with **Stop** under Resources. Ports an agent's own program uses are left out.

Instead of sleeping and checking again, an agent waits on a command: until it exits, prints text it names (such as "ready" or "error"), stops printing for a while, or a time limit passes. The thread shows what came of it, such as **Saw "ready"** or **Background command failed** with the exit code. Stopping the turn ends the wait; stopping the command ends it too, and the agent does not restart a command you stopped.

## Restart recovery

**Continue threads after restart** (on by default) resumes unfinished threads after the service restarts. Finished, failed and stopped threads stay stopped, and queued messages are kept.

## Schedules

Schedules run once, daily, weekly, monthly or every few minutes (at least five). **Run now** runs one immediately; **Pause** stops future runs. Missed runs either run once or are skipped. Each run records how it ended: completed, failed, needs input, cancelled, interrupted or missed. Three failed runs in a row pause the schedule so a broken task stops spending tokens.

The host also follows deployed apps without a schedule: it wakes a thread when a deployment it started, or one of a push or merge from Ramu, finishes ([When a deployment finishes](deploy.md#when-a-deployment-finishes)), and when a store build and its upload finish ([Store releases](deploy.md#store-releases)); it checks each watched live address every five minutes and opens an incident thread when it stops answering ([Uptime](deploy.md#uptime)).

On the phone, **Schedules** opens from the top of the Inbox. With several hosts connected, **Runs on** saves a schedule on another host, and Schedules lists each host's schedules. A schedule always runs on its own host.

### When a request arrives

A schedule can start from a webhook instead of a clock: choose **When a request arrives** as its frequency, then what starts it.

- **Presets:** GitHub (CI failed on a pull request, review comment on a pull request, issue labeled `ramu`), GitLab (pipeline failed), Sentry (new error), Vercel and Netlify (deployment failed), or any request. A preset fills in the filters, what the agent reads, how the sender signs requests, and a first prompt. The deployment presets catch failures of deploys Ramu does not follow itself, such as pushes from a terminal: on Vercel, add a webhook for `deployment.error` under the team's **Settings → Webhooks** and paste the secret Vercel shows on the card; on Netlify, add an outgoing webhook for **Deploy failed** under the site's **Deploy notifications** with the card's secret as its JWS secret token.
- **Address and secret:** the card's **Address and requests** shows where to send requests, one address per address the host has (its [tunnel address](remote-hosts.md#your-own-tunnel) first, then each network address it listens on), and the secret to paste into the sender. **New address** replaces both. For a GitHub preset in a project with a GitHub repository, **Create on…** makes the repository webhook with the right address, secret and events, using the account Ramu already has for that repository; GitHub needs an HTTPS address it can reach from the internet, such as a tunnel address. The webhook is updated on **New address** and removed with the schedule. Sentry and Vercel give you their own secret; paste it on the card.
- **What runs:** a request must carry a valid signature and match every filter (a field such as `body.action` is, is not, starts with, is one of, or is present). The run's thread is titled after the request. Its prompt is the schedule's prompt followed by the fields you chose, fenced as untrusted data the agent is told not to follow. A delivery the sender retries is ignored, and requests about the same subject within two minutes (the same commit, pull request or issue) join one waiting run. At most five runs wait behind a running one, and an address takes 30 requests a minute.
- **Requests:** each one is listed with what came of it: started, joined a run, filtered out (and which filter), repeat, bad signature or not run. **Replay** starts a run from one anyway, and **Send test** starts a run from a sample request shaped like the preset expects. On the phone, a webhook schedule's page lists the same requests with **Replay** and **Send test**; its address and secret are managed on the desktop.

On the phone, webhook schedules can be renamed, edited, paused and run. Their trigger, address and secret are set up on a computer.

## Recaps

Recaps summarize what threads did and what is left. Inbox's Brief lists items that need a decision; **Inbox → Recaps** lists the rest. Mark items done, dismiss or snooze them, with **Undo**. Recaps use model tokens only when something changed. A phone can get one daily "Your daily recap is ready" notification.

## Reviews and undo

A changed-files summary opens the recorded diff. Add comments in **Changes** and send them with your next message. **Undo** (or **Edit → Preview restore** on a message) shows the reverse change before applying it; conflicting files are skipped.
