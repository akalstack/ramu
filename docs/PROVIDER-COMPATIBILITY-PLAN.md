# Provider compatibility

## Human need and delivery

A person should know whether the provider on the selected execution host can run their thread with this Ramu release, and have a useful recovery action before an avoidable startup failure. Deliver compatibility status in the existing **Settings → Providers** cards and an actionable launch failure for a proven incompatible runtime. Start with Codex app-server, whose executable Ramu already probes, then cover the remaining runner boundaries with evidence. Keep providers without a verified policy usable as **Unverified**; do not invent minimum versions to fill a matrix.

**Easier for the person:** An incompatible runtime is flagged with its fix before the thread fails, and the draft survives the repair.

Representative task: select an old, known incompatible Codex executable on a paired host, see the affected feature and recommended version, update or correct its path through existing controls, refresh, and send the preserved draft successfully. Repeat offline with an unlisted version: report uncertainty without treating it as a known failure or contacting another host.

Follow [Architecture](ARCHITECTURE.md), [UI](UI.md) and the [root product guidance](../AGENTS.md#product-design-and-architecture). This is planned behavior; current setup and runtime checks remain documented in [Providers](PROVIDERS.md).

## Existing services to extend

- `apps/server/src/providers/adapter.ts` and `adapters/`: provider-owned version probes, installation lookup, sign-in and update plans. Keep protocol and version differences here.
- `providers/providers.ts`: existing background status/update checks, cached release information and `providers:updates`. Extend this service rather than adding another checker or polling loop.
- `providers/runners.ts`, native SDK runners and `providers/acp.ts`: actual runtime selection and negotiated session capabilities. Account for OpenCode's separate 1.x ACP and 2.x HTTP paths; invalidate cached runner selection after an executable changes, including replacement at the same path.
- `packages/shared/src/providers/providers.ts` (`ProviderStatus`), `packages/shared/src/api.ts` and the existing provider IPC handlers/schemas: additive typed status and validation through the current authenticated API. Wire changes belong in `packages/contracts` only when needed.
- `apps/web/src/settings/ProviderSettings.tsx`, `ProviderCard.tsx`, existing onboarding/model selectors and mobile provider settings: consume server-produced status. Reuse host routing, host-qualified query keys, Settings controls and existing localization. Compose app UI outside `components/ui/`.
- Existing session launch, fallback and helper services: use one server-owned compatibility decision at the destination launch boundary. Reuse existing thread errors, settings events and handoff behavior. Coordinate feature-level omissions with the [Agent setup inspector](AGENT-SETUP-PLAN.md#effective-setup-and-session-lifecycle); this plan owns runtime compatibility, not another setup resolver.

## Compatibility policy and evidence

Bundle a small, versioned policy with the execution server release. Each rule identifies the Ramu release/adapter contract it applies to, provider and actual runtime kind, applicable platform constraints, version range or exact release, status, affected operation/features, recommendation and supporting evidence. Validate rules for invalid ranges, conflicting overlaps and recommendations excluded by the same policy. Start with rules maintained alongside adapter changes; remote policy downloads are a later option.

Expose these meanings independently from installed/enabled, authentication, latest-release availability and live handshake results:

- **Supported:** within an explicitly maintained compatibility range for this integration. State the tested versions/evidence separately; a range is not proof every release was exercised.
- **Limited:** usable through a demonstrated fallback or with named features unavailable. Explain the impact and recommended recovery.
- **Incompatible:** a demonstrated protocol/API mismatch prevents the named operation. Block only that operation, with the reason and recovery action.
- **Unverified:** no matching rule, unreadable/unknown version, or insufficient evidence. Advisory only; normal protocol validation still applies.

Return structured reason codes and parameters for localized UI, observed runtime identity/version, policy revision and applicable recommendation. Distinguish a version probe failure from an actual incompatible handshake. Missing policy on an older host means compatibility is unavailable, never Supported. An offline host's cached result stays visibly stale.

Evaluate the runtime Ramu actually launches. Cursor's bundled SDK cannot be validated by an unrelated CLI version; record the bundled dependency/build and recommend updating Ramu when that is the remedy. For Claude, identify the SDK and executable combination used by its runner. Codex uses app-server; Antigravity uses the selected managed/custom ACP runtime. Keep date-style versions, prereleases and unknown output provider-specific rather than relying on the current latest-version comparator as a range evaluator. Custom binaries use the same evidence rules without assuming a vendor version string proves compatibility.

Version policy must not grant capabilities, authorization or broader permissions. Runtime-negotiated capabilities remain authoritative for optional features: a supported version cannot override a missing image, resume or MCP capability. Preserve existing safe fallbacks and truthful warnings. A successful handshake establishes only the operations it checks, not full provider compatibility.

## User flow and lifecycle

Show a quiet status beside the installed version in the existing provider card. Expand details for the selected host, actual runtime, affected behavior, evidence and recommended range/version. Give the next useful action: **Update**, **Update Ramu**, **Check again**, or **Change executable path**. Avoid a separate dashboard, modal on every send, global warning for an unused provider, or mandatory setup step for an unverified release. Reuse the same explanation when onboarding or a model selector encounters a blocked provider.

Keep **Update available** separate from compatibility. Before recommending or automatically installing a release, evaluate the known target against the same policy. Do not label latest as recommended merely because it is newer. Reuse existing installers and opt-in auto-update; never silently downgrade, cross OpenCode major versions, rewrite provider configuration or replace a custom executable. If the updater cannot select a compatible target, explain the manual installation path rather than offer a misleading one-click fix. Re-probe after an update and retain the warning if the installed runtime did not change or remains incompatible.

Cache bounded probes by effective executable/runtime identity and Ramu policy revision. Invalidate after path/configuration changes, managed-runtime activation, updates and relevant binary replacement; coalesce concurrent checks. Status refresh performs only bounded version/handshake probes: no paid model calls, conversation creation or provider configuration edits.

Revalidate at a new process/session boundary for main threads, helpers, advisors, scheduled/background work and fallback destinations. Skip proven incompatible automatic destinations without misclassifying them as usage-limited, and surface why no usable destination remains. Unknown versions remain eligible under existing routing rules. Stop/cancel stays available and a blocked launch preserves drafts and queued work without retry loops. Already-running sessions keep their launch snapshot and are not interrupted by a new advisory, provider update or policy refresh; re-evaluate when a new runtime must start.

All observations, policy decisions and mutations belong to the execution host. Remote and mobile clients must not probe the viewing device or redirect an update to it. Discard late results from a previous host/path selection. Existing host permissions still govern updates; viewing a warning grants no new administration rights.

## Remaining delivery

Delivered behavior (policy, evaluator, status line and actions in the provider card, shared launch guard, routing skip, identity-keyed coalesced probe cache, update-target evaluation) is in [Providers](PROVIDERS.md#runtime-compatibility). What remains needs real runtimes:

1. Codex has three rules in `compatibilityPolicy.ts`, each an exact release found Supported by a bounded app-server probe on 2026-10-23 (initialize, model/list and account/rateLimits/read, no model call): 0.150.0, 0.162.1 and 0.163.0. Releases 0.120.0 and 0.100.0 could not be probed here because macOS killed their binaries (exit 137), which is not protocol evidence, so no mismatch is recorded. OpenCode 2 has one rule on its HTTP runtime: 2.1.3 is Supported after `opencode serve` started, the event stream delivered `server.connected` and `mcp.list` answered (no model call, no session created); OpenCode 1 (ACP) has no rule and reports Unverified. Claude Code has one rule on the SDK runtime: executable 2.1.308 driven by SDK 0.3.295 is Supported after `initializationResult`, `supportedCommands` and `getContextUsage` answered with no model call (the rule keys on the executable; a Ramu release that moves the SDK pin needs a fresh probe). Cursor (bundled SDK 1.0.37) has no rule: even listing models needs a Cursor login or API key, which a probe must not use. Antigravity (ACP) has no rule: it is not installed here. Still to do: a reproduced mismatch on an older release (needs a machine that can run it), an ACP handshake probe for OpenCode 1, and widening to ranges only after testing more releases. Every other release stays Unverified and no launch is blocked.
2. Extend policies to Claude SDK/executable, Cursor SDK (recommend **Update Ramu**), both OpenCode runners and Antigravity only after targeted protocol/SDK checks, adding each provider to `COMPATIBILITY_RUNTIME`. Claude and OpenCode launch outside the shared `validateSettings` runner path for some entry points; confirm each is covered when its rules land.
3. Mobile has no provider settings card yet; surface the same status and recovery when it does.
4. Record live runtime versions, Ramu build, platform, probe/task and outcome for each supported rule; credentials and paid calls need a separately authorized acceptance run. Verify keyboard/focus, screen-reader status text, light/dark and narrow layouts, and the representative task end to end (old Codex, update or fix the path, check again, send the preserved draft).

Run affected package tests/typechecks. Desktop-facing changes require `pnpm build` then the single `pnpm test:desktop-smoke`. Delete this plan when no work remains.

## T3 reference and later options

Checked on 2026-10-18: T3's [compatibility manifest](https://github.com/pingdotgg/t3code/blob/main/apps/server/src/provider/model-manifest.json) declares app-release-specific provider ranges, statuses and recommendations. Its [installation guide](https://github.com/pingdotgg/t3code/blob/main/docs/user/install.md) describes Settings advisories and treats unlisted versions as unverified. These are design inputs, not Ramu support evidence; do not copy T3's version thresholds or assume identical adapters.

Ramu's intended refinements are checking the runtime actually used (including bundled SDKs), explicit evidence and uncertainty, host isolation, compatible update targets and consistent decisions at launch boundaries. Verify these against representative tasks before making comparative claims. Defer remotely refreshed compatibility policies, installing pinned historical versions, automatic rollback/downgrade, broad provider certification and model-specific compatibility matrices until a concrete need and maintenance path exist.
