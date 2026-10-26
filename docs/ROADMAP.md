# Remaining work

The single plan for everything unfinished. It replaces the per-feature `*-PLAN.md` files and the mobile plan; history is in git. Follow the [planning guidance](../AGENTS.md#planning-docs): lasting behavior lives in the feature guides ([UI](UI.md), [Agents](AGENTS.md), [Providers](PROVIDERS.md), [Pull requests](PULL-REQUESTS.md), [Memory](MEMORY.md), [Goals](GOALS.md), [Architecture](ARCHITECTURE.md), [Security](../SECURITY.md)); remove an item when it is done.

The file has three parts:

1. [Implementation remaining](#1-implementation-remaining): code or audits that can be finished and checked with automated tests.
2. [Skipped: untested or needs acceptance](#2-skipped-untested-or-needs-acceptance): written behavior that has not run on a physical device, packaged/signed build, live provider or real second host. Automated fake-provider checks and source inspection do not close these. Each item stays until it has been run.
3. [Decisions and deferred scope](#3-decisions-and-deferred-scope).

**Standing rules for every item.** Run scoped tests and typechecks for touched packages (`pnpm --filter @ramu/<pkg> test`, `typecheck`). Desktop-facing changes also need `pnpm build` then the single `pnpm test:desktop-smoke` (never rebuild during smoke; no second desktop e2e suite). Documentation-only edits need formatting and link checks. Physical-device and live-provider results are recorded separately from simulated tests; paid provider calls and credentials are opt-in. The mobile device checklist is [apps/mobile/VERIFICATION.md](../apps/mobile/VERIFICATION.md).

---

## 1. Implementation remaining

### Client–server communication

- Finish transport integration of bounded replay/snapshot recovery, resource subscriptions and terminal flow control. The WebSocket call path is opt-in; HTTP/SSE stays the default until a matched comparison justifies a change.
- Agent transcripts resume through `agent.changes(sessionId, cursor, knownLastSeq)` (per-row revision counter `agent_events.rev`; full-snapshot fallback for no cursor, future cursor, rewind or more than 2000 changes). The endpoint is bounded by rows (2000) and serialized size (`MAX_CHANGE_BYTES`), both covered by `agentChanges.test.ts`; terminal reconnects fetch only the missed gap through `TerminalService.snapshot(id, since)`, which now decides through `planResume` and reports `resume: live | replay | snapshot` (additive; older clients ignore it, and the web view still infers a truncated replay from the cursor). the WebSocket path also has opt-in terminal flow control: a client that subscribes with `flow: true` (`RuntimeSocket` `flowControl`) acknowledges each `term:data` chunk, the host holds output past a 1,000,000-character unacknowledged window (`OutputWindow`) and, once the client has caught up, sends one `term:behind` so it fetches the gap through `term.snapshot(id, since)`. The phone's terminal bounds its hydration buffer with `LiveBuffer` and refetches on overflow or `term:behind`. Loopback measurement (2026-10-26, one Mac, Node `fetch` against the real server and `ws`, 2000 sequential no-op calls): HTTP `POST /invoke` p50 1.74 ms, p95 2.14 ms, p99 2.42 ms; WebSocket p50 0.034 ms, p95 0.074 ms, p99 0.152 ms. A 20,000,000-character terminal flood to a client that never acknowledges delivered all of it without flow control and 1,000,000 characters with it. This shows per-call overhead and the bound only: it has no network latency, TLS, proxies, phone radios or a genuinely slow reader, so it does not choose a default. The default is decided (see [decisions](#3-decisions-and-deferred-scope)): HTTP/SSE stays the default and the socket and flow control stay opt-in.
- Specify transport-independent outcomes (current, synchronizing, disconnected, authorization rejected, outcome unknown) and preserve drafts and queued messages through each. Mutations that cannot be retried safely report an unknown outcome and reconcile; add scoped durable operation keys only where retry is required.
- Guardrails: negotiate before use, fall back only for explicit lack of capability, never bypass revoked credentials / protocol or identity failures, reuse one connection per client–host session, give Stop/approval work priority under terminal load, and keep the renderer's typed invocation interface stable.
- Tests: contract validation and malformed/oversized frames; snapshot/live overlap, gaps, rewind, stale generations, cursor expiry, host restart and downgrade; lost acknowledgement; slow consumers and per-host/global limits; owner/viewer parity across HTTP and WebSocket, forged subscriptions, origins, expiry, revocation, rotation overlap; old client/new server and the reverse.

### Background terminals

- Native Claude/Codex/OpenCode/Cursor command handles are unstarted and need verified owner-lifecycle contracts. The ACP client-terminal boundary is written but enabled for no provider; enable it only for a provider verified against a live runtime, with attributed and labelled excerpts.
- Unregistered daemonized processes stay unsupported. Reuse the host-owned metadata, authorization, bounded output and existing surfaces rather than adding a process manager.
- Tests: registration/deduplication, same IDs on different hosts, wrong-thread/role rejection, graceful/force stop, exited-before-stop races, lost acknowledgements, bounded output and cursors, descendant cleanup, stale handles; client discovery after turn completion, hide versus stop, old hosts, reconnect without duplicate launches.

### Agent setup (skills, rules, MCP)

- Skills: extend source/ownership, native-skill discovery, duplicate handling and compatibility details in the installed-skills manager; harden owned-link lifecycle (safe cleanup on scope/project removal, no deletion of user/plugin files, concurrent sessions with different provider selections). Verified aliases that map a skill's MCP tool to one connection unambiguously, tool-level denial and incomplete deferred-discovery handling remain.
- Rules: delivery per adapter beyond session guidance, and path-matched activation only after an adapter can implement it (a runtime without path-aware activation shows unsupported; never activate a path-only rule globally).
- Effective setup: Configured / Delivered / Runtime confirmed / Not observable stay distinct; never claim "loaded" from writing a file. Re-resolve setup on fallback, account/provider switch, resume and helper launch without widening scope or duplicating injection.
- Shared MCP: finish provider-session HTTP/stdio lifecycle and approvals around the external gateway; write-only credential provisioning; settings authentication lifecycle and advanced command/secret editing; discovery/import previews with native/shared duplicate handling; account-switch readiness with **Share MCP approvals across accounts** (continue the same task on a backup account with the same project, upstream service account and approved tools, no extra prompt; sharing off or account removed stops reuse). Reject same-name impersonation and trusted-wrapper bypasses; background tasks needing new authorization wait with a visible request.
- Tests: scope precedence and escalation, host/project isolation, forged invocation, malformed/changed schemas, environment isolation, OAuth callback binding and refresh races, secret-store failure and redaction, redirect/metadata validation, import without execution, unknown write outcomes. Use fake MCP servers and temporary stdio fixtures.

### Long lists (memory, learned skills, installed skills, rules, MCP servers, approvals)

- Done: the shared list model (`packages/shared/src/listView.ts`) and the web `ListView` (search, filters, count, empty/filtered states, paging) now drive memories, learned skills, installed skills, rules, MCP servers and saved approvals; the phone's rules list uses the same matching. The archived-threads page now has search and paging too (Delete all still removes every archived thread, not just the matches). The learning review history has search and a status filter too. Remaining: the phone's skills/MCP/memory pages when those pages exist, and grouping by project for very long lists if scanning is still slow after real use.

### Mobile companion

- Settings menu parity: the phone now offers Browser (agent browser choice), automatic-update toggle and an Archived threads shortcut alongside the existing sections. Still desktop-only by design: editor/terminal/shortcut pages, environment variables, model-set and provider-binary editors, permission-rule lists, browser profiles/import, remote access administration. Add a phone entry only when it clearly helps a person away from the laptop.
- Advanced input parity audit: command/skill discovery, host context references, external keyboard and IME, advanced question/elicitation fields, review and helper interactions. Implement gaps found against actual desktop/provider capabilities; existing transcript forms, queue/steer and model controls are not new work.
- Terminal customization: gesture mappings, navigation/selection/mouse-mode feedback, external keyboard behavior, multiline-paste preview. The key rail is already configurable (long-press a key in **Terminal keys**; device-local, up to 24).
- Measure long-thread/transcript payloads and terminal responsiveness on devices before deciding on pagination or extra replay cursors.
- Shared mobile settings: establish how the all-device baseline and mobile overrides propagate across hosts before promising person-wide sync (see [decisions](#3-decisions-and-deferred-scope)). Extend shared-layer fields (appearance, accent, language, reduced motion, favorite models, alert fields) only when a person needs them. Offline local overrides must work immediately; switching hosts must not switch display preferences.
- Add an Inbox-specific host capability only if a host exposes `mobile-companion` without the Inbox methods.

### Models, themes, explorer, naming, titles, activity

- **Model selection:** cross-host sharing of the mobile layer exists only through a phone connected to both hosts (`planLayerSync`); person-wide sync without a phone is undesigned. Extend `ModelPreferences` only for demonstrated needs. Task-specific ranking waits for evidence that deterministic grouping is inadequate.
- **Themes:** audit specialized controls in `styles.css`, feature wrappers and mobile gesture surfaces for conflicting color/state overrides and migrate repeated styling to shared variants; audit production preview coverage for menus, forms, SCM, permission/queue/status cards; reconcile editor requirements (role search/grouping, group reset, derived-role explanations, targeted readability repair) only where a workflow gap is demonstrated; native file/share-sheet import/export through the same validator and preview.
- **Explorer:** desktop Home/project coherence; directory/search race and live delete/rename component coverage; capability-aware file management (previews stay read-only until each mutation boundary is covered); mobile scope selection and continuation beyond the first page.
- **Workspace defaults and naming:** offline default behavior and every issue/PR/keyboard entry point; storage recovery and concurrent-window behavior for active snapshots; English/Indonesian wording and generated/manual-name edge cases.
- **Thread titles:** enable a verified provider (`native.titles` is unset everywhere, so no fallback is deferred); wait through the first completed turn plus a bounded grace period for providers verified to supply titles; extend provenance to separate provider-supplied, Ramu-generated and manual titles; native explicit regeneration is unimplemented.
- **Thread activity:** full or paged native helper transcript where the provider supplies it; exact turn membership when historical launch data is missing; child navigation with provider-owned read-only footers.
- **Thread state:** shared summaries, desktop popovers, mobile labels and completion/notification consistency. Pending: approval/stopped wording, distinct turn-limit and verification labels, bounded request/origin and verification context in popovers, request actions that open the exact owning session.
- **Assistant workflow:** retrieval of a replacement memory from a fresh thread and another provider (add only demonstrated conflict-handling gaps); Inbox link from a blocker line to the exact request (the Waiting list now opens with a one-line tally such as "3 need approval · 2 need sign-in" on desktop and phone; sign-ins are grouped per connector (`ThreadInputRequest.connector`, from the elicitation's server name), so five threads waiting on Atlassian read as "5 need sign-in to Atlassian"); audit verification/recovery for duplicate actions and simultaneous checkout writers.
- **Browser:** provider capability/suppression negotiation; remote/mobile collaborative control; further session-import sources. Computer use: Windows/Linux only after native capture, permissions, signing and host acceptance pass.
- **Provider compatibility:** an ACP handshake probe for OpenCode 1; compatibility rules for Cursor, Antigravity and the OpenCode ACP runner after targeted protocol checks (add each to `COMPATIBILITY_RUNTIME`); confirm Claude and OpenCode entry points that launch outside the shared `validateSettings` path.
- **Git hosting:** GitLab, Bitbucket Cloud and Azure DevOps remain informational **Coming soon** rows; a second provider adds its adapter beside GitHub's in `workspace/forge/`.
- **Remote security:** remaining viewer write-surface controls. Hiding controls is never authorization; the server's viewer RPC allowlist and browser-origin restrictions remain the boundary. Do not market the viewer role as untrusted public sharing.
- **Release:** macOS signing/notarization and CI wiring; signed auto-updates (`APP_AUTO_UPDATE` stays `false` until signing works); mobile distribution accounts, APNs/FCM credentials and TestFlight / Android internal builds.

---

## 2. Skipped: untested or needs acceptance

Skipped on purpose in this pass: each needs a physical iOS/Android device, packaged or signed desktop build, live provider or real second host that was not available. The code that exists for each is written and unit-tested against fakes, not accepted.

**Why these are skipped (checked 2026-10-26 on the development Mac):** no physical iPhone or Android device is attached (`adb devices` lists none), the only iOS target is one simulator (it has no Local Network prompt, on-device speech, push or Live Activity delivery), there is no code-signing identity (`security find-identity` finds none), no Apple/Expo/APNs/FCM accounts, no provider API keys in the environment, no Cursor or Antigravity install, and no second paired host. Codex, Claude Code and OpenCode CLIs are installed, but a live-provider acceptance run spends paid calls and needs separately authorized credentials. The iOS simulator and Xcode 27.1 are installed, but the device-control tool is switched off for this environment and `xcrun simctl` cannot tap or type, so the app cannot be driven through pairing there; turn device access on to run simulator-level layout checks of the new Settings rows, lists and Inbox line. Run these when the missing piece is available.

### Needs physical iOS/Android devices

- **Host discovery and pairing:** Nearby hosts, QR, manual order; iOS Local Network prompt and refusal code (`-72008` assumed), Android multicast lock and Nearby Wi-Fi permission; `NSBonjourServices` and Android manifest in a development build; verified identity (`/identity` proof) and **Use this address** against a real second address; blocked multicast, guest Wi-Fi isolation, VPN, IPv6-only and multi-adapter interface selection; re-pairing, offer lifecycle, storage recovery; record supported OS/network combinations, latency and idle traffic.
- **Voice input:** `RamuSpeech` on-device recognition, permission grant/denial/revocation, language readiness, interruptions, five-minute cap, cleanup after crash; keyboard prediction, IME marked text and picker precedence; STT latency, battery and storage. Packaged desktop: the macOS helper and device selection.
- **Interactive content:** gestures versus feed scrolling, expansion/close, offscreen and focus lifecycle, selection/keyboard, VoiceOver/TalkBack, Android back, large text, reduced motion, scenario copies, WebView navigation, private-address/redirect egress denial, credential isolation, stale/forged bridge messages, renderer termination.
- **Browser and computer-use viewers:** Take/Give control, touch-to-pointer, keyboard/IME, orientation and scaling, freshness, Stop, disconnect recovery, phone WebRTC with image fallback, local-input pause, controller handoff. Measure capture age, CPU and memory.
- **Explorer:** one-handed discoverability, native Back, safe areas, large text, long filenames, virtualized large folders, scroll and folder-expansion restoration across screen recreation and restart, selected-path reveal, file actions (Copy path, Share a copy, Duplicate, Move, Rename, Delete), writer warning, multi-repository scope, two hosts, offline, watcher disposal on archive/delete.
- **Mobile settings, model flow, plan usage:** effective-source copy and **Use inherited setting**, unavailable selections, flow switching while a model sheet is mounted, Threads summary discovery, sheet dismissal, selected-host preservation in Access & Fallback, offline/reset copy, icon-only header action, per-provider counts, keyboard/composer fit, large text, touch targets, VoiceOver/TalkBack. The new Browser, automatic-update and Archived threads rows (pass-through to the host setting, search hit, filter preselection when returning from Settings) have unit coverage only.
- **Thread activity, state and titles:** short status labels at large text and narrow widths, compact row overflow, focus and scroll anchoring, helper sheet paging, advisor "N new" pill, child link returning to the same parent/draft/scroll, reduced motion; pending/failure/retry title labels.
- **Workspace defaults:** frozen outbox bases, changed-base review, lost acknowledgements, reused and removed worktrees, native keyboard and accessibility, shared label editing across real clients.
- **Push, Live Activities and APNs/FCM delivery,** keyboard/IME, accessibility and usage-limit controls: see [VERIFICATION.md](../apps/mobile/VERIFICATION.md). Needs credentials and provisioned devices.
- **Terminal customization,** long-thread performance and the written mobile WebSocket adapter.
- **Remote security on paired devices:** rotating renewal (lost replies, concurrent SSE/invoke, revoked predecessors, overlap), expiry and re-pairing, live stream revocation, role hydration, the [viewer access and role recovery checklist](../apps/mobile/VERIFICATION.md#viewer-access-and-role-recovery). Native certificate pinning is deliberately deferred (see decisions).

### Needs packaged or signed desktop builds

Checked 2026-10-26: `pnpm package` builds an unsigned (ad-hoc, linker-signed) macOS arm64 app, and `RAMU_PACKAGED_EXECUTABLE=dist/Ramu-darwin-arm64/Ramu.app/Contents/MacOS/Ramu pnpm test:desktop-smoke` passes against it. That establishes packaged startup on this Mac only; it does not establish a Developer ID signature, notarization, permission identity, installation on another Mac, upgraded profiles or any item below.

- **Packaged startup and configuration:** repository model-default startup, file watching and recovery; Settings source/error indicators; global settings edits reaching connected clients and background services; upgraded real profiles, corruption, abrupt termination; SQLite migration/archive retention.
- **Browser:** packaged session import with a real macOS keychain and Linux keyring; native transfers; profile lifecycle; renderer crash; restart.
- **Computer use:** signed packaged permission identity (Screen Recording, Accessibility), a real two-computer broker run, IME/scaling.
- **Themes:** system appearance changes, startup/splash, native sheets, ANSI terminal colors, multi-window selection, failed persistence, malformed imports.
- **Background terminals:** graceful-stop timeout/retry, retained output after failed removal, shared-worktree protection, Windows termination.
- **Distribution:** signed and notarized macOS draft release from CI that installs on another Mac; clean Linux x64 GUI run (CI packaging alone is not acceptance); Windows stays unsupported until macOS signing is established.
- **Remote renewal lifetime** surviving restarts and reaching paired phones.

### Needs live providers or real second hosts

- **Provider compatibility:** exact Codex 0.150.0 / 0.162.1 / 0.163.0, OpenCode 2.1.3 (HTTP) and Claude Code executable 2.1.308 with SDK 0.3.295 were probed; no mismatch has been reproduced on an older release (macOS killed Codex 0.120.0 and 0.100.0 binaries, exit 137, which is not protocol evidence). Cursor (needs a login) and Antigravity (not installed) have no rule; every other release stays Unverified and no launch is blocked. Record runtime version, Ramu build, platform, probe and outcome per rule; credentials and paid calls need separate authorization.
- **Shared MCP:** two-provider live service acceptance (the Atlassian scenario: read an issue and its linked project file through the shared connection before and after an account switch), headless/packaged secret-store checks, remote OAuth completion, with explicit test credentials.
- **Agent setup:** skill discovery, manual rule use and shared guidance across at least two live providers; effective setup across account/provider switches, helpers and recovery.
- **Assistant workflow:** held-out evaluation of Auto/manual project routing (English/Indonesian prompts: correct routes, incorrect automatic choices, clarification rate, latency, cost; compare name/alias-only against AI-assisted routing), changed-decision memory retrieval across providers, targeted verification/recovery, Inbox audits, and live PR-watch acceptance (watch, deliver a failing check, verified local fix, no relaunch on unchanged feedback, branch switch prevents wrong-checkout writes).
- **Plan usage:** additional provider model identities, model-specific windows, account matching and event-driven refresh; refresh failure/retry, host change, old-host fallback and network loss on real paired hosts; real limit notices and retry-exhaustion wording (current classifier fixtures are synthetic); reset parsing, account waits, fallback and cross-provider handoffs.
- **Git hosting:** GitHub adapter, account, watch, clone and publish behavior with live tokens, Enterprise hosts, a locked headless secret store, forks, broken SSH with working API, and the reverse. Use disposable repositories; never commit tokens.
- **Interactive content:** representative calculators, branching walkthroughs and a new subject through live provider sessions on desktop, iOS and Android including reconnect, restart and offline cached reopening; script-loop CPU/memory behavior; matched-task comparisons before any advantage claim.
- **Thread titles:** one real title-supplying provider (a title arrives during a normal session, and when) and one fallback provider; naming quality on English/Indonesian tasks, greetings, attachments and linked issues; refinement with real conversations; tool restrictions through every provider boundary used for naming.
- **Thread activity:** all child input and provider-limit transitions across native providers; blocked forms, stopped versus failed, independently running children, explicit resume, role-limited clients, restore.
- **Background terminals:** native permission-prompt acceptance and the representative task (leave a dev server running, find it, inspect logs, stop it, port released, other thread's server untouched).
- **Host and communication measurement:** memory, CPU and event volume with two and three paired hosts (one streaming heavily), fairness while switching; legacy partition migration preserving drafts, unread state and queues; the baseline (request and terminal-input latency p50/p95, Stop response, reconnect-to-synchronized time, bytes, CPU, memory) and a matched HTTP/SSE versus WebSocket comparison with thresholds fixed before results.
- **Learning and goals:** a held-out recall set (older decisions, exact identifiers, English/Indonesian, corrections, cross-project isolation, resumed tasks) compared against the pre-change baseline; incorrect goal-completion claims after the deterministic evidence, verification-command and stall checks. A judge model is a deferred decision.

### Representative tasks to run when the above is available

- Choose an appearance, edit a color, ask AI to refine it, undo, trial and revert, keep and share with a second installation (recipient previews; neither device changes the other).
- Scan concurrent threads (a goal, an approval, a question, a provider limit, a pause, a stalled goal, a turn cap, a failed run, a stopped run, a finished unread result) and identify which needs action from icons and short labels; open the right request once and see the state update.
- Start a thread with "Use two agents to fix duplicate payment retries and write a report": the title names payment retry duplication, omits the workflow and claims no completion.
- Ask the agent to open Calculator on computer A and compute `(125 * 8) + 42` (expect `1042`) while watching and stopping from a phone and desktop B; repeat with the agent on host C and the runtime on A.
- Stream an agent response and terminal output on one host, type in another terminal, answer a permission and Stop an agent on a second host, switch hosts, drop Wi-Fi, sleep the phone and resume with drafts and unread state intact.

### Configuration acceptance

A person can identify which repository supplies a default, fix invalid configuration and start a thread without losing a reviewed draft or granting repository content extra authority. Verify same-named projects on different hosts, unavailable providers, offline recovery, screen readers and large text on desktop and physical iOS/Android; packaged startup, file watching and migration are listed under the packaged-build items above.

### Plan usage acceptance

The next message's label (switch, held, stays, unknown) is authoritative, an older host's local estimate stays distinguishable, and unknown/stale/reset-past readings and all allowance windows are preserved: never summed across hosts and never replaced with zero. Live-provider and device checks are in the lists above.

### Interactive content acceptance

Live-provider sessions, native gesture/WebView/security checks and CPU observation are listed under the device and live-provider items above; compare matched tasks before claiming an advantage.

### Host and provider acceptance

Multi-host load and migration, real limit notices and the communication baseline are listed under the live-provider items above. Automated checks establish only the behavior and environments they exercised.

---

## 3. Decisions and deferred scope

- **Default transport (decided 2026-10-26):** HTTP/SSE remains the default for every client. The WebSocket call path (`RAMU_SOCKET=1`, `setSocketTransport`) and terminal flow control (`flowControl`, `flow: true`) stay opt-in. Reason: the only evidence is loopback (WebSocket calls are about 50x faster per call, 0.03 ms against 1.7 ms, and flow control bounds a stalled reader to 1,000,000 characters), which shows overhead but not a user-visible problem on a real network, and the criteria set before measuring require a repeatable improvement in an identified user problem with no regression in idle phone traffic, memory or multi-host fairness. Flip the default for a client when a measured run on a real phone or paired host shows all of: lower reconnect-to-synchronized time or terminal-input latency outside baseline variation, no extra idle traffic or battery use, and no failures behind the proxies and SSH tunnels people use. Until then, do not spend effort on a second default or a transport setting.
- **Native transport:** replacing blanket `NSAllowsArbitraryLoads` with a per-host native transport policy and certificate pinning is not being built; it needs a native transport replacement that cannot be verified without device builds, and T3 Code does not pin either. HTTPS pairing keeps host-identity and HTTP-consent checks. Reopen with a concrete threat they do not cover.
- **Person-wide preference sync:** no profile/account or pairing synchronization mechanism exists, so shared scope controls cannot promise cross-host propagation. Hosts never talk to each other. Preserve local settings; keep credentials and workspace state out of any sync.
- **Mobile administration:** remote network/device administration stays host-only until explicit administrative grants, reviewable changes and recovery exist; pairing must not grant administration implicitly.
- **No relay:** relay deployment, ownership, cost and tunnel identity are undecided. Design separately from direct-host push.
- **Windows:** unsupported until macOS signing is established.
- **Deferred scope:** a full native mobile editor and dedicated mobile provider sign-in; large-file chunked attachment upload (define cancellation, orphan cleanup and retry first); additional Git hosting providers; marketplaces for MCP, themes or skills; arbitrary plugin or hook execution; automatic provider-file synchronization; cross-host credential or setup synchronization; automatic rule translation; AI-generated conflict resolution; separate terminal sockets, binary encoding, compression, HTTP/2 and media channels until measured failures justify them; a hosted MCP redirect relay and Ramu-published client metadata document; galleries, hosted theme links and external theme formats; local Qwen/UI-TARS grounding, VMs and cloud desktops for computer use; topic grouping, vector retrieval and a unified activity/undo surface for learning until a demonstrated failure. Do not keep this plan open solely for these.
- **Evidence rule:** claim an improvement over another application only after matched task evidence (environment, task, output, failures). Source inspection or one successful demo is not general superiority.
