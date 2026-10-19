# Remote access hardening plan

Remaining work after the server access-boundary changes. Current policy and configuration are documented in [Security](../SECURITY.md#remote-access).

## Smallest usable delivery

A person pairs a device with a clear access role, uses its permitted thread actions, and can recover an expired or changed connection through existing host/device settings. Deliver renewal, viewer controls and native transport independently where their prerequisites permit; transport protections remain release gates. Explain connection/access problems with a concrete next action rather than proof/token terminology. Optional client-key evaluation must demonstrate a benefit before becoming implementation scope or adding user controls. Follow the [root product and planning guidance](../AGENTS.md#product-design-and-architecture) for this and later increments.

## Ramu design and architecture

Follow [Architecture](ARCHITECTURE.md) and [UI](UI.md). Extend existing `remote/` authentication, pairing, device records and access allowlists; keep renewal inside the established client/runtime transport instead of a second session system. Server protocol/capability changes use `packages/contracts` and current validated RPC/event paths. Native iOS/Android transport adapters belong in mobile; Electron/native dependencies must not enter the headless server or pure shared code. Add lifetime/role controls to existing host Settings/device rows with composed app controls and native mobile patterns, semantic tokens, localization and accessible explanations. Hiding a viewer action supplements server authorization, never replaces it.

## Plan

1. **Rotating renewal.** Inactive device credentials now expire after 90 days by default, configurable through `RAMU_DEVICE_TOKEN_DAYS` (`never` is explicit). Active use extends expiry with the existing credential. Implement rotating renewal with durable client acknowledgement and bounded overlap before claiming secret rotation; handle lost responses, concurrent SSE/invoke requests and revoked predecessors. Legacy shared-token authentication is opt-in with `RAMU_ALLOW_LEGACY_TOKEN=1`. Add host UI for choosing token lifetime; expiry is already displayed.
2. **Viewer client experience.** The host binds owner/viewer access to pairing codes, enforces an explicit viewer RPC allowlist, and offers role selection in Settings/CLI. Desktop's message composer now hides sending on a viewer host and explains why; extend the same `background.status` `access` signal to other desktop write actions (terminals, file edits, task creation) and to mobile. Verify all viewer thread/input hydration paths; permitted approval answers can authorize execution by the existing agent. Do not market this role as untrusted public sharing.
3. **Mobile transport.** Replace blanket `NSAllowsArbitraryLoads` with an implemented native transport policy for explicitly approved hosts. Pin certificate fingerprints at HTTPS pairing, verify both fetch and SSE transports, and require review when a certificate changes. A dynamic host exception cannot be implemented securely by changing JavaScript URL checks alone.
4. **Acceptance.** Verify expiry/re-pairing, live stream revocation, viewer request answers and full-access clients on paired desktop/iOS/Android devices. Signing/distribution still requires this native transport work.

## T3 Code reference and additional hardening

Use T3 Code as a reference at [`9c161462c94f7d9d6d9169da5c841457cbadf213`](https://github.com/pingdotgg/t3code/tree/9c161462c94f7d9d6d9169da5c841457cbadf213), inspected on 2026-10-18. Its [token exchange](https://github.com/pingdotgg/t3code/blob/9c161462c94f7d9d6d9169da5c841457cbadf213/apps/server/src/auth/http.ts) can bind an access token to a client proof key; its [authentication service](https://github.com/pingdotgg/t3code/blob/9c161462c94f7d9d6d9169da5c841457cbadf213/apps/server/src/auth/EnvironmentAuth.ts) verifies proof-bound requests. This is source evidence of optional proof-bound authentication, not a claim that every T3 connection uses it or rotates its direct-pairing credential.

- **Client-key-bound credential evaluation.** After the existing transport/renewal work, evaluate whether proof-bound device credentials materially reduce bearer-token theft risk in Ramu. Prototype through the existing `remote/` device/auth boundary and versioned contracts, with keys in device-owned secure storage and signing in Electron main/mobile native adapters. Evaluate a standard proof mechanism such as DPoP, including method/URL/token binding, replay protection, clock skew, proxies, key loss and revocation across invoke/fetch and SSE connection establishment. A client proof key authenticates the client; it does not authenticate a discovered host or replace TLS/certificate checks. Record compatibility, storage and recovery evidence before committing to rollout; do not import T3's session architecture or make this evaluation a prerequisite for initial discovery. If adopted, define negotiated capability support and an explicit legacy-device migration without silent downgrade of proof-bound grants.
- **Pairing and route boundary.** Implement offer cancellation, exact completion, verified stable host identity, safe re-pairing and route-specific credential/transport policy in the [host discovery and pairing plan](HOST-DISCOVERY-PLAN.md#t3-code-reference-and-pairing-enhancements). Preserve Ramu's owner/viewer server allowlists and local administration boundaries. Coordinate identity/key-change review with native certificate handling; neither discovered identifiers nor client-key proofs justify sending stored credentials to an unverified endpoint.

HTTP tests now cover pairing success, expired/reused/evicted codes, retry backoff/429, revocation on invoke/events, role escalation attempts and browser-origin restrictions through the production authentication boundary. Browser CORS requires an exact `RAMU_BROWSER_ORIGINS` allowlist; no wildcard is emitted.

## Out of scope

A relay and end-to-end encryption are larger designs. Revisit them only after steps 1–4, since they change the protocol.

## Verification

Keep renewal and viewer regression tests in `apps/server/test`; add native transport tests and per-host exception tests in `apps/mobile/test`. If client-key binding is adopted, cover replay, wrong key/method/URL/token, skew, reconnect, revocation, key loss and downgrade rejection with server/client adapter tests. Run tests and types scoped to every touched package, including `pnpm --filter @ramu/server test` and `pnpm --filter @ramu/mobile test`. Desktop-facing implementation also requires `pnpm build` followed by the existing `pnpm test:desktop-smoke`.
