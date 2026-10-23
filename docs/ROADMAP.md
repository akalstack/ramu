# Remaining work

Remaining implementation, acceptance and release prerequisites, reconciled with the linked plans on 2026-10-23. This lists unfinished work only. Completed implementation plans are deleted; current behavior belongs in the feature guides. Remove an item when it is finished, and delete a plan when nothing remains in it.

Each plan follows the [root product and planning guidance](../AGENTS.md#product-design-and-architecture) and must deliver a complete workflow before it is closed. Build complete human workflows through existing Ramu surfaces and services, so each one makes the person's work easier. Keep mandatory security, accessibility and correctness checks for each delivered flow.

## Feature work

The linked plans distinguish **implementation remaining** (missing or partial behavior), **acceptance pending** (written behavior that still needs the specified evidence), and **deferred scope** (later options, not current completion requirements). A plan stays open while either implementation or required acceptance remains. This index is reconciled with the plan documents on 2026-10-23; it is not a fresh source-code audit or a claim that acceptance passed.

### Implementation remaining and related acceptance

- [Client–server communication](COMMUNICATION-PLAN.md): finish transport integration of bounded replay/snapshot recovery, resource subscriptions and terminal flow control; add a mobile WebSocket adapter; measure the HTTP/SSE and WebSocket alternatives before choosing defaults. The Node WebSocket call path is opt-in, not the default event transport.
- [Background terminal management](BACKGROUND-TERMINALS-PLAN.md): native Claude/Codex/ACP/OpenCode/Cursor command handles are unstarted and require verified owner lifecycle contracts. Managed-command permissions, removal/recovery, native interaction and platform termination still need acceptance.
- [Agent setup](AGENT-SETUP-PLAN.md): extend skill provenance/discovery, create/edit-copy, compatibility and owned-link lifecycle; finish adapter-specific rule delivery and capability-gated activation. Validate effective setup across account/provider switches, helpers and recovery.
- [Shared MCP](MCP-MANAGEMENT-PLAN.md): finish and validate provider-session integration, external-tool trust boundaries, credential provisioning, approval/authentication recovery and account-switch readiness. Require live two-provider service acceptance and packaged/headless secret-store checks before claiming shared access works end to end.
- [Mobile settings preferences](MOBILE-SETTINGS-PLAN.md): establish cross-host profile/account synchronization, extend supported preference fields and validate inheritance, concurrent/offline changes and migration. Existing paired-host layers do not provide person-wide synchronization.
- [Model selection preferences](MODEL-SELECTION-PLAN.md): cross-host sharing remains undesigned; extend preference fields only for demonstrated needs. Validate generated defaults, flow switching, unavailable selections, inheritance and recovery on native clients.
- [Themes](AI-THEMES-PLAN.md): finish the specialized/shared-control audit and use more production components in the preview. Validate remaining native, accessibility, sharing and appearance behavior; do not treat manual/AI theme creation as unstarted work.
- [Explorer](EXPLORER-PLAN.md): finish desktop Home/project coherence and directory/search race coverage, plus remaining capability-aware file-management work. Validate native scope selection, file actions, draft insertion, restoration, continuation, selected-path reveal and watcher disposal.
- [Thread activity](THREAD-ACTIVITY-PLAN.md): finish historical turn membership and native helper transcript/child-navigation behavior where supported. Validate waiting transitions, restored caches, exact child identity, two-host recovery and accessibility.
- [Thread state visibility](THREAD-STATE-PLAN.md): shared summaries, desktop popovers, mobile labels and completion/notification consistency remain partial or pending validation. Finish the named gaps and verify stale snapshots, exact request actions, old hosts and two-host/native behavior.
- [Thread titles](THREAD-TITLES-PLAN.md): verify and enable a provider-title integration; native explicit regeneration remains unimplemented. Validate provider/fallback races, naming quality, refinement, tool restrictions and packaged/native synchronization.
- [Remote security](REMOTE-SECURITY-PLAN.md): finish native host/certificate enforcement across fetch and SSE, token-lifetime display and remaining viewer write-surface controls. Validate rotating renewal, expiry/re-pairing, revocation and role hydration on paired devices; see [Security](#security).

### Written behavior with acceptance remaining

These plans contain written implementation or audit foundations; fixes remain possible when acceptance exposes a gap.

- [Assistant workflow](ASSISTANT-WORKFLOW-PLAN.md): native acceptance and held-out evaluation of Auto/manual project routing, changed-decision memory retrieval/source links, targeted verification/recovery and Inbox audits, and live PR-watch acceptance.
- [Plan usage visibility](PLAN-USAGE-UX-PLAN.md): live evidence for additional provider model identities, account refresh, old-host/network-loss recovery, next-message routing labels and native layout/accessibility.
- [Browser](BROWSER-PLAN.md): packaged session import with real macOS keychain/Linux keyring, native transfers and profile lifecycle, provider capability/suppression negotiation, and remote/mobile collaborative control. Written browser behavior and automated checks do not establish native or live-provider acceptance.
- [Computer use](COMPUTER-USE-PLAN.md): signed packaged permission identity, live image delivery per provider, a real two-computer broker run, phone WebRTC, takeover/local-input pause, IME/scaling and the representative cross-device task.
- [Workspace defaults and naming](WORKSPACE-DEFAULTS-PLAN.md): all-entry-point and concurrent-client acceptance of branch-name drafts, frozen outbox bases, lost acknowledgements, shared labels, offline recovery and abrupt process termination.
- [Microphone and composer suggestions](VOICE-INPUT-PLAN.md): written desktop/mobile speech adapters need real-device/package verification of local recognition, permissions, language readiness and protected draft insertion; finish the native keyboard/contextual-picker parity audit and any demonstrated gaps.
- [Git hosting integrations](GIT-INTEGRATIONS-PLAN.md): GitHub adapter/account/watch/clone/publish behavior needs live token, Enterprise, locked headless store, recovery and native interaction acceptance. GitLab, Bitbucket Cloud and Azure DevOps remain informational Coming soon rows.
- [Configuration files](CONFIG-FILES-PLAN.md): packaged/platform configuration and model-default recovery, external settings edits, upgraded profiles, corruption/abrupt-termination recovery and physical-device source/error indicators. Current behavior is in [Configuration files](CONFIGURATION.md).
- [Automatic host discovery and pairing](HOST-DISCOVERY-PLAN.md): device/package acceptance of Nearby hosts, verified identity and routes, address review, re-pairing, offer lifecycle and exact completion/storage recovery, including blocked multicast.
- [Provider compatibility](PROVIDER-COMPATIBILITY-PLAN.md): extend evidence beyond the recorded exact Codex, Claude and OpenCode runtime probes; reproduce an older-version mismatch, probe OpenCode ACP and resolve Cursor/Antigravity prerequisites. Validate launch coverage, mobile presentation and native recovery; the tested rules are listed in the plan.

## Interactive Content acceptance

The [implemented contract](INTERACTIVE-CONTENT.md) covers publication, immutable revision browsing, named scenarios, explicitly compatible scenario copying, selected-value drafts and desktop/mobile export. Remaining implementation and evidence:

- Run representative calculators, branching walkthroughs, comparisons and a new subject through live provider sessions on desktop, iOS and Android; include reconnect/restart and offline cached reopening. Direct/deferred MCP publication and synthetic desktop interaction already have automated evidence; they do not replace live-provider/native acceptance.
- On real iOS/Android devices, verify gestures versus feed scrolling, expansion/close, offscreen and screen-focus lifecycle, selection/keyboard, VoiceOver/TalkBack, Android back, large text, appearance, reduced motion, scenario copies and HTML/source sharing.
- Verify native WebView navigation, private-address/redirect egress denial, credential isolation, stale/forged bridge messages and renderer process termination. The browser companion deliberately keeps static viewing until an independent document origin is available.
- Bring desktop's always-open card to native mobile: open on screen without **Open**/**Pause**, the compact header and menu, and the **Code** view for multi-file projects. Mobile **Share source** sends the bundled document for projects until it can share the files.
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

[Remote security](REMOTE-SECURITY-PLAN.md) still requires native mobile transport/certificate enforcement, token-lifetime display, remaining viewer client controls and paired-device acceptance. Rotating renewal and server expiry are written; verify lost replies, overlap and revocation across real desktop/mobile connections. Host-bound viewer pairing, the RPC allowlist and browser-origin restrictions remain server-enforced; hiding controls is not authorization. Native transport and distribution prerequisites still apply.

## Deferred implementation and acceptance blockers

Run focused checks as implementation changes land, following [repository testing guidance](../AGENTS.md#testing). Documentation reconciliation does not establish new runtime evidence. Keep missing implementation, required acceptance and optional later scope separate; source inspection and written tests alone are not passing-check evidence.

- **Browser automated checks:** on 2026-10-22 typechecks and unit/integration tests passed for shared, server, web, desktop, mobile, contracts and client-runtime, and `pnpm build` plus `pnpm test:desktop-smoke` passed. Native/provider acceptance and remaining browser delivery stay in the [browser plan](BROWSER-PLAN.md).
- **Native and provider acceptance:** physical iOS/Android devices, signed/packaged desktop builds and opt-in authenticated provider sessions are still required for the device, permission, lifecycle and provider-boundary acceptance specified in the plans. Automated fake-provider checks do not satisfy those gates.
- **Shared device preferences:** the all-device/mobile baseline requires an established profile/account or pairing synchronization mechanism before shared scope controls can promise cross-host propagation; the paired-host model/composer layer is not person-wide sync. Preserve local settings while resolving the transport prerequisite in [mobile settings](MOBILE-SETTINGS-PLAN.md).
- **Native transport, capture and external accounts:** certificate enforcement across native fetch/SSE, real-device local speech availability and packaged helper/permission verification, distribution ownership/signing and Git-host credentials retain the prerequisites in their respective plans. They are deferred dependencies, not completed features.

## Deferred scope

The later-option sections in each plan are outside current completion requirements. They include additional Git hosting providers, relays, marketplaces, a full native mobile editor, automatic cross-host credential synchronization and transport extensions without a demonstrated need. Do not keep an otherwise finished plan open solely for these options; preserve justified future decisions separately when removing completed plans.
