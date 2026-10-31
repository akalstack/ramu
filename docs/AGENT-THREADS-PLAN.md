# Threads started by agents

Agents already start, follow and message threads on their own host ([Agents and routing](AGENT-ROUTING.md#threads-started-by-agents)). One Home prompt also starts several reviewed threads across projects and hosts ([One prompt, several threads](AGENT-ROUTING.md#one-prompt-several-threads)). What remains: agents starting threads on another paired host. Remove work as it lands, document shipped behavior in the feature guides, and delete this plan when implementation and acceptance are finished.

## The need

Someone working in one thread often finds work that belongs elsewhere: a follow-up in the same repository, a matching change in the API project, or tests that only run on the Linux box. Today they stop, open a new thread, choose the project, host and checkout, rewrite the context, then come back and check on it. Agents can start only helpers (`ramu_agent`) that report to the current thread. They cannot start a thread the person owns, reach another project or use another host.

**Easier for the person:** one sentence ("start a thread in the API project to add the field", "run the full suite on my Linux box") replaces five manual steps. The new thread gets a written brief, so nothing is retyped. The result comes back to the thread that asked, and both threads link to each other.

## T3 Code reference and intended improvements

Observed through T3 Code's agent tool surface (server 0.1.5, 2026-11-01), not its source. These are design inputs, not claims about how T3 implements them.

| T3 Code                                                                                                                                                                                                                                            | Ramu approach                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `delegatedFrom {environmentId, threadId, title}` records provenance across machines. `t3_thread_wait`, `t3_thread_read` and `t3_thread_send` follow up.                                                                                                             | Provenance is visible to the person in both directions: **Started from ‹thread›** on the new thread and a card in the caller's transcript. When the new thread finishes or waits for input, a short report goes back to the caller, as PR-watch feedback does today ([Pull requests](PULL-REQUESTS.md#watch-in-a-thread)).              |
| Linked environments: every tool accepts `environmentId`. An unlinked machine named in words ("my vps") starts linking from that hint, without a code in chat.                                                                                      | Hosts link through **host-to-host pairing**: one host pairs as a device of another with a scoped role, approved at the target with the existing number match. An agent may request pairing; only a person completes it. Revoke stops everything at once.                                                                                    |

## Naming

- Product copy keeps **thread**, **project**, **host** and **pair** ([Architecture](ARCHITECTURE.md)). T3's "environment" is Ramu's host and "link" is Ramu's pair.
- `thread_start`, `thread_status`, `thread_message`, `project_list` and `ramu_agent` each gain an optional `host`.

## Delivery

### Other hosts

- **Host-to-host pairing.** `ramu pair` and **Settings → Remote access → Pair a device** accept a host as the paired device, through the same `POST /pair` and number match. New role permission **Start threads** (off for existing devices) beside computer use, browser, terminals and settings. The pairing token is stored in `credentials/` on the requesting host, never in preferences.
- **Agent requests, person approves.** Naming an unpaired host ("my vps") resolves against discovered and named hosts. The caller's thread shows **Pair with ‹host›**, and the target shows its usual request with the six-digit number. The agent's turn continues and is told pairing is pending.
- **Remote threads.** The agent-thread tools and `ramu_agent` with `host` call the target over one `RuntimeSocket` per paired host, with an `operationKey` so a retried start runs once. Provenance names both hosts. If the target is offline, the card shows **Waiting for ‹host›** and the start is kept for 24 hours, then fails visibly with **Try again**. `bringChanges` sends the patch only within the existing upload bounds.
- Update [Security](../SECURITY.md), [Headless server](HEADLESS-SERVER.md) and the roadmap's **Preference sync** note, which says hosts never talk to each other. Credentials and settings still never sync between hosts.

### Later options

Kept out of this delivery: fork or merge back a thread's full context, scheduled starts on another host (schedules already start threads locally), and starting threads from the phone's own agent picker.

## Services to extend

`background/agentThreads.ts` for starts, briefs, links and reports; `remote/devices.ts`, `remote/pairingRequests.ts`, `remote/permissionRequests.ts` and `packages/client-runtime` for host-to-host calls; the existing permission card for approvals.

## Acceptance

- With two hosts: an agent asks to use an unpaired host, the person allows it at the target with matching numbers, and the thread runs there. Revoking stops it within the heartbeat. A viewer-role pairing cannot start threads.
- With the laptop app closed, a headless host starts a thread on another headless host. Taking the target offline shows **Waiting for ‹host›** and resumes when it returns.
- Representative task: from one thread, change an API in one project, update its client in another and run the suite on a second host, without opening a new thread or retyping context by hand.

Tests: client-runtime tests for host-to-host pairing and retried starts. Desktop changes run `pnpm build` then `pnpm test:desktop-smoke`. Two-host and phone checks stay open under [Acceptance](ROADMAP.md#acceptance) until run.
