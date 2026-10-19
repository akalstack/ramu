# Improvements beyond the implementation plans

This guide records additional design decisions and their evidence. Unfinished acceptance remains in the relevant plan or roadmap.

## Remote authentication resource limits

The pairing failure tracker now expires inactive peer entries after fifteen minutes, caps its size at 4,096 peers and bounds the backoff exponent. Previously, untrusted peer addresses could grow the in-memory tracker indefinitely. Rejected attempts return `Retry-After` so clients can respect the actual backoff. Pairing responses use `Cache-Control: no-store` because they contain a bearer credential.

Roles belong to the host-created one-time code. A device cannot request a more powerful role by changing its pairing payload. Viewer permissions use an explicit method allowlist; new RPC methods default to denied for viewers. HTTP tests exercise pairing, revocation, backoff, role escalation attempts and browser-origin rejection through the same authentication boundary used by the server.

## Active-device expiry

Device expiry currently slides on authenticated use, retaining the same hashed bearer credential. This avoids a lost token-renewal response stranding desktop and mobile clients. It limits inactive-device lifetime, but does not rotate the credential: safe rotating renewal with durable client acknowledgement remains in the security plan. Revocation remains immediate, including open event streams.

## Conservative recovery and read boundaries

Worktree setup records branch ownership independently of filesystem setup. A retry refuses an unrelated branch instead of adopting it merely because its name matches. Base commits stay fixed even if the source branch moves after creation. The existing partial-setup test now injects its failure after authoritative allocation; preview paths are advisory.

Explorer has a read-only binding resolver for standalone threads: opening a file browser never allocates the working folder for an unsent/unstarted task. A bounded directory RPC stops enumeration at 2,000 visible entries and reports truncation, while the desktop's existing full-directory API retains its contract. The existing file viewer is shared with Home browsing instead of duplicating preview implementations.

## Helper lifecycle and request reuse

Helper progress now has an explicit resume marker. A delayed running update cannot silently resurrect a completed helper, and resuming at the same clock millisecond receives a monotonic timestamp. Resume starts a fresh elapsed clock instead of retaining the previous completion time. The server rechecks helper action capabilities, and independently owned helpers remain actionable while their parent is idle.

Mobile request rendering now uses the shared permission-outcome fold, including providers that reuse a request ID after restarting. The activity sheet and Inbox reuse the actual transcript request cards and draft keys. Their offline state does not mount answer controls, and limit-retry actions also check connectivity. This avoids introducing another approval or delivery path while making the same requests reachable in more places.

Forwarded child requests also receive a bounded, deterministic parent-visible ID derived from parent session, child session and native request ID. Two helpers using the same provider request ID can no longer overwrite each other's answer route. Server-authored origins retain the original provider ID so replies, drafts and closure events translate correctly, including after the in-memory map is rebuilt. Routing rejects requests addressed through an unrelated parent; regression tests cover duplicate native IDs, saved-origin restoration and cross-parent rejection.

Helper launch lookup and mobile helper-log grouping now build indexes in one event pass. This removes repeated full-log searches and an unused accumulating text map while preserving the existing output. It is a reduction in repeated work, not a claim about measured device performance; the long-thread acceptance remains open.

## Naming without blocking allocation

Branch naming happens before taking the shared workspace allocation lock. A slow provider therefore does not block unrelated current-checkout creation. Concurrent attempts with the same creation request ID share one inference and allocation; a completed retry returns its persisted task before contacting the model. Git integration tests hold one inference open while creating another thread, then verify duplicate delivery and persistent fallback reporting.

Generated names and directory names are independent. A complete generated semantic/custom name never receives the fixed namespace. Pending bindings and Git refs still reserve branches; generated collisions receive bounded suffixes, while explicitly edited names fail visibly instead of being silently rewritten. Cancellation is registered before asynchronous project checks, so an edit or closed draft can cancel even during validation. Focused tests cover this race, manual-edit precedence, changed prompts, sending and unmount.
