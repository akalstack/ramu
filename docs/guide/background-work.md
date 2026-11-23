# Background work

The desktop app connects to a local service that owns threads, terminals and schedules. Closing the window leaves them running, and reopening reconnects. The host must stay awake. **Settings → Background** controls the service and starting at login. Updates are under **Settings → About**.

**Keep running when Ramu closes** is on by default. Turned off, the service runs only while the app is open: quitting Ramu stops it, so running threads stop, schedules wait and paired devices can't connect until you open Ramu again. **Start at login** needs it on, and turning it off turns starting at login off too.

The command palette (Cmd/Ctrl+Shift+P, or `>` in Cmd/Ctrl+P) offers **Reload window**, **Reload window and background service**, and **Restart background service**, which leaves the window as it is and reconnects it. Restarting the service asks first, since it stops running agents; unfinished threads resume when restart recovery is on.

## Messages while an agent works

Enter uses your Steer or Queue choice, and Cmd/Ctrl+Enter uses the other. **Steer** adds your message to the running turn. **Queue** waits for the turn to end. A steered message waits for running tools to finish. To redirect the agent sooner, choose **Stop turn and send now** from a queued message's menu, or tap its send button on the phone. The turn stops, that message starts the next one, and the rest of the queue follows. Agents can ask questions and keep working on independent parts while they wait for your answer.

On the phone, **Settings → Threads** sets the choice, and the warning before changing model, for **All devices** (the host's own setting), **All mobile devices** (every phone paired with that host) or **This phone**. The narrowest one set wins, and the page shows where the current value comes from.

## Background commands

Agents can start a development server, watcher or long test run that keeps going after their reply. It runs on the thread's host, in its checkout. Outside Full access you approve each exact command first, and Full access still asks before a command that can destroy work or the machine.

**Background terminals** (above the composer on the desktop, a pill on the phone) lists the ones still running, with their output and **Stop**. A command leaves the list when it ends, and the thread says how it ended. A Claude command still running after the **Move slow commands to background** time, or one Claude moved to the background itself, is listed there too, marked **Moved to the background**.

**Servers**, above the composer on the desktop, lists what the thread's agents, terminals and commands are listening on, such as `localhost:5173 · npm run dev · node`. Click one that serves pages to open it in the browser pane. ⌘-click (Ctrl-click) opens it in your own browser when the host is this device. **Stop** ends that server only. A server started with `nohup` or `&` still shows under the thread that started it, and one that outlived its terminal or agent says so. On the phone, a **Servers** pill above the composer opens the same list: tap a server that serves pages to open it in the thread's browser on the host, or **Stop** it. Resources lists every thread's servers too. Ports used by an agent's own program are left out.

Instead of sleeping and checking again, an agent waits on a command until it exits, prints text it names (such as "ready" or "error"), stops printing for a while, or a time limit passes. The thread shows the result, such as **Saw "ready"** or **Background command failed** with the exit code. Stopping the turn or the command ends the wait, and the agent doesn't restart a command you stopped.

## Restart recovery

**Continue threads after restart** (on by default) resumes unfinished threads after the service restarts. Finished, failed and stopped threads stay stopped, and queued messages are kept.

## Schedules

Schedules run once, daily, weekly, monthly or every few minutes (at least five). **Run now** runs one immediately, and **Pause** stops future runs. Missed runs either run once or are skipped. Each run records how it ended: completed, failed, needs input, cancelled, interrupted or missed. Three failed runs in a row pause the schedule, so a broken task stops spending tokens.

The host also follows deployed apps without a schedule. After a push or merge from a thread, it wakes that thread once when the checks on the commit (platform deploys included) finish ([After a push](deploy.md#after-a-push)). It checks each watched live address every five minutes and opens an incident thread when it stops answering ([Live address and uptime](deploy.md#live-address-and-uptime)).

On the phone, **Schedules** opens from the top of the Inbox. With several hosts connected, **Runs on** saves a schedule on another host, and Schedules lists each host's schedules. A schedule always runs on its own host.

### When a request arrives

A schedule can start from a webhook instead of a clock. Choose **When a request arrives** as its frequency, then what starts it.

- **Presets:** GitHub (CI failed on a pull request, review comment on a pull request, issue labeled `ramu`), GitLab (pipeline failed), Sentry (new error), or any request. A preset fills in the filters, what the agent reads, how the sender signs requests, and a first prompt.
- **Address and secret:** the card's **Address and requests** shows where to send requests and the secret to paste into the sender. There is one address per address the host has: its [tunnel address](remote-hosts.md#your-own-tunnel) first, then each network address it listens on. **New address** replaces both. For a GitHub preset in a project with a GitHub repository, **Create on…** makes the repository webhook with the right address, secret and events, using the account Ramu already has for that repository. GitHub needs an HTTPS address it can reach from the internet, such as a tunnel address. The webhook is updated on **New address** and removed with the schedule. Sentry gives you its own secret, so paste it on the card.
- **What runs:** a request must carry a valid signature and match every filter (a field such as `body.action` is, is not, starts with, is one of, or is present). The run's thread is titled after the request. Its prompt is the schedule's prompt followed by the fields you chose, fenced as untrusted data the agent is told not to follow. A delivery the sender retries is ignored, and requests about the same subject (the same commit, pull request or issue) within two minutes join one waiting run. At most five runs wait behind a running one, and an address takes 30 requests a minute.
- **Requests:** each one is listed with its outcome: started, joined a run, filtered out (and which filter), repeat, bad signature or not run. **Replay** starts a run from one anyway, and **Send test** starts a run from a sample request shaped the way the preset expects.

On the phone, webhook schedules can be renamed, edited, paused and run, and a webhook schedule's page lists its requests with **Replay** and **Send test**. The trigger, address and secret are set up on a computer.

## Recaps

[Recaps](inbox.md#recaps-learned-and-completed) summarize what threads did and what is left. Inbox's Brief lists items that need a decision, and **Inbox → Recaps** lists the rest. Recaps use model tokens only when something changed. A phone can get one daily "Your daily recap is ready" notification.

## Reviews and undo

A changed-files summary opens the recorded diff. Add comments in **Changes** and send them with your next message. **Undo** (or **Edit → Preview restore** on a message) shows the reverse change before applying it. Conflicting files are skipped.
