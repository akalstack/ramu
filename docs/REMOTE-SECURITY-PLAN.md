# Remote access hardening plan

Review of pairing and remote access (`apps/server/src/remote`, `apps/server/src/index.ts`, `apps/mobile`, `packages/client-runtime`), 2026-10-17, made from the code and docs. Nothing here is implemented yet.

A paired device can run terminals and agents with the host's provider credentials. Remote access is the most powerful and least hardened part of Ramu, so it comes first among the plans from this review.

## What is already good

- Pairing codes are single-use, expire in 10 minutes, are limited to 5 pending, and only their SHA-256 hash is stored.
- Each device has its own 256-bit token, stored only as a hash in a `0600` file. Revocation applies without a restart.
- Per-IP rate limiting with backoff covers `/pair` and token failures.
- A non-loopback `--listen` is refused without TLS or `--private-network`.

## Findings

Ordered by impact.

1. **Device tokens never expire.** There is no rotation or refresh; a lost phone stays valid until someone revokes it by hand. A legacy shared token also keeps working in parallel and does not expire.
2. **Every paired device is fully privileged.** There is no read-only or scoped role. A phone used only to approve requests can still open a terminal.
3. **Weak transport posture on mobile.** `apps/mobile/app.json` sets `NSAllowsArbitraryLoads: true`, there is no certificate pinning, and a self-signed or private-CA host has no special handling. Plain HTTP pairing is gated only by a consent prompt.
4. **Broad CORS.** Remote responses send `Access-Control-Allow-Origin: *`. Bearer auth limits the risk, but nothing needs a wildcard.
5. **Security docs say nothing about remote access.** `SECURITY.md` is 9 lines and never mentions pairing; the one warning about paired-device power lives in `docs/HEADLESS-SERVER.md` and CLI help.
6. **Test gaps.** `devices.test.ts` covers the store, but nothing exercises the `/pair` HTTP route, the rate limiter, or the 429 path.
7. **No relay and no end-to-end encryption.** Documented and deliberate, so this is a product limit, not a defect. It does mean security rests on the user's network.

## Plan

Do steps 1–3 before any wider mobile distribution.

1. **Document it.** Add a "Remote access" section to `SECURITY.md`: what a paired device can do, what to expose, how to revoke, and that tokens do not expire yet. Link it from the mobile README pairing step. Small and independent of the rest.
2. **Token lifetime.** Give device tokens an optional expiry (default 90 days, configurable, "never" allowed) and show it in `ramu devices` and Settings. Add silent renewal on use, so active devices do not need re-pairing, with the renewed token returned over the authenticated channel. Retire the legacy shared token behind a flag, off by default for new data directories.
3. **Test the pairing surface.** Cover `/pair` success, expired and reused codes, the pending-code cap, the rate limiter and its 429 path, and revoked-token rejection on both `/invoke` and `/events`.
4. **Device roles.** Add a `viewer` role that can read threads and answer permission and question requests but not run terminals, edit files, change settings, or start agents. Choose the role at pairing; enforce it in the `/invoke` method table, not in the clients.
5. **Mobile transport.** Replace the blanket `NSAllowsArbitraryLoads` with per-host exceptions for hosts the user explicitly approved. Pin the certificate fingerprint at pairing for HTTPS hosts and warn when it changes.
6. **Tighten CORS.** Drop the wildcard unless a browser client is explicitly enabled, and restrict origins when it is.

## Out of scope

A relay and end-to-end encryption are larger designs. Revisit them only after steps 1–4, since they change the protocol.

## Verification

Unit tests for steps 2–4 in `apps/server/test`; a mobile test for the per-host exception in `apps/mobile/test`. Run `pnpm --filter @ramu/server test` and `pnpm --filter @ramu/mobile test`.
