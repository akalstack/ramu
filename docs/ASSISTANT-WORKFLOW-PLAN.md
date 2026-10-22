# Assistant workflow implementation plan

This plan covers unfinished, incremental improvements to project selection, memory, verification/recovery, Inbox and existing PR automation. Existing behavior remains documented in feature guides; the additions below are not implemented yet. Remove completed items as they land, move lasting behavior into feature guides, and delete this plan when finished.

## Delivery

A person describes work from Home, sees the selected project, corrects it if necessary and starts one thread with the original draft intact. Deliver Auto/manual selection independently of memory and recovery audits. Use one project dropdown and contextual clarification, keeping routing diagnostics in details. Validate clear, ambiguous and unavailable destinations with representative prompts; add recovery, Inbox or PR controls only where the audits demonstrate a missing next action. Follow the [root product and planning guidance](../AGENTS.md#product-design-and-architecture) for this and later increments.

**Easier for the person:** The person types the work once; Ramu picks the project and the person only corrects it when it is wrong, without retyping.

## Ramu design and architecture

Follow [Architecture](ARCHITECTURE.md) and [UI](UI.md). Extend the existing Home composer/project picker, Memory & skills, thread status, Inbox and Source Control surfaces; compose shared app controls outside `components/ui/` with existing tokens, focus behavior and English/Indonesian copy. Keep routing, memory and recovery in their existing server collaborators behind the named shared API, validated handler registry and dispatcher; `AgentService` remains a wiring façade. Use the selected host's catalog and host-qualified queries/events, with device drafts kept separate from host settings. Do not add a parallel routing UI, RPC transport, recovery engine or agent-wakeup loop.

## Product outcome

Users can describe work before choosing a project, trust saved decisions and completion reports, resume interrupted work, and see when their input is required. Keep the current project/thread/goal model and existing controls. Make small changes through existing services.

## 1. Automatic project selection (default)

### Already in place

Home (desktop and mobile) starts in **Auto** while the Settings → Threads preference is on. The server resolver (`projects.route`) checks names and user-editable aliases (Names for Auto… in the project menu) with word boundaries, then makes one bounded tool-free classification whose answer is validated against the catalog. A resolved project starts the thread; ambiguous, unknown or failed routing keeps the draft and asks the person to choose, and a stale answer is discarded when the message, destination or host changes. Mobile persists the pending candidate list with the draft, revalidates it against the host's catalog, and creates routed threads through the outbox with a stable request ID, so a lost acknowledgement does not duplicate the thread. Remaining: the same candidate persistence on desktop (the list is in memory, so a restart re-asks the bounded router) and device acceptance. The choice list already labels same-named projects by host (mobile) and folder.

### Interaction contract

- Keep the project dropdown on desktop and mobile. Add **Auto** as its default for new profiles and profiles without an explicit project-selection preference. Manual project selection remains available at all times.
- In Auto mode, resolve the first prompt's destination before creating a project thread or starting repository work. A single well-supported match creates the thread in that project and shows the selected destination with a short reason.
- Auto includes AI routing: check explicit names/aliases first, then use a bounded model call to interpret prompts that need semantic matching. If the AI cannot identify one supported destination, ask the user to choose.
- An explicit project chosen in the dropdown overrides routing for that draft. Project/issue/PR/checkout-scoped entry points preserve their explicit scope. Global defaults never override explicit choices.
- Add a Settings preference for automatic project selection, enabled by default. Turning it off restores manual selection; if no project is selected, require a choice before creating the thread. Preserve saved preferences across restart and upgrade.
- If no clear match exists or multiple projects are plausible, ask the user to choose. Show distinguishable project/host labels, brief match reasons and access to the complete eligible project list. Never silently choose the most recent project as a fallback.
- Preserve prompt, attachments, model and workspace choices while asking. Cancel returns to the intact draft. Do not create speculative threads, checkouts or goals before a destination is resolved.
- Never silently move an existing thread. Before work starts, allow correction by returning the intact request to destination selection. After work starts, offer an explicit new-thread action with relevant context.

### Examples

- “Fix Ramu's mobile pairing screen” clearly matches registered project Ramu: create the thread there.
- “Fix the checkout payment error” does not name a project. If the permitted project descriptions identify Storefront as the only checkout/payment application, AI routing can select it and explain the match. If Billing also fits, ask rather than guessing.
- “Fix login” plausibly matches both Storefront and Billing: ask the user to choose.
- “Help with my new analytics app” has no supported match: offer existing projects or the existing add-project flow; do not invent a folder or create a project automatically.
- The dropdown explicitly says Billing: “Fix login” goes directly to Billing.
- Two hosts contain a project named Ramu: preserve explicit host scope, otherwise ask with distinct host/project labels.

### Implementation responsibilities

- Add a server-owned pre-thread resolver using eligible registered project IDs, explicit project names and user-editable aliases. Use conservative deterministic matching with name boundaries; substring matches or alias collisions must not silently choose a destination.
- When deterministic matching is inconclusive, make one bounded classification call through existing provider infrastructure, using the prompt and eligible project names, aliases and user-editable descriptions. Reuse the draft's effective provider/model choice and respect data-sharing settings. Do not require a separate agent thread or new routing-model setting.
- Define typed outcomes: resolved with evidence, ambiguous candidates, unknown and unavailable. Validate destination IDs against the eligible catalog. Recency or a model confidence score alone is not evidence to auto-select. Require a reason grounded in the permitted catalog; conflicting explicit destinations still require a user choice.
- Treat the prompt and project metadata as classification data. The router has no execution tools and cannot inspect arbitrary project files, install tools or expand authorization. Send only the text and bounded metadata needed for routing, respecting project visibility; omit attachment contents and unrelated conversations. Bound catalog size and model output without silently treating an incomplete catalog as proof of a unique match.
- Discard a pending routing result when the prompt, explicit destination, host or relevant catalog changes. Cancel on manual selection or draft cancellation; stale AI output must never create a thread.
- Use the selected host's catalog. Offline/inaccessible hosts never silently redirect to a different project.
- Revalidate destination access/readiness before creation. Reuse workspace defaults and checkout locks. Persist idempotent creation intent so retries, lost acknowledgements and reconnects do not duplicate threads.
- Persist Auto versus explicit selection, preference provenance and pending candidate choice with drafts/outbox. Revalidate stale candidates on reconnect. Settings changes must not overwrite explicit draft choices.
- On an unavailable host/catalog, missing capability, AI timeout, authentication failure or provider limit, preserve the draft and offer manual selection immediately. Keep model use bounded; do not hold the composer in an automatic retry loop.
- Home calls the server resolver directly because no project thread exists yet.
- Coordinate creation/default precedence with [Workspace defaults](WORKSPACE-DEFAULTS-PLAN.md); this section owns project-routing behavior.

## 2. Memory correctness and traceability

- Explicit supersession is in place (`memory_save` `supersedes`; see [Memory](MEMORY.md)). Remaining: evaluate retrieval of the replacement from a fresh thread and another provider, and source links for unavailable sources, then add only demonstrated gaps in source links and conflict handling. Preserve confirmed notes, history, project scope and review-first behavior.
- Use existing memory retrieval and learning jobs. A changed decision should retrieve the current decision with its source and identify the earlier one as superseded. Conflicting evidence without an explicit replacement stays visible; do not silently rewrite confirmed notes or choose by timestamp alone.
- Acceptance: save a polling decision, record a later switch to webhooks, then ask from a fresh thread and another provider. Retrieve the replacement and source; keep unrelated projects isolated. Include unresolved contradictions, unavailable sources, exact identifiers and English/Indonesian phrasing in the held-out recall evaluation in [the roadmap](ROADMAP.md#learning-and-goal-evaluation).

## 3. Reliable verification and recovery

- Existing goal evidence gates, user-configured verification commands, stall detection and restart recovery are the foundation; see [Goals](GOALS.md) and [Background work](AUTOMATION.md). Do not rebuild them or make users configure another workflow.
- Audit the current end-to-end behavior and fix demonstrated gaps only: preserved latest request/checkpoint/queue, correct pause state, failed verification continuing with its output, and safe recovery without duplicate actions or simultaneous checkout writers.
- Keep completion language tied to evidence. Distinguish local tests passed, CI still pending, runtime checks unavailable and work awaiting user input. Never turn an idle thread or historical passing result into proof of current success.
- Use existing goal/thread status and history to show a concise recovery or verification failure with a next action.
- Acceptance: interrupt authorized work and restart; resume once in the same scope, retain pending input and respect user pause/stop. A failed verification cannot complete the goal. Reuse existing test suites and perform opt-in live-provider acceptance already tracked in the roadmap.
- Browser verification remains owned by [Browser implementation](BROWSER-PLAN.md); it is not a prerequisite for these reliability fixes or a new subsystem in this plan.

## 4. Actionable existing Inbox

- Preserve the existing Inbox and its automatically clearing Waiting/Running state, recent Completed history and recap actions; see [Agents](AGENTS.md#thread-activity-and-helper-controls).
- Audit whether current rows clearly identify what is blocked, why it matters and the next action. Add missing source-linked blocker/failed-verification explanations through existing thread state.
- Reuse existing in-place questions/approvals and links to verification evidence. Resolved requirements must stop appearing as waiting; do not require users to clear routine thread activity manually.
- Deduplicate presentations of the same blocker and respect existing notification preferences.
- Acceptance: several simultaneous threads include a question, failed verification, provider wait and completion. The user can distinguish which needs input, open the correct host/thread, act once and see updated state after reconnect. Coordinate remaining UI/native acceptance with [Thread activity](THREAD-ACTIVITY-PLAN.md).

## 5. Incremental existing PR automation

- Keep existing `watch_pull_request` / `unwatch_pull_request`, manual Fix failing checks / Address review comments, persisted receipts, branch checks and normal thread queue. Current behavior is in [Pull requests](PULL-REQUESTS.md).
- Audit result: delivery to the right thread once, receipts across restart, branch checks, paused/stopped threads and opt-in behavior are already covered by `apps/server/test/pullRequestWatches.test.ts`. The feedback prompt now asks for local check results and reports remote CI as pending. Remaining work is the live acceptance below.
- Preserve current no-automatic-push/no-automatic-GitHub-reply behavior and existing approval controls. Automatic PR watching remains opt-in; Auto project selection does not enable it.
- Show authentication, branch mismatch, paused queue and failed verification problems through existing status/Inbox surfaces. Respect stop/unwatch/restart behavior and do not silently retry external writes.
- Acceptance: watch a PR, deliver a failing check, produce a verified local fix, and show the result in its thread/Inbox. Repeated unchanged feedback does not relaunch work; restart preserves delivery receipts; switching branches prevents writes to the wrong checkout. Distinguish local validation from remote CI, which cannot pass for an unpushed fix.
- Coordinate GitHub account/credential changes with [Git hosting integrations](GIT-INTEGRATIONS-PLAN.md).

## Delivery and acceptance

- Deliver independently: Auto/manual project selection and changed-decision memory recall are the first additions. Verification/recovery, Inbox and PR work are audits and targeted fixes to existing behavior, not wholesale feature rebuilds.
- Project-routing acceptance includes deterministic matches, semantic-only matches, genuine ambiguity, no match, duplicate names/aliases, invalid model IDs/output, prompt/metadata injection, oversized catalogs, provider failure, cancellation/manual overrides and stale results. Compare name/alias-only routing with AI-assisted routing on held-out English/Indonesian prompts; record correct routes, incorrect automatic choices, clarification rate, latency and cost. AI routing is active implementation scope; evaluations validate its behavior before release.
- For each audit, reproduce a real gap before adding code. If existing behavior meets acceptance, retain its evidence in the relevant guide/roadmap and remove the corresponding item from this plan.
- Add focused unit tests for changed logic and integration tests where persistence, provider boundaries, event delivery or thread creation matter. Cover retries/restart, ambiguity, scope, stale results and duplicate delivery without duplicating current suites.
- Run package-scoped tests/types for implementation changes. Desktop-facing changes require `pnpm build` followed by the single `pnpm test:desktop-smoke`; no second desktop e2e suite. Documentation-only planning needs no desktop smoke.
- Complete relevant desktop and physical iOS/Android acceptance for dropdown/picker, keyboard/accessibility, translations, offline drafts, host identity and notifications. Fake providers establish application behavior; opt-in live sessions establish reasoning/recall quality.
- Measure incorrect routing and clarification rate, changed-decision recall errors, false completion, duplicate actions, recovery failures, unnecessary notifications and user interventions per successfully completed task. Record a baseline before claiming improvement.
