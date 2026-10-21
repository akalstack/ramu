# Remaining thread activity work

Shared helper selection, separate advisor/history membership, mobile helper fidelity, activity controls on both clients, capability-aware helper actions, request-origin metadata and Inbox inline answers are implemented. Current behavior belongs in [Agents](AGENTS.md#thread-activity-and-helper-controls) and the [mobile guide](../apps/mobile/README.md#thread-activity-and-inbox-answers).

## Delivery

A person sees what an agent is doing, recognizes when their input is needed, opens the relevant request/helper and acts once in the correct thread. Keep one compact activity row and the existing detail surfaces. Prioritize truthful waiting state, supported child navigation and restored state; extra counts or unread-advice controls require a demonstrated decision they help the person make. Validate the flow with concurrent helpers, a pending question and a reconnect, without requiring the user to interpret provider events. Follow the [root product and planning guidance](../AGENTS.md#product-design-and-architecture) for this and later increments.

## Ramu design and architecture

Follow [Architecture](ARCHITECTURE.md) and [UI](UI.md). Extend the existing compact activity row, helper cards, request cards and native sheets instead of adding another status model or approval route. Shared pure event folds remain authoritative across clients; server collaborators own lifecycle, capabilities and command validation behind existing named methods. Use host-qualified identities/queries and host-tagged events, retaining the current workspace stores and device draft ownership. Compose desktop controls outside `components/ui/` and reuse mobile controls, tokens and focus/accessibility patterns; provider-owned data is exposed through current adapters only when supported.

## Remaining implementation and acceptance

- Desktop per-thread details popovers (short status, branch and checkout/worktree), short mobile labels and shared overview summaries are scoped in [Thread state visibility](THREAD-STATE-PLAN.md). Keep existing dots, accurate copy and desktop/mobile layouts; this plan continues to own open-thread/helper interactions and their acceptance.
- Add a full or paged native helper transcript where the host/provider actually supplies it, retaining exact host/session identity. Mobile currently labels its bounded output as an excerpt; it does not manufacture a child conversation. Real Ramu child IDs are now exposed additively, but child navigation and provider-owned read-only footers need dedicated acceptance.
- Verify all child input and provider-limit transitions across native providers and restart/reconnect. Waiting metadata is supplied for Ramu-owned helper questions and provider holds; unknown native dependencies stay generic rather than being guessed from text.
- Add unread-advice state only with a shared authoritative read model; settled advisor consultations currently remain in history. Finish shared per-status source descriptions and pending request counts for older snapshots.
- Complete exact turn membership when historical launch information is missing; reduced mobile caches now restore helper identity and separate advisor groups without inferring capabilities. Recovered launches without a matching tool call stay under Earlier activity; authoritative rewind snapshots remove discarded history rather than retaining a second projection.
- Validate compact row overflow, focus/scroll anchoring, large text, keyboard/safe-area coverage, accessibility and reduced motion on physical iOS/Android and desktop. Clock labels stop ticking when their route/window backgrounds; verify actual viewport virtualization and long helper lists before claiming device performance.
- Complete real-provider and two-host acceptance, including blocked forms, stopped-versus-failed display, independently running children, explicit resume, role-limited clients and state restoration. Shared, renderer, mobile native-boundary and server regression tests cover synthetic cases only.

## Validation and acceptance

Focused unit tests must cover mixed statuses (including stopped), advisor exclusion from subagent counts, current-turn versus historical totals, older active helpers, repeated updates, recovery versus explicit resume, missing metadata/capabilities, host collisions, and parent idle with child still working. Test priority/coexistence of input, connection, provider wait, goal, advice and queue; settled work must remove the working label. Existing question IDs, saved answers and form outcomes remain intact after navigation/reconnect.

Integration tests are warranted only for changed server snapshot/command boundaries: capability enforcement, child ownership, correct host dispatch, queued versus uncertain delivery and restored waiting state. Reuse existing provider-wait/goal/agent test suites rather than create a parallel recovery mechanism.

Run package-scoped tests and types after each meaningful implementation change (`pnpm --filter @ramu/shared test`, `typecheck`; corresponding mobile/web/server checks for touched packages). Desktop-facing phases additionally require `pnpm build` followed by `pnpm test:desktop-smoke`, with no concurrent rebuild while smoke runs. Keep the repository's single smoke test; do not recreate an e2e or performance suite.

Manual visual acceptance: iOS development build for native materials, Android native build for Material sheet behavior, and desktop; narrow phone width, large text, landscape, keyboard open/closed, long translated titles, long agent reports, light/dark, reduced motion, screen reader and keyboard focus. Verify a real child link returns to the same parent/host/draft/scroll position; a helper without a thread opens details. Use simulated providers and isolated profiles; screenshots/fixtures contain synthetic prompts and names. Expo Go/browser checks are useful layout previews but do not validate native patched headers or push behavior.
