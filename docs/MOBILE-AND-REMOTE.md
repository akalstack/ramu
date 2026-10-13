# Mobile and remote access proposal

**Not implemented.** The desktop app currently connects only to its local background service.

## Scope

The proposed first milestone is one Ramu desktop controlling another computer through the same account. A later Android/iOS companion would use that host API for chats, questions, files, and reviews.

Each computer owns its repositories, agents, provider credentials, terminals, and database. Choosing another computer would not copy a checkout or move a running agent.

## Proposed stack

- React Native, Expo, and TypeScript for mobile.
- Better Auth with Google/GitHub sign-in and PostgreSQL for account links.
- A managed outbound tunnel for hosts behind NAT.
- Shared TypeScript schemas, transport, replay, and validation; native mobile screens rather than the desktop DOM.

The relay would manage accounts, linked computers, connection setup, and push notifications. Application traffic would travel through the host gateway. Provider login would remain on the host, separate from the Ramu account.

## Host requirements

The existing local socket dispatcher must not be exposed directly over TCP. A remote gateway needs authenticated sessions, allowlisted operations, workspace path checks, size limits, and host-enforced permissions. Remote access must be opt-in and revocable.

Clients need host-qualified IDs, durable event replay, deduplication, stale-write checks, and idempotent mutation handling. File and Git operations must preserve checkout ownership when several clients connect. Offline clients may keep drafts; they must not silently replay destructive actions.

Mobile backgrounding cannot depend on a live socket. Agents continue on the host; notifications link to the owning chat, and foregrounding refreshes state. Sleeping hosts remain unavailable.

A TLS-terminating tunnel may see application traffic. End-to-end encryption is outside this initial proposal; it must not be claimed before implementation and review.

## Delivery order

1. Prove authenticated desktop-to-host access and shared durable chat state.
2. Add mobile chat, questions, read-only files/diffs, and review comments.
3. Add goals, schedules, and selected Git/file operations.
4. Validate revocation, reconnects, sleep/wake, simultaneous clients, and packaged releases.

Cross-account sharing, repository synchronization, cloud-hosted agents, and a full mobile editor are outside the first milestone. Deployment and protocol details remain design work.
