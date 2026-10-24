# Remaining mobile work

Reconciled with the linked feature plans on 2026-10-23; native acceptance remains open. The companion implementation is present; completed bootstrap, pairing, host state, thread, Git, schedule and push implementation phases have been removed from this plan. [README](README.md) describes current behavior and setup. [Verification](VERIFICATION.md) tracks outstanding acceptance checks.

## Delivery

A person checks agent progress from their phone, answers a supported request and returns later with the same host, thread and draft intact. Prioritize the existing Threads/Inbox and native input/recovery gaps before adding more controls. Each linked feature ships as its own capability-aware flow within the four tabs; desktop parity and the entire roadmap are not prerequisites for a usable companion. Validate this core loop on physical devices, including background/reconnect and an unavailable host. Follow the [root product and planning guidance](../../AGENTS.md#product-design-and-architecture) for this and later increments.

**Easier for the person:** The person answers from the phone without opening the laptop and picks up exactly where they left off.

## Ramu design and architecture

Follow [Architecture](../../docs/ARCHITECTURE.md) and [UI](../../docs/UI.md). Preserve the existing four-tab navigation, native sheets/rows, shared mobile controls and theme/accessibility conventions; add feature entry points within their current surfaces. Pure domain projections belong in `packages/shared`, while camera, microphone, discovery, transport and OS permissions use device-native adapters. Files, Git, agents, credentials and workspace mutations stay on the selected server through the existing authenticated mobile host API and advertised capabilities. Keep per-host caches/events isolated, preserve device-local preferences and offline drafts, and never introduce a mobile database or provider runtime as an alternative authority. Remaining Agent setup work follows its [shared plan](../../docs/AGENT-SETUP-PLAN.md), including explicit host-administration limits.

## Product work

- Validate the written [automatic host discovery](../../docs/HOST-DISCOVERY-PLAN.md) flow on physical devices: Nearby hosts first, QR scanning second, manual entry last. Include permissions, blocked multicast, verified identity/address changes and pairing completion/storage recovery; the camera no longer opens automatically.
- Finish the remaining scope selection, context actions, large-directory continuation and native acceptance in [Explorer from threads and Home](../../docs/EXPLORER-PLAN.md).
- Validate the written [microphone dictation](../../docs/VOICE-INPUT-PLAN.md) adapters on physical iOS/Android: local transcription into the original draft, permission/language readiness and cancellation. Finish native keyboard prediction and command/file/skill picker parity acceptance, implementing demonstrated gaps.
- Finish draft restoration, reused-workspace selection, generated naming and offline acceptance in the [workspace defaults and branch naming plan](../../docs/WORKSPACE-DEFAULTS-PLAN.md) for new-thread settings/selection and offline outbox delivery, preserving the chosen host, checkout mode and naming intent through reconnects.
- Validate the written routing/account projection, localization and native behavior for [plan usage](../../docs/PLAN-USAGE-UX-PLAN.md) in the Threads header and beside the thread's model, opening a shared host/account sheet. Keep the existing four tabs.
- Validate the written mobile [browser viewer](../../docs/BROWSER-PLAN.md#remote-hosts-and-mobile), capability-aware status, system links, authenticated host access, Take/Give control and disconnect recovery. Browser-session import remains on the browser's owning host.
- Validate the written [computer-use viewer](../../docs/COMPUTER-USE-PLAN.md) on devices: phone WebRTC/image fallback, touch/keyboard takeover, freshness, ownership, Stop and disconnect recovery. Run the representative cross-device task, local-input pause and controller handoff on real computers; source and fake tests do not complete these gates.
- Finish the advanced desktop-input parity audit. Verify command/skill discovery, host context references, external keyboard/IME interactions, advanced question/elicitation fields and review/helper interactions; implement gaps found against the actual desktop/provider capabilities. Existing transcript forms, queue/steer and model controls are not new work.
- Finish terminal customization: gesture mappings, explicit navigation/selection/mouse-mode feedback, external-keyboard behavior and multiline-paste preview. The current console, modifier latches, arrow-hold gesture and PTY recovery already exist, and the key rail is configurable: long-press a key in **Terminal keys** to add or remove it (device-local, up to 24, reset to default; `terminalKeys.ts`). Verify it with VoiceOver/TalkBack and large text.
- Measure long-thread/transcript payloads and terminal responsiveness on devices before deciding whether pagination or additional replay cursors are needed.
- Finish the remaining native transcript/recovery and device acceptance in [thread activity](../../docs/THREAD-ACTIVITY-PLAN.md), and complete remaining [theme integration and native acceptance](../../docs/AI-THEMES-PLAN.md). Interactive Content is implemented; its remaining native-device acceptance is tracked in the [roadmap](../../docs/ROADMAP.md#interactive-content-acceptance).

## Release gates

- Complete the physical-device checks in [VERIFICATION.md](VERIFICATION.md).
- Establish owned app identifiers, Expo project and distribution accounts; configure signing and APNs/FCM credentials; publish TestFlight and Android internal builds.
- Meet the applicable [remote-security prerequisites](../../docs/REMOTE-SECURITY-PLAN.md#plan) before wider distribution. Security implementation is tracked separately.

## Deferred decisions and scope

- Remote network/device administration remains host-only. Define explicit administrative grants, reviewable changes and recovery behavior before adding phone-side controls; paired devices must not gain administration implicitly.
- Relay deployment, ownership, costs and tunnel identity remain undecided. There is no deployed relay. Design this separately from direct-host push.
- A full native editor and dedicated mobile provider sign-in are deferred product scope.
- Large-file chunked/streaming attachment upload is deferred. Current base64 uploads remain bounded by the invoke limit; define transfer cancellation, orphan cleanup and retry semantics before extending it.
- Add an Inbox-specific capability only if a supported host actually exposes `mobile-companion` without the required Inbox methods. Current version gating and tolerated optional methods do not require a speculative protocol change.

Remove finished items rather than maintaining a completed-phase ledger. Run scoped unit tests and types for behavior changes; device acceptance must be recorded separately from simulated tests.
