# Remaining work

Track unfinished implementation, acceptance and release prerequisites here. Follow the [planning guidance](../AGENTS.md#planning-docs): keep current behavior in feature guides, remove finished items and delete plans with no remaining delivery.

## Feature work

Plans separate missing implementation, required acceptance and optional later scope. Written code and automated checks do not establish live-provider or native-device acceptance.

### Implementation remaining and related acceptance

- [Client–server communication](COMMUNICATION-PLAN.md): finish transport integration of bounded replay/snapshot recovery, resource subscriptions and terminal flow control; verify the opt-in mobile WebSocket adapter on devices; measure the HTTP/SSE and WebSocket alternatives before choosing defaults. The Node WebSocket call path is opt-in, not the default event transport.
- [Background terminal management](BACKGROUND-TERMINALS-PLAN.md): native Claude/Codex/OpenCode/Cursor command handles are unstarted and require verified owner lifecycle contracts; the ACP client-terminal boundary is written but enabled for no provider until one is verified. Managed-command permissions, removal/recovery, native interaction and platform termination still need acceptance.
- [Agent setup](AGENT-SETUP-PLAN.md): extend skill provenance/discovery, compatibility and owned-link lifecycle; finish adapter-specific rule delivery and capability-gated activation. Validate effective setup across account/provider switches, helpers and recovery.
- [Shared MCP](MCP-MANAGEMENT-PLAN.md): finish and validate provider-session integration, external-tool trust boundaries, credential provisioning, approval/authentication recovery and account-switch readiness. Require live two-provider service acceptance and packaged/headless secret-store checks before claiming shared access works end to end.
- [Mobile settings preferences](MOBILE-SETTINGS-PLAN.md): establish cross-host profile/account synchronization, extend supported preference fields and validate inheritance, concurrent/offline changes and migration. Existing paired-host layers do not provide person-wide synchronization.
- [Model selection preferences](MODEL-SELECTION-PLAN.md): cross-host sharing remains undesigned; extend preference fields only for demonstrated needs. Validate generated defaults, flow switching, unavailable selections, inheritance and recovery on native clients.
- [Themes](AI-THEMES-PLAN.md): finish the specialized/shared-control audit and remaining production state coverage. Validate remaining native, accessibility, sharing and appearance behavior; do not treat manual/AI theme creation as unstarted work.
- [Explorer](EXPLORER-PLAN.md): finish desktop Home/project coherence and directory/search race coverage, plus remaining capability-aware file-management work. Validate native scope selection, file actions, draft insertion, restoration, continuation, selected-path reveal and watcher disposal.
- [Thread activity](THREAD-ACTIVITY-PLAN.md): finish historical turn membership and native helper transcript/child-navigation behavior where supported. Validate waiting transitions, restored caches, exact child identity, two-host recovery and accessibility.
- [Thread state visibility](THREAD-STATE-PLAN.md): shared summaries, desktop popovers, mobile labels and completion/notification consistency remain partial or pending validation. Finish the named gaps and verify stale snapshots, exact request actions, old hosts and two-host/native behavior.
- [Thread titles](THREAD-TITLES-PLAN.md): verify and enable a provider-title integration; native explicit regeneration remains unimplemented. Validate provider/fallback races, naming quality, refinement, tool restrictions and packaged/native synchronization.
- [Remote security](REMOTE-SECURITY-PLAN.md): remaining viewer write-surface controls (native certificate pinning is deferred, see the plan). Validate rotating renewal, expiry/re-pairing, revocation and role hydration on paired devices; see [Security](#security).

### Written behavior with acceptance remaining

These plans contain written implementation or audit foundations; fixes remain possible when acceptance exposes a gap.

- [Assistant workflow](ASSISTANT-WORKFLOW-PLAN.md): native acceptance and held-out evaluation of Auto/manual project routing, changed-decision memory retrieval/source links, targeted verification/recovery and Inbox audits, and live PR-watch acceptance.
- [Plan usage visibility](#plan-usage-acceptance): provider/account identity, refresh, routing and native accessibility.
- [Browser](BROWSER-PLAN.md): packaged session import with real macOS keychain/Linux keyring, native transfers and profile lifecycle, provider capability/suppression negotiation, and remote/mobile collaborative control. Written browser behavior and automated checks do not establish native or live-provider acceptance.
- [Computer use](COMPUTER-USE-PLAN.md): signed packaged permission identity, live image delivery per provider, a real two-computer broker run, phone WebRTC, takeover/local-input pause, IME/scaling and the representative cross-device task.
- [Workspace defaults and naming](WORKSPACE-DEFAULTS-PLAN.md): all-entry-point and concurrent-client acceptance of branch-name drafts, frozen outbox bases, lost acknowledgements, shared labels, offline recovery and abrupt process termination.
- [Microphone and composer suggestions](VOICE-INPUT-PLAN.md): written desktop/mobile speech adapters need real-device/package verification of local recognition, permissions, language readiness and protected draft insertion; finish the native keyboard/contextual-picker parity audit and any demonstrated gaps.
- [Git hosting integrations](GIT-INTEGRATIONS-PLAN.md): GitHub adapter/account/watch/clone/publish behavior needs live token, Enterprise, locked headless store, recovery and native interaction acceptance. GitLab, Bitbucket Cloud and Azure DevOps remain informational Coming soon rows.
- [Configuration files](#configuration-acceptance): packaged configuration, external edits, migration and native recovery.
- [Automatic host discovery and pairing](HOST-DISCOVERY-PLAN.md): device/package acceptance of Nearby hosts, verified identity and routes, address review, re-pairing, offer lifecycle and exact completion/storage recovery, including blocked multicast.
- [Provider compatibility](PROVIDER-COMPATIBILITY-PLAN.md): extend evidence beyond the recorded exact Codex, Claude and OpenCode runtime probes; reproduce an older-version mismatch, probe OpenCode ACP and resolve Cursor/Antigravity prerequisites. Validate launch coverage, mobile presentation and native recovery; the tested rules are listed in the plan.

## Configuration acceptance

Current behavior is in [Configuration files](CONFIGURATION.md). A person must be able to identify the repository supplying a default, fix invalid configuration and start a thread without losing a reviewed draft or granting repository content extra authority.

- Verify repository model-default startup, file watching and recovery in packaged builds on supported platforms. Earlier development-build, smoke and watcher checks do not establish packaged acceptance.
- Verify Settings, source/error indicators, shortcuts, screen readers and large text on desktop and physical iOS/Android. Include same-named projects on different hosts, unavailable providers and offline recovery. External global settings edits must update connected clients and background services.
- Upgrade real profiles and exercise corruption and abrupt termination. Preserve SQLite migration/archive retention, atomic-renaming and failed/abandoned-write regression coverage; validate filesystem recovery separately.

## Plan usage acceptance

Current behavior is in [UI](UI.md#plan-usage-detail). Before sending, a person must see whether the next message can run and reach the correct account or existing limit action.

- Verify additional provider model identities, model-specific allowance windows, account matching and event-driven refresh with live providers. Preserve unknown/stale/reset-past readings, notice-only holds and all allowance windows; never sum across hosts or replace missing data with zero.
- On real paired hosts, verify account refresh failure/retry, host changes, old-host fallback, network loss and upgrades. Check authoritative next-message labels for switch, held, stays and unknown routes; an older host's local estimate must remain distinguishable.
- On physical iOS/Android, verify Threads summary discovery, sheet dismissal, selected-host preservation in Access & Fallback, localized offline/reset copy, icon-only header action and per-provider counts. Include keyboard/composer fit, large text, touch targets, VoiceOver/TalkBack and visible limit notices when passive usage is hidden.
- Retain shared account/window and mobile sheet/routing regression coverage, including disabled providers, invalid percentages, ties and visibility preferences. Extend tests only for gaps found during acceptance.

## Interactive Content acceptance

The [implemented contract](INTERACTIVE-CONTENT.md) covers publication, immutable revision browsing, named scenarios, explicitly compatible scenario copying, selected-value drafts and desktop/mobile export. Remaining implementation and evidence:

- Run representative calculators, branching walkthroughs, comparisons and a new subject through live provider sessions on desktop, iOS and Android; include reconnect/restart and offline cached reopening. Direct/deferred MCP publication and synthetic desktop interaction already have automated evidence; they do not replace live-provider/native acceptance.
- On real iOS/Android devices, verify gestures versus feed scrolling, expansion/close, offscreen and screen-focus lifecycle, selection/keyboard, VoiceOver/TalkBack, Android back, large text, appearance, reduced motion, scenario copies, automatic card visibility/recovery, project Code navigation and HTML/source sharing.
- Verify native WebView navigation, private-address/redirect egress denial, credential isolation, stale/forged bridge messages and renderer process termination. The browser companion deliberately keeps static viewing until an independent document origin is available.
- Observe script loops and platform CPU/memory behavior. Up to three isolated desktop frames and bounded persisted state are not hard CPU quotas; determine additional containment from actual platform evidence.
- Compare matched tasks before claiming an advantage over another application. Record environment, task, output and failures; source inspection or a single successful demo does not establish general superiority.

## Release and mobile

- [Distribution](DISTRIBUTION-PLAN.md): macOS signing/notarization and CI wiring, signed auto-updates, clean Linux GUI acceptance, a Windows support decision, and mobile distribution.
- [Mobile roadmap](../apps/mobile/PLAN.md): advanced input parity, terminal customization, linked feature acceptance and device performance measurements. Inbox inline answers already exist; verify their native recovery rather than treating them as unimplemented.
- [Mobile acceptance](../apps/mobile/VERIFICATION.md): physical iOS/Android, push and Live Activity delivery, keyboard/IME, accessibility and usage-limit controls. Credentials and provisioned devices are required for parts of this work.

## Host and provider acceptance

Automated checks establish only the behavior and environments they exercised. These additional acceptance checks remain:

- Measure memory, CPU and event volume with two and three paired hosts, including one streaming heavily. Check fairness and responsiveness while switching hosts.
- Upgrade an actual paired-host profile and verify legacy partition migration preserves drafts, unread state and queued messages. Exercise reconnects and remote folder/attachment actions.
- Capture real limit notices and retry-exhaustion wording from supported providers. Current classifier fixtures are synthetic. Verify reset parsing, account waits, fallback and cross-provider conversation handoffs against live providers; paid calls remain opt-in.

## Learning and goal evaluation

- Build a held-out recall evaluation set for older decisions, exact identifiers, English/Indonesian phrasing, corrections, cross-project isolation and resumed tasks. Compare against the pre-change baseline before making quality claims.
- Measure incorrect goal-completion claims after the deterministic evidence, verification-command and stall checks. A judge model is a deferred decision, not an implementation requirement yet.
- Optional learning ideas remain uncommitted: richer source-linked explanations and a unified activity/undo surface beyond existing memory history, learning reviews and summaries. Topic grouping, native deferred-tool references and vector retrieval need demonstrated failures before reconsideration; they are not required to finish the implemented learning plan.

## Security

[Remote security](REMOTE-SECURITY-PLAN.md) still requires remaining viewer client controls and paired-device acceptance. Rotating renewal and server expiry are written; verify lost replies, overlap and revocation across real desktop/mobile connections. Host-bound viewer pairing, the RPC allowlist and browser-origin restrictions remain server-enforced; hiding controls is not authorization. Native transport and distribution prerequisites still apply.

## Deferred implementation and acceptance blockers

Follow [repository testing guidance](../AGENTS.md#testing) for implementation changes. These prerequisites still block the specified acceptance:

- **Native and provider acceptance:** physical iOS/Android devices, signed/packaged desktop builds and opt-in authenticated provider sessions are still required for the device, permission, lifecycle and provider-boundary acceptance specified in the plans. Automated fake-provider checks do not satisfy those gates.
- **Shared device preferences:** the all-device/mobile baseline requires an established profile/account or pairing synchronization mechanism before shared scope controls can promise cross-host propagation; the paired-host model/composer layer is not person-wide sync. Preserve local settings while resolving the transport prerequisite in [mobile settings](MOBILE-SETTINGS-PLAN.md).
- **Native transport, capture and external accounts:** certificate enforcement across native fetch/SSE, real-device local speech availability and packaged helper/permission verification, distribution ownership/signing and Git-host credentials retain the prerequisites in their respective plans. They are deferred dependencies, not completed features.

## Deferred scope

The later-option sections in each plan are outside current completion requirements. They include additional Git hosting providers, relays, marketplaces, a full native mobile editor, automatic cross-host credential synchronization and transport extensions without a demonstrated need. Do not keep an otherwise finished plan open solely for these options; preserve justified future decisions separately when removing completed plans.
