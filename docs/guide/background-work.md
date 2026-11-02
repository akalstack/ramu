# Background work

The desktop app connects to a local service that owns threads, terminals and schedules. Closing the window leaves them running; reopening reconnects. The host must stay awake. **Settings → Background & updates** controls the service and starting at login.

## Messages while an agent works

Enter uses your Steer or Queue choice; Cmd/Ctrl+Enter uses the other. **Steer** adds your message to the running turn; **Queue** waits for the turn to end. Agents can ask questions and keep working on independent parts while they wait for your answer.

## Restart recovery

**Continue threads after restart** (on by default) resumes unfinished threads after the service restarts. Finished, failed and stopped threads stay stopped, and queued messages are kept.

## Schedules

Schedules run once, daily, weekly, monthly or every few minutes (at least five). **Run now** runs one immediately; **Pause** stops future runs. Missed runs either run once or are skipped. Each run records how it ended: completed, failed, needs input, cancelled, interrupted or missed. Three failed runs in a row pause the schedule so a broken task stops spending tokens.

With several hosts connected, **Runs on** saves a schedule on another host, and Schedules lists each host's schedules. A schedule always runs on its own host.

## Recaps

Recaps summarize what threads did and what is left. Inbox's Brief lists items that need a decision; **Inbox → Recaps** lists the rest. Mark items done, dismiss or snooze them, with **Undo**. Recaps use model tokens only when something changed. A phone can get one daily "Your daily recap is ready" notification.

## Reviews and undo

A changed-files summary opens the recorded diff. Add comments in **Changes** and send them with your next message. **Undo** (or **Edit → Preview restore** on a message) shows the reverse change before applying it; conflicting files are skipped.
