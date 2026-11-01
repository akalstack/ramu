# Host pairing security review

A checklist for a person reviewing host-to-host pairing. Delete this file when the review is finished and its findings are fixed or recorded. Behavior is described in [Security](../SECURITY.md#remote-access) and [Agents and routing](AGENT-ROUTING.md#threads-on-another-host).

Host A's agents start threads on host B. A pairs with B using a one-time code from B and becomes a `host` device there.

## What changed in the trust model

Hosts used to be isolated: only people's devices paired with them. Now a host can hold a credential for another host, and an agent can cause work on another machine without a person at that machine, after a person at A approves each start.

## Code to read

- `apps/server/src/remote/access.ts`: `HOST_METHODS`, `deviceMayInvoke`, and `POST /pair`, where the client declares `kind`.
- `apps/server/src/remote/devices.ts`: `spend`, `allows`, `setMaxAccess`.
- `apps/server/src/remote/socket.ts`: host devices are forced to calls-only.
- `apps/server/src/index.ts`: the `hostThreads.*` branch of `performInvoke`.
- `apps/server/src/background/agentThreads.ts`: `startForHost`, `settingsForHost`, `statusForHost`, `messageForHost`, `projectsForHost`.
- `apps/server/src/background/remoteThreads.ts` and `apps/server/src/remote/agentHosts.ts`: the calling side and token storage.

## Questions to answer

1. **Scope:** can a `host` device reach any method outside `HOST_METHODS`, including through retries, `operationKey` or the socket's other frames?
2. **Prompt injection:** A's agent writes the prompt B's agent runs, up to B's ceiling. If A's agent is compromised, what can it do on B at Allow edits, at Auto and at Full access? Is Allow edits the right default, and should raising the ceiling warn?
3. **Reading back:** `hostThreads.status` returns the latest reply of threads the pairing started, so a B thread can pass file contents back to A. Is that acceptable at every ceiling?
4. **Reports into A:** reports and messages from B reach A's agent as queued user messages, labelled as not coming from the person. Is the label enough when B is less trusted than A?
5. **Approval on A:** a person approves every remote start, but later `thread_message` calls to a started thread need no approval. Is the hourly limit of 20 enough?
6. **Approval on B:** nobody at B approves individual starts. Does B's person need a visible log or notification beyond the thread's origin label?
7. **Limits:** 2 levels of depth, 8 threads and 20 messages per hour per pairing. The message count is in memory and resets when B restarts. Is that acceptable?
8. **Origin labels:** `from.host` and `from.thread` are chosen by A and shown on B as fact. Should B show the pairing's own device name instead?
9. **Credentials:** the token is in the OS credential store on A, hashed on B, and sent as a bearer token. Plain HTTP is possible with `--private-network`. Should host pairing require TLS or a private network?
10. **Revocation:** revoking on B stops new calls, but threads already running on B keep running. Should revoking offer to stop them?
11. **Headless hosts:** `ramu hosts add` needs an unlocked credential store. What happens on a headless Linux host with none?

## Found and fixed while writing this

- A view-only pairing code could be redeemed as a host pairing, which can start threads. View-only codes now refuse.
- A paired host could choose B's provider account and speed tier. Both are now B's.
- A vague project name made B spend a model call on routing. Host requests now need an exact project name or id.
