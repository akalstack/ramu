# Remaining work

Audited against the checkout on 2026-10-18. This lists unfinished work only. Completed implementation plans are deleted; current behavior belongs in the feature guides. Remove an item when it is finished, and delete a plan when nothing remains in it.

Each plan follows the [root product and planning guidance](../AGENTS.md#product-design-and-architecture) and is implemented in full. Build complete human workflows through existing Ramu surfaces and services, so each one makes the person's work easier. Keep mandatory security, accessibility and correctness checks for each delivered flow.

## Feature work

- [Model selection preferences](MODEL-SELECTION-PLAN.md): shared device/mobile/phone scopes and native acceptance of generated defaults, flow switching, unavailable selections and recovery. Current per-host selection controls are in [UI](UI.md#new-thread-model-defaults).
- [Mobile settings preferences](MOBILE-SETTINGS-PLAN.md): shared scope controls for model, appearance, language, reading, composer and notification preferences, with All devices, All mobile devices and This phone choices, visible inheritance and safe synchronization.

- [Assistant workflow](ASSISTANT-WORKFLOW-PLAN.md): default Auto/manual project selection using names/aliases followed by AI routing when needed, memory correctness/source links, and targeted verification/recovery, Inbox and existing PR-watch improvements. Reuse existing services.

Thread activity, usage visibility, browser and computer-use integration, workspace defaults, voice input, Explorer access, themes and Git hosting integrations include unfinished implementation and acceptance:

| Area                                 | Remaining work                                                                                                                                                                                                                                                                           | Plan                                                                     |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Thread activity                      | Full native helper transcripts/child navigation, old-cache migration, authoritative native waiting metadata and device/recovery/accessibility acceptance.                                                                                                                                | [Thread activity](THREAD-ACTIVITY-PLAN.md)                               |
| Plan usage                           | Effective next-message account/routing projection, provider scope explanations, refresh/reconnect acceptance and native layout/accessibility acceptance.                                                                                                                                 | [Plan usage visibility](PLAN-USAGE-UX-PLAN.md)                           |
| Browser                              | Integrated/provider browser selection, independent link target, isolated profiles, session import acceptance on a packaged build with a real keychain (macOS Chrome/Edge/Firefox are implemented), collaborative control and remote/mobile rollout.                                                                                                                             | [Browser implementation](BROWSER-PLAN.md)                                |
| Computer use                         | Packaged-build permission identity, per-provider image delivery, a real two-computer run of the enrolled broker, push frame subscription, phone WebRTC and takeover acceptance, and the representative cross-device task.                                                                                                                     | [Computer use](COMPUTER-USE-PLAN.md)                                     |
| Workspace defaults                   | Branch-name draft and frozen outbox base acceptance across entry points, restart and concurrent clients; additional offline/provider/native acceptance, including shared-label editing.                                                                                                                         | [Workspace defaults and naming](WORKSPACE-DEFAULTS-PLAN.md)              |
| Voice input & suggestions            | Mobile/desktop microphone dictation, local recognition, protected draft insertion, native keyboard prediction compatibility and contextual picker parity.                                                                                                                                | [Microphone and composer suggestions](VOICE-INPUT-PLAN.md)               |
| Explorer                             | Confirmed file management, native copy/reveal, watcher lifetime and native acceptance of workspace selection, file-to-draft actions and selected-path reveal.                                                                                              | [Explorer from threads and Home](EXPLORER-PLAN.md)                       |
| Themes                               | Compose shared app controls, shared semantic tokens, light/dark appearance, custom-theme preview/apply/restore, manual and AI editing, JSON sharing and platform mappings.                                                                                                               | [Themes](AI-THEMES-PLAN.md)                                              |
| Git hosting integrations             | GitHub account settings, secure host-owned credentials, existing PR/issue/watch migration and GitHub clone/publish; GitLab, Bitbucket Cloud and Azure DevOps show Coming soon only.                                                                                                      | [Git hosting integrations](GIT-INTEGRATIONS-PLAN.md)                     |
| Agent setup                          | Extend existing skill management, add shared rules and source-aware discovery/import, provider/project selection and effective-session inspection using Ramu's Settings and adapter architecture. Includes Shared MCP management, account-readiness/approval recovery, account setup option for bidirectional sharing of approved connections, authentication and separate external-tool permissions. | [Agent setup](AGENT-SETUP-PLAN.md), [Shared MCP](MCP-MANAGEMENT-PLAN.md) |
| Settings & config files (ramu.json)  | Packaged/native configuration, model-default and action-management acceptance. Current storage and defaults are in [Configuration files](CONFIGURATION.md).                                                                                                                     | [Configuration files](CONFIG-FILES-PLAN.md)                             |
| Automatic host discovery and pairing | Default nearby-host discovery on desktop/mobile, mobile QR/manual and desktop address/SSH fallbacks; T3-referenced offer cancellation, exact completion, stable host identity, safe re-pairing and verified routes.                                                                      | [Automatic host discovery and pairing](HOST-DISCOVERY-PLAN.md)           |

- [Client–server communication](COMMUNICATION-PLAN.md): compare current HTTP/SSE with T3-referenced WebSocket RPC/subscriptions, preserve local sockets and host/access boundaries, and deliver bounded replay, safe command recovery and flow control before choosing hybrid or broader migration.
- [Background terminal management](BACKGROUND-TERMINALS-PLAN.md): command approvals and human-stop feedback, native provider handles/sub-agent attribution, native accessibility/gesture checks and packaged removal/recovery acceptance. Current managed-command history and output are in [UI](UI.md#workspace-and-terminals).
- [Provider compatibility](PROVIDER-COMPATIBILITY-PLAN.md): host-owned runtime/version policies, actionable status in existing provider cards, compatible update recommendations and launch checks; start with a verified Codex flow, then cover other adapters with evidence.
- [Thread titles](THREAD-TITLES-PLAN.md): verify and reuse provider-supplied titles before existing bounded Ramu fallback; validate naming quality, refinement and packaged/native synchronization. Server scheduling and revision-safe manual regeneration are in the feature guide.
- [Thread state visibility](THREAD-STATE-PLAN.md): retain dots, existing accurate copy and desktop/mobile row layouts; expose desktop short status, branch and checkout/worktree context through per-thread popovers, plus short mobile labels, backed by shared summaries, state mapping and recovery acceptance.

## Interactive Content acceptance

The [implemented contract](INTERACTIVE-CONTENT.md) covers publication, immutable revision browsing, named scenarios, explicitly compatible scenario copying, selected-value drafts and desktop/mobile export. Remaining evidence:

- Run representative calculators, branching walkthroughs, comparisons and a new subject through live provider sessions on desktop, iOS and Android; include reconnect/restart and offline cached reopening. Direct/deferred MCP publication and synthetic desktop interaction already have automated evidence; they do not replace live-provider/native acceptance.
- On real iOS/Android devices, verify gestures versus feed scrolling, expansion/close, offscreen and screen-focus lifecycle, selection/keyboard, VoiceOver/TalkBack, Android back, large text, appearance, reduced motion, scenario copies and HTML/source sharing.
- Verify native WebView navigation, private-address/redirect egress denial, credential isolation, stale/forged bridge messages and renderer process termination. The browser companion deliberately keeps static viewing until an independent document origin is available.
- Bring desktop's always-open card to native mobile: open on screen without **Open**/**Pause**, the compact header and menu, and the **Code** view for multi-file projects. Mobile **Share source** sends the bundled document for projects until it can share the files.
- Observe script loops and platform CPU/memory behavior. Up to three isolated desktop frames and bounded persisted state are not hard CPU quotas; determine additional containment from actual platform evidence.
- Compare matched tasks before claiming an advantage over another application. Record environment, task, output and failures; source inspection or a single successful demo does not establish general superiority.

## Release and mobile

- [Distribution](DISTRIBUTION-PLAN.md): macOS signing/notarization and CI wiring, signed auto-updates, clean Linux GUI acceptance, a Windows support decision, and mobile distribution.
- [Mobile roadmap](../apps/mobile/PLAN.md): in-place Inbox replies, advanced input parity, terminal customization and the explicitly deferred product scope.
- [Mobile acceptance](../apps/mobile/VERIFICATION.md): physical iOS/Android, push and Live Activity delivery, keyboard/IME, accessibility and usage-limit controls. Credentials and provisioned devices are required for parts of this work.

## Host and provider acceptance

Implemented behavior is covered by unit/integration tests and the desktop startup smoke test. These acceptance checks remain:

- Measure memory, CPU and event volume with two and three paired hosts, including one streaming heavily. Check fairness and responsiveness while switching hosts.
- Upgrade an actual paired-host profile and verify legacy partition migration preserves drafts, unread state and queued messages. Exercise reconnects and remote folder/attachment actions.
- Capture real limit notices and retry-exhaustion wording from supported providers. Current classifier fixtures are synthetic. Verify reset parsing, account waits, fallback and cross-provider conversation handoffs against live providers; paid calls remain opt-in.

## Learning and goal evaluation

- Build a held-out recall evaluation set for older decisions, exact identifiers, English/Indonesian phrasing, corrections, cross-project isolation and resumed tasks. Compare against the pre-change baseline before making quality claims.
- Measure incorrect goal-completion claims after the deterministic evidence, verification-command and stall checks. A judge model is a deferred decision, not an implementation requirement yet.
- Optional learning ideas remain uncommitted: richer source-linked explanations and a unified activity/undo surface beyond existing memory history, learning reviews and summaries. Topic grouping, native deferred-tool references and vector retrieval need demonstrated failures before reconsideration; they are not required to finish the implemented learning plan.

## Security

[Remote security](REMOTE-SECURITY-PLAN.md) still requires rotating credential renewal, token-lifetime UI, viewer-specific client controls, native mobile transport/certificate handling and paired-device acceptance. Server expiry, host-bound viewer pairing, an explicit RPC allowlist, pairing-route coverage and restricted browser origins are implemented; current policy is in [Security](../SECURITY.md#remote-access). Native transport and distribution prerequisites still apply.

## Deferred implementation and acceptance blockers

Implementation validation remains deferred until all implementation code is done, per the current task instruction. Unfinished functional work remains in the linked plans; source inspection and written tests are not passing-check evidence.

- **Browser automated checks:** on 2026-10-22 typechecks and unit/integration tests passed for shared, server, web, desktop, mobile, contracts and client-runtime, and `pnpm build` plus `pnpm test:desktop-smoke` passed. Native/provider acceptance and remaining browser delivery stay in the [browser plan](BROWSER-PLAN.md).
- **Native and provider acceptance:** physical iOS/Android devices, signed/packaged desktop builds and opt-in authenticated provider sessions are still required for the device, permission, lifecycle and provider-boundary acceptance specified in the plans. Automated fake-provider checks do not satisfy those gates.
- **Shared device preferences:** the all-device/mobile baseline requires an established profile/account or pairing synchronization mechanism before shared scope controls can promise propagation. Preserve local settings while resolving the transport prerequisite in [mobile settings](MOBILE-SETTINGS-PLAN.md).
- **Native transport, capture and external accounts:** certificate enforcement across native fetch/SSE, verified local speech dependencies/model packaging, distribution ownership/signing and Git-host credentials retain the prerequisites in their respective plans. They are deferred dependencies, not completed features.
