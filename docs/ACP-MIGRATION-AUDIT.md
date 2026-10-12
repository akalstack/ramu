# Claude and Codex ACP migration audit

Checked on 2026-10-11 against the working tree, including its existing uncommitted agent features.

Completion tracking: [PLAN.md §13](PLAN.md#13-claude-and-codex-acp-migration-completion-plan). On 2026-10-12, the registry still reported Claude `0.89.1` and Codex `2.2.2`. The published Codex event/control/state diagnostics were re-run and reproduced the documented event loss, policy/MCP/fork differences, and canonical child-negotiation gap. The targeted current Ramu baseline passed **7 files / 157 tests, 1 skipped** (ACP, AgentService, Codex, routing, usage, question tools, and helper history). No new live inference checks were run in this review. Advisor and Goals now also need candidate integration coverage; prior audit passes do not certify these newer workflows.

**Decision: no migration without the user's explicit go-ahead.** The user permits investigating hybrid native reads and modifications to existing integrations, but has explicitly instructed us not to migrate yet. The stock released adapters have confirmed differences in subscription limit delivery, live patch previews, native async questions, approval policies, and native helper controls. The follow-up below identifies ways to address them through a library host or adapter changes. Several features still need end-to-end compatibility checks. No production provider connections or dependencies were changed by this audit.

## Releases actually checked

| Package | npm `latest` | Publication (UTC) | Release source |
| --- | --- | --- | --- |
| `@agentclientprotocol/claude-agent-acp` | `0.89.1` | 2026-10-10 09:11:59 | [`4e1fc1e`](https://github.com/agentclientprotocol/claude-agent-acp/tree/4e1fc1e8df2b9af3b1b2d6880ba90c5862283ba8) |
| `@agentclientprotocol/codex-acp` | `2.2.2` | 2026-10-10 03:31:09 | [`202e66e`](https://github.com/agentclientprotocol/codex-acp/tree/202e66e63343ec4f5a5e35ab590251d813d129ca) |

Versions, publication times, tarballs, and `gitHead` came from the npm registry. Source was downloaded at those exact commits, rather than checking `main` and assuming it had shipped. The Claude adapter depends on Agent SDK `0.3.293`; Ramu uses `0.3.295`. The Codex adapter declares `@openai/codex ^0.160.1` and accepts `CODEX_PATH`; the smoke used the user's existing executable. Adapters add a separately versioned runtime dependency even though they wrap the same SDK/app-server Ramu uses now.

## Verification performed

1. Installed the two pinned adapters in `/tmp/ramu-acp-audit/runtime`, outside Ramu, with install scripts disabled. Downloaded their npm tarballs and release sources for inspection.
2. Ran `scripts/acp-compatibility-smoke.mjs` against those packages and the existing Claude/Codex executables. All four connections passed `initialize`: minimal and negotiated capabilities for each provider. Both negotiated connections passed session creation, read-only mode selection, and session close. The probe sent no prompts, ran no model inference or tools, initiated no login, and did not load or change existing chats. Only its own newly created empty Codex session was deleted; Claude's empty session deletion was rejected and is recorded as `not-deleted`, not a successful cleanup.
3. Ran `scripts/acp-event-compatibility.mjs` against the published Codex `2.2.2` bundle. It omits the CLI entry point, exports the unchanged event translator, and feeds synthetic notifications. It does not start Codex or use an account. Both ordinary and AIR-extension configurations produced the same gaps below. Positive controls confirmed that token context was emitted and rate limits/turn diffs were received and cached internally.
4. Compared native calls and options in `src/main/agent.ts`, `codex.ts`, `helperHistory.ts`, `usage.ts`, `questionTools.ts`, and the existing ACP runner with release implementations, schemas, and extension docs.

Passing a capability advertisement or reading an implementation is **not** equivalent to testing a real agent turn. The deeper verification below adds synthetic contracts and isolated live turns, including steering during tools, permission cancellation, MCP questions, helper Stop/replay, direct-native session recovery, images, and manual compaction. Their integration with Ramu's mappings, durable state, routing, and fallback remains unverified. This audit does not establish complete migration readiness.

## Feature comparison

`Source supported` means a released implementation exists, but Ramu must integrate it and test the complete workflow. `Gap` means the existing behavior cannot be preserved using the checked adapter interface as-is. `Unverified` means no complete equivalent has been established.

| Ramu behavior | Claude ACP 0.89.1 | Codex ACP 2.2.2 | Migration work / evidence |
| --- | --- | --- | --- |
| Existing CLI executable and login | Setup smoke passed | Setup smoke passed | `CLAUDE_CODE_EXECUTABLE` / `CODEX_PATH`; no re-authentication in the smoke. Provider installation/version UI needs separate adapter management. |
| New session, close, model catalog | Setup smoke passed | Setup smoke passed | Both returned model/mode/config catalogs. Current IDs/defaults still need mapping into `AgentModel`. |
| Text streaming, images, tool calls | Live streaming/tools and PNG recognition passed | Live streaming/tools and PNG recognition passed | Need message IDs, completed-block deduplication, content conversion, and child routing in Ramu. One image fixture does not certify every format or attachment flow. |
| Additional workspace directories | Source supported | Source supported | Both accept `additionalDirectories`. Our current ACP runner sends only `cwd`. |
| Scoped Ramu HTTP MCP connection | Source supported | Source supported | Both advertise HTTP MCP. Preserve headers, MCP timeout, per-session scope, question instructions, and tool availability. Not exercised with a real MCP server in the smoke. |
| Steering, queueing, interrupt | Live steering/cancel during a tool passed | Live steering/cancel during a tool passed | Both injected a steer during shell sleep and resumed after cancel. Ramu currently throws from ACP `steer()`; queue ordering, background helpers, and late answers still need client integration tests. |
| Model and reasoning effort | Source supported | Source supported | Smoke returned Claude `effort` and Codex `reasoning_effort` config options. Map discovery, selections, and settings changes. |
| Codex Fast / Standard | Not applicable to existing Claude behavior | Source supported | Smoke returned `fast-mode`. Preserve service-tier selection and fallback settings. |
| Access modes and approvals | Source supported; full equivalence unverified | **Gap: `edits` policy** | Claude exposes default/acceptEdits/auto/bypassPermissions. Codex's four presets do not expose Ramu's `untrusted` approval policy; details below. |
| Read-only background analysis | Mode selection passed; complete workflow unverified | Mode selection passed; exact policy differs | Claude plan mode is not identical to Ramu's `tools: []`/deny-all analysis. Codex read-only uses `on-request`, while Ramu's background analysis uses `never` + readOnly. Need tool/request denial and cancellation tests. |
| Blocking native questions and MCP form/URL input | Live MCP form/URL elicitation passed | Live MCP form/URL elicitation passed | Form answer and form/URL cancellation survived real round trips. Native AskUserQuestion-specific custom answers, child ownership, and Ramu cards remain to be integrated. |
| Ramu async question tools and durable drafts | MCP interface available; integration unverified | MCP interface available; integration unverified | `ask_user`/status/wait/close persistence lives in Ramu. Preserve MCP injection, auto-allow rules, late-answer steering, and independent child questions. |
| Codex native async question cards | Not applicable | **Gap** | Released translator ignores `agentMessage.delivery` and `questions` on completed items. Synthetic test confirms no translated question update. |
| Context/token gauges | Source supported | Translator positive control passed | Both emit `usage_update`; not the same as subscription limits. Ramu must consume these events and retain proper main/helper attribution. |
| Live subscription windows, threshold fallback, reset return | Source supported via raw SDK extension; refresh unverified | **Gap** | Claude can forward `rate_limit_event`; Codex caches account limits but emits no ACP update. Details below. |
| Native helper cards, separate transcripts, background lifecycle | Live Stop and saved-helper replay passed | Live lifecycle/replay passed through legacy capability; canonical capability is stripped in published bundle | Both implement child sessions, but Codex 2.2.2's bundled initialization schema requires the legacy capability workaround or a rebuilt schema. Our ACP client implements neither negotiation nor child event/history routing. Nested/resumed/background workflows still need combined integration tests. |
| Native helper Stop and messaging | **Gap: direct Stop in stock wire interface**; message relay source supported | No targeted child controls; Ramu's existing parent relay can be retained | Both advertise empty child capabilities. Codex documentation explicitly excludes targeted child cancel/close. Claude root-only cancel does not expose `query.stopTask(agentId)` over ACP; a library host can retain it, as checked below. |
| Cross-provider helpers and per-type dynamic routing | **Unverified: hook bridge** | Source supports startup hook config; integration unverified | Claude's in-process `PreToolUse` callback cannot be serialized over ACP. Codex forwards startup hooks, but scoped MCP config, trust, native-tool disabling, and message-boundary refresh must be tested together. |
| Saved main-session recovery | Disposable direct-SDK recovery passed | Disposable direct-app-server recovery passed | Load, stable replay IDs after restart, continuation with earlier context, and preservation of earlier rows passed for new native-created audit sessions. Complex existing Ramu chats and historical helpers remain unverified. |
| Historical native helper recovery and repeated-boot deduplication | Source supported; mapping unverified | Source supported; mapping unverified | Adapters reconstruct children during replay. Validate native task IDs versus ACP child IDs, stable message/tool IDs, historical provider sessions after fallback, partial failures, and no duplicated bubbles. |
| Aside on a fork | Retained native SDK fork passed live idle/active-parent tests | Actual native `codexAside` passed live idle/active-parent tests; **stock ACP ephemeral behavior differs** | Earlier committed context remains available while the parent runs a tool, without interrupting it or persisting Aside into its history. In-flight output freshness/cancel races remain unverified; stock Codex ACP fork still omits `ephemeral: true`. |
| Live command output | Source supported | Source supported | Negotiate output metadata and append deltas to the existing tool row. Ramu's ACP runner does not currently do this. |
| Live file patch snapshots and turn diff row | File-change events source supported | **Gap in live delivery** | Codex ignores `item/fileChange/patchUpdated`, caches `turn/diff/updated`, and exposes negotiated file-change reports later. Completed reports are not equivalent to Ramu's live snapshot updates. |
| Checklist and automatic compaction rows | Live manual compaction/restart passed; automatic trigger unverified | Live manual compaction/restart and synthetic checklist passed; automatic trigger unverified | Consume plan/compaction events or relevant extensions; avoid showing private thought output Ramu currently ignores. |
| Worktree ownership, Undo, Changes reviews, schedules, recaps, fallback chains | Ramu-owned | Ramu-owned | They do not intrinsically require a native protocol. They still depend on accurate terminal states, background helper status, limit signals, read-only analysis, and persistent recovery. Upstream support alone does not validate these workflows. |

## Confirmed differences and uncertain equivalents

### Codex subscription limit signals

Ramu reads `account/rateLimits/read` and consumes `account/rateLimits/updated`, retaining percentage, window duration, and reset time for usage gauges, pre-emptive fallback, and return after reset.

In released ACP, [`CodexEventHandler`](https://github.com/agentclientprotocol/codex-acp/blob/202e66e63343ec4f5a5e35ab590251d813d129ca/src/CodexEventHandler.ts#L578) caches an account update and returns `null`. The event probe confirmed this with a synthetic 95% five-hour reading, even with AIR extensions enabled. The live adapters also rejected direct `account/rateLimits/read` as method-not-found, confirming no native RPC passthrough.

[`/status`](https://github.com/agentclientprotocol/codex-acp/blob/202e66e63343ec4f5a5e35ab590251d813d129ca/src/CodexCommands.ts#L294) refreshes limits and emits formatted text with rounded percentages and human-readable reset times. Parsing that text is not an established equivalent to live structured account updates. `_meta.quota` reports tokens spent by the turn, not the subscription windows.

Claude is more capable here: [`emitRawSDKMessages`](https://github.com/agentclientprotocol/claude-agent-acp/blob/4e1fc1e8df2b9af3b1b2d6880ba90c5862283ba8/src/acp-agent.ts#L1549) can filter `rate_limit_event` and send it through `_claude/sdkMessage`, preserving raw fields for `claudeReadings`. Its regular rate-limit `usage_update` is gated on having assistant usage. The raw extension avoids that gate. However, Ramu's on-demand structured `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({skipBehaviors:true})` call has no checked ACP control-method equivalent. The adapter's `/usage` formats the result into chat text.

### Codex live patches and turn diffs

The released [event translator](https://github.com/agentclientprotocol/codex-acp/blob/202e66e63343ec4f5a5e35ab590251d813d129ca/src/CodexEventHandler.ts#L644) explicitly ignores `item/fileChange/patchUpdated`. It caches aggregate turn diffs rather than streaming them as ACP updates. Both behaviors were reproduced against the published bundle. It can report completed file changes and a negotiated per-turn file-change report; those do not preserve Ramu's live patch snapshots and live collapsed turn-diff row.

### Codex native async questions

Ramu creates nonblocking question cards from completed `agentMessage` items with `delivery: 'async'` and `questions`. The released [completion translator](https://github.com/agentclientprotocol/codex-acp/blob/202e66e63343ec4f5a5e35ab590251d813d129ca/src/CodexEventHandler.ts#L854) remembers message phase and returns `null` for agent messages. It does not translate that question metadata. A synthetic item with a title and two choices produced no ACP update. Blocking elicitation and Ramu's MCP question tools are separate supported paths; they do not prove native async cards work.

### Exact Codex approval policy

Ramu uses `untrusted` + workspaceWrite for `edits`, `on-request` + workspaceWrite for `auto`, and `never` + readOnly for background analysis. The adapter's [four modes](https://github.com/agentclientprotocol/codex-acp/blob/202e66e63343ec4f5a5e35ab590251d813d129ca/src/AgentMode.ts#L40) are:

| Adapter mode | Approval policy | Reviewer |
| --- | --- | --- |
| `read-only` | `on-request` | user |
| `workspace-write` | `on-request` | user |
| `agent` | `on-request` | auto_review |
| `agent-full-access` | `never` | user |

[`sendPrompt`](https://github.com/agentclientprotocol/codex-acp/blob/202e66e63343ec4f5a5e35ab590251d813d129ca/src/CodexAcpClient.ts#L1172) explicitly passes those policies to every turn. Setting `CODEX_CONFIG.approval_policy` does not establish parity because the turn overrides it. Mapping `edits` to workspace-write changes when commands require approval. Mapping `auto` to agent changes the reviewer. Never silently relax an existing setting to make migration appear complete.

### Claude native helper Stop and routing

Claude's [child announcement](https://github.com/agentclientprotocol/claude-agent-acp/blob/4e1fc1e8df2b9af3b1b2d6880ba90c5862283ba8/src/native-subagents.ts#L479) publishes an empty capability object. `session/cancel` operates on root SDK queries. The [async task stop extension](https://github.com/agentclientprotocol/claude-agent-acp/blob/4e1fc1e8df2b9af3b1b2d6880ba90c5862283ba8/docs/air-extensions.md#async-tasks) excludes native `local_agent` tasks. No released ACP equivalent was found for Ramu's direct `query.stopTask(agentId)` control. Main-agent message relay is available through steering, but changes the existing direct Stop behavior.

Ramu also uses a dynamically evaluated SDK `PreToolUse` callback to redirect native Agent/Task calls according to current routing, type, model, and quota. The adapter accepts SDK options, but functions cannot cross JSON-RPC; there is no checked client callback bridge. A command/HTTP hook bridge could be investigated, but is not verified by this audit. Codex's startup-hook configuration is implemented and documented; it still needs the complete Ramu hook/MCP/trust/refresh path tested.

### Recovery and forks

Both releases resume native IDs and reconstruct saved history/children. This is positive source evidence, not proof that every existing Ramu chat can resume safely. Before migrating, test fixtures from direct SDK/app-server sessions and historical fallback sessions, including helper ownership and stable IDs on a second boot.

Codex's [ACP fork](https://github.com/agentclientprotocol/codex-acp/blob/202e66e63343ec4f5a5e35ab590251d813d129ca/src/SessionFork.ts#L39) does not request an ephemeral thread. Ramu's Aside does. A durable fork with delete/close cleanup is a possible replacement, but needs verification, including cancellation and cleanup failures. Claude supports session forks and SDK option pass-through; tool-free analysis must still be enforced and tested separately from selecting plan mode.

## Reproduce the protocol and translator probes

Use a disposable directory. These commands do not install anything into Ramu:

```sh
ACP_AUDIT_DIR=$(mktemp -d)
npm install --prefix "$ACP_AUDIT_DIR" --ignore-scripts --no-audit --no-fund \
  @agentclientprotocol/claude-agent-acp@0.89.1 \
  @agentclientprotocol/codex-acp@2.2.2

CLAUDE_CODE_EXECUTABLE="$(command -v claude)" \
CODEX_PATH="$(command -v codex)" \
  node scripts/acp-compatibility-smoke.mjs "$ACP_AUDIT_DIR"

node scripts/acp-event-compatibility.mjs "$ACP_AUDIT_DIR"

CLAUDE_CODE_EXECUTABLE="$(command -v claude)" \
CODEX_PATH="$(command -v codex)" \
  node scripts/acp-hybrid-feasibility.mjs "$ACP_AUDIT_DIR"
```

The protocol probe prints versions, advertised capabilities, config IDs, mode names, and result categories. It does not print account identity, credentials, transcript contents, or session IDs. A runtime/setup failure exits nonzero. The translator probe is pinned to the `2.2.2` readable bundle layout and fails if it cannot safely omit CLI startup. Its synthetic tests report gaps and include positive controls; they are not complete ACP wire tests or real-model validation.

## Follow-up: hybrid integration and adapter modifications

This changes the feasibility assessment, not the active provider connections. An interface gap in the stock adapter is not necessarily a missing capability in Claude or Codex.

### Findings with additional runtime evidence

**Claude has an exported library, not just a command-line adapter.** The published package exports `ClaudeAcpAgent` from `dist/lib.js`; its public `sessions` map retains the owning SDK `Query`. A Ramu-owned local ACP host could attach functions after decoding a request and before calling `agent.newSession`, so hook callbacks would never need to be serialized across JSON-RPC. Source merges those SDK hooks with the adapter's own hooks.

`scripts/acp-hybrid-feasibility.mjs` created a disposable, non-persistent, tool-free session using that published library. It verified that an `Agent|Task` `PreToolUse` callback:

- remained the same callback in the host's creation parameters;
- was registered with the native CLI during SDK initialization;
- shared an owning Query with available `stopTask` and structured usage methods.

No prompts or inference were sent. This verifies callback registration and access to the Query; it does not demonstrate a real task being redirected or stopped. The script disposes its own Query afterwards.

This provides a concrete host design for Claude helper Stop, dynamic routing, and structured usage: narrowly scoped local control handlers can invoke the same Query the adapter owns. It avoids launching a second resumed Query to control the first one. The host must associate controls with the correct Ramu chat/native parent and preserve this association through session load/rebuild.

**A separately launched Codex app-server is not an observer of the ACP-owned runtime.** The same script started two native servers sharing one disposable `CODEX_HOME`, created an ephemeral thread in the first, and queried loaded threads in both. The owner saw its thread; the second process did not. The test used no inference and disposed both servers.

This rules out treating a second process's loaded-thread state as equivalent to the owner's state. Account usage reads and persisted history are suitable independent native paths. Live patches, question metadata, approvals, and native task controls need the owning app-server connection, an explicitly shared server transport, or changes to the adapter. The stock adapter starts its own stdio server via [`startCodexConnection`](https://github.com/agentclientprotocol/codex-acp/blob/202e66e63343ec4f5a5e35ab590251d813d129ca/src/CodexJsonRpcConnection.ts#L39); it does not expose an arbitrary native passthrough connection.

### How each remaining gap can be addressed

These are checked implementation paths, not finished or fully verified features.

| Requirement | Feasible approach | Remaining evidence required |
| --- | --- | --- |
| Subscription windows and refresh | Retain Ramu's SDK/app-server usage reads. Claude library host can also read the owning Query directly. | Refresh cadence, freshness, reset return, and fallback while ACP turns run. No need to remove native usage code to migrate chat. |
| Codex live patches and aggregate turn diffs | Forward the missing native notifications from the adapter's owning app-server before translation, or add translated updates in `CodexEventHandler`. Reuse Ramu's existing patch/diff handling. | End-to-end streaming, ordering, main/helper attribution, completion handling, and no duplicated ACP/native events. A filesystem watcher cannot fully replace provider item snapshots. |
| Codex native async questions | Forward `agentMessage` completion including `delivery` and `questions`, or add a custom metadata update. Reuse Ramu's existing async-card conversion. | Full choice/text replies, late answers, durable drafts, and root/child question ownership. Merely routing agents to MCP questions changes the native behavior. |
| Exact Codex access modes | Add adapter mode/config choices for Ramu's policies and pass them through `sendPrompt`; keep the existing sandbox roots. | Assert the policy on each actual turn, including resume, steering, helpers, analysis, and settings changes. Native `AskForApproval` still includes `untrusted`; this is an adapter preset limitation. |
| Claude direct native helper Stop | Add a narrow host control that calls the owning `agent.sessions[parentId].query.stopTask(nativeTaskId)`. | The live probe below stopped a real background helper, received `cancelled`, and continued its parent. The production ownership/control bridge and resumed/nested helper cases remain unimplemented and unverified. |
| Claude dynamic per-type routing | Inject Ramu's callback in the exported library host after parsing incoming ACP params. Callback registration with the CLI was verified. | Real tool-call interception and dynamic routing updates while running, including full-access mode and quota changes. |
| Codex routing hooks | Preserve existing native startup-hook config and scoped MCP decisions in the adapter-owned runtime. | Native-tool configuration, trust, hook denial/redirect, and message-boundary refresh under the complete host lifecycle. |
| Native helper messaging/Stop via parent | Keep Ramu's existing steering relay where it already uses one, including Codex. Neither stock adapter advertises targeted child cancel/close. | Verify steering and background-turn delivery; do not claim native direct child controls exist. |
| Saved chats and helper recovery | Keep native SDK/app-server history readers and current provider IDs; map ACP child identities into existing Ramu task IDs. | Real direct-integration transcript fixtures, historical provider sessions after fallback, stable message IDs, and repeated boot recovery. Read-only history access does not require controlling the active Query. |
| Aside and tool-free analysis | Retain existing native Aside readers/forks, or extend adapter fork/options to express ephemeral and deny-all semantics. | Verify durable history freshness, cancellation, no tool execution, and cleanup. A separate native fork is independent analysis; it must not be treated as an observer/controller of the live owner. |
| Other ACP client features | Extend `src/main/acp.ts` for negotiated steering, effort/fast config, elicitation, children, streaming output, plan/context/compaction, and additional directories. | Wire and service tests, followed by real-provider runs. These are client implementation tasks rather than fundamental protocol blockers. |

Codex's source offers an interception point before losing events: `CodexAcpClient.subscribeToSessionEvents` invokes its handler with native notifications. A maintained adapter patch can forward selected events there through a Ramu extension and add exact policies to `AgentMode`/`sendPrompt`. An alternative is a proxy around the owning stdio process, selected using `CODEX_PATH`, but that adds framing, request routing, cancellation, and lifecycle work. A completely independent app-server process is not a substitute for either design.

The missing behaviors appear implementable with a Ramu-owned Claude library host and a maintained Codex adapter extension. The additional checks below strengthen this evidence without installing adapter patches or changing application routing. Complete live workflow parity remains unverified.

## Deeper verification: controls, ordering, and scoped MCP

`scripts/acp-control-contracts.mjs` exports unchanged classes/functions from the pinned published Codex bundle, omitting CLI startup. It uses a synthetic native transport, not a model or real app-server. Its original seven contract groups passed; the later published-capability-schema check also passed and reproduced the canonical negotiation gap:

- `sendPrompt` preserves each stock policy, model, effort, fast service tier, image content, and additional workspace roots. Probe-only custom modes also preserve `untrusted` for edits and `never` + readOnly for analysis. The custom modes are not installed or selectable in the released adapter. Cancellation before turn start prevents the native turn call.
- Steering supplies `expectedTurnId` and preserves image input. This checks request construction, not racing an actual running turn.
- Child discovery registers the listener synchronously before root output completes. The serialized notification queue keeps root-before-child order, preserves the exact raw child patch object before translation, and rejects a wrong-thread child notification.
- Child permissions wait for the queued events, target the child after its announcement, and cancel when the child cannot be resolved. Resubscription updates capability behavior; hidden-child interactions are attributed to the root.
- HTTP MCP URL/auth headers and additional-root trust survive configuration conversion. However, generated HTTP configuration omits Ramu's `tool_timeout_sec=3600`. A same-name server in native config causes the scoped requested server to be skipped. Both differences were reproduced.
- The actual fork function sends `excludeTurns: true` but ignores probe `_meta.ephemeral`. A subsequent model-discovery failure releases the fork subscription; the tested dependency callback does not delete the fork. Subscription release must not be reported as persistent fork cleanup.
- Claude's published library supports host-owned idle steering through `_meta.steering.idleBehavior='promptRequired'`, injects active input while tracking its echo UUID, and rejects steering a closed Query. Ramu should opt into the idle behavior to keep prompt lifecycle ownership explicit.

`scripts/acp-claude-host-contracts.mjs` uses the real Claude ACP library and its real SDK with a synthetic subprocess transport. It starts no executable, accesses no account, and performs no inference. All checks passed:

- The registered hook ID invokes the host callback through the SDK's native control channel. Changing host routing state between two hook requests changes the returned decision from deny to allow without rebuilding the Query.
- `stopTask(nativeTaskId)` sends `stop_task` to the same subprocess owned by the ACP Query. This proves control routing, not the stopping of a real helper.
- Structured usage returns both subscription windows through the same Query and preserves `skip_behaviors: true`.
- An injected SDK `canUseTool` is overridden by the adapter's own callback. A native permission request still enters ACP's callback and gets denied for an unknown session; the injected callback is never invoked.

The last point refines the host design: injecting SDK options is sufficient for Ramu's routing hooks, but not for replacing `canUseTool`. Ramu's automatic allowance for its scoped question tools must be implemented in the ACP permission handler or an explicit host wrapper. Deny-all analysis must combine `tools: []`, no MCP servers, and cancelled permission/elicitation responses, or an independently enforced host hook. Selecting plan mode alone does not prove tool-free analysis.

The scoped MCP differences require deliberate handling before migration. Preserve the one-hour timeout through a maintained adapter option/config change, and avoid silently using an existing `ramu` server with the wrong per-session URL or credentials. A unique per-session server name is possible, but would require adapting Ramu's tool-name matching. No real MCP connection or question wait was exercised by the configuration contract.

The real native Codex app-server also accepted three additional ephemeral empty threads with the policies Ramu needs: `untrusted` + workspaceWrite, `never` + readOnly, and `on-request` + workspaceWrite. Returned policies and sandbox types matched. This used a disposable `CODEX_HOME` and no inference. Combined with the `sendPrompt` contract, the edits/analysis mismatch is an adapter preset limitation, not rejection by the installed native server. It still requires actual per-turn and resume validation after implementation.

Reproduce these additional checks outside Ramu:

```sh
node scripts/acp-control-contracts.mjs "$ACP_AUDIT_DIR"
node scripts/acp-claude-host-contracts.mjs "$ACP_AUDIT_DIR"
```

The optional `scripts/acp-live-turn-audit.mjs "$ACP_AUDIT_DIR" --live` uses existing provider login and a small amount of inference in disposable sessions. It deliberately requires `--live`; it is not a no-inference probe. It tests Claude native helper interception and ordinary Codex text streaming, cancels permission requests, and prints no transcript, session ID, or credentials. Claude persistence is disabled; Codex deletes only its own new session.

This live probe was run on 2026-10-11 with the pinned adapters and the user's configured executables. Both cases passed:

| Live case | Observed result | Limits of evidence |
| --- | --- | --- |
| Claude host routing hook | Exactly one native helper call reached the hook and was denied; no `subagent_spawned` was emitted. The final marker streamed and the turn returned `end_turn`. Tool and usage updates were also received. | Tests denial before spawn. Does not test stopping an already-running helper, dynamic full-access routing, child recovery, or cross-provider execution. |
| Codex stock ACP text turn | Final marker streamed in five message chunks, token usage was emitted, no tool calls or permission requests occurred, and the turn returned `end_turn`. Close/delete of this probe's own session passed. | A text-only instruction is not proof of deny-all enforcement. No patches, async question metadata, helpers, steering race, fallback, or saved user session replay was exercised. |

Only these new disposable sessions were used; no existing user chats were loaded. Active Ramu providers, dependencies, and adapter routing remain unchanged. The successful live hook narrows the Claude routing uncertainty: native call interception works through the custom-library-host approach, while the full Ramu routing lifecycle remains unverified.

## Further live verification: Stop, native recovery, and subscription reads

Three additional diagnostic scripts were run on 2026-10-11. No active Ramu integration or dependency was changed.

### Real Claude helper Stop

`scripts/acp-live-helper-stop.mjs` created a non-persistent ACP-library-host session with only the Agent tool exposed. A native helper was requested in the background. On its raw `task_started` event, the host called the parent's owning SDK Query `stopTask(task_id)`.

The passing run observed all of the following:

- The native task reported `is_backgrounded: true` and Stop was acknowledged.
- ACP announced the child and then emitted `subagent_state_update` with `state: 'cancelled'`.
- The parent turn finished with `end_turn`, and a separate follow-up prompt to that parent session streamed its marker and also finished with `end_turn`.

An initial probe also saw the acknowledged stop and cancelled child, but its first-response marker assertion failed. The revised probe checks parent usability with an explicit follow-up rather than requiring the model to volunteer a particular response to a background notification. This proves a real child can be stopped through the host while its parent remains usable. It does not add a stock ACP targeted-child Stop method or validate Ramu's production ID/ownership bridge, nested helpers, resume, or user-button timing.

### Direct native sessions loaded and continued through ACP

`scripts/acp-live-recovery-audit.mjs` created one new session through the direct Claude SDK and one through the direct Codex app-server. Each native session was given a unique audit token using a tool-free text turn. The native owner was closed before ACP loaded that session.

Both providers passed:

1. ACP replay contained the native user/assistant pair and the original marker.
2. A new ACP host/process loaded the same session again and returned identical replay rows with nonempty, stable message IDs.
3. An ACP continuation remembered the earlier token and returned `end_turn`.
4. A third fresh host/process replayed the continuation while preserving the original rows and IDs.
5. Deletion of each probe-owned session succeeded after closing its owner.

The continuation assertion initially checked individual streaming chunks for the full token; this was a probe error because a token can cross chunk boundaries. After assembling the assistant chunks, both providers passed. These results verify simple native-to-ACP main-session recovery, not every existing chat: native helper transcripts, compaction, tools, historical provider fallback, durable question drafts, and Ramu database deduplication are separate remaining cases. Existing user chats were never loaded.

### Actual structured subscription reads without inference

`scripts/acp-subscription-read-audit.mjs` performed real read-only usage requests using existing provider login, sending no prompts:

- Claude's owning ACP-library Query returned structured `rate_limits.five_hour` and `rate_limits.seven_day`, with valid percentage utilization and parseable reset timestamps, through `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true })`.
- An independent native Codex app-server returned primary/secondary structured account windows with valid percentages, durations, and reset timestamps. No thread was started or loaded by this Codex read.

This directly supports keeping subscription refresh on the native SDK/app-server paths. It does not validate a refresh cadence while a turn is running, mid-turn limit propagation, reset return, or fallback through an unimplemented ACP runner.

Reproduce the new checks with the isolated installation and the desired existing executables:

```sh
node scripts/acp-live-helper-stop.mjs "$ACP_AUDIT_DIR" --live
node scripts/acp-live-recovery-audit.mjs "$ACP_AUDIT_DIR" --live
node scripts/acp-subscription-read-audit.mjs "$ACP_AUDIT_DIR"
```

The first two scripts use live inference and only new disposable audit sessions. They require `--live`. The subscription script performs account reads without inference. All print result categories/counts rather than transcript text, session IDs, credentials, or account-window values. Both recovery sessions were deleted successfully; the Stop probe disables parent persistence and disposes its owner.

The existing Ramu unit suites for usage, helper history, routing, question tools, AgentService, and Codex also passed: **6 files / 143 tests passed, 1 skipped**. These cover current fallback thresholds/reset return, native helper handling/recovery, questions, and usage parsing. This is baseline validation of the current implementation; it is not a test of a migrated ACP integration.

## Complete coverage review and further interaction checks

### Live steering, cancellation, and rejected writes

`scripts/acp-live-interactions.mjs` passed all six cases against the pinned releases:

| Case, tested for both providers | Observed result |
| --- | --- |
| Steering while a shell sleep was running | Adapter returned `injected`; the running turn followed the new instruction and ended normally. |
| Cancel while a shell sleep was running | Original turn returned `cancelled`; a follow-up prompt to the parent completed normally. |
| Cancel an actual write permission | Permission request was attributed to the parent; the requested file in the disposable directory was absent; the parent remained usable. |

The write probe used Claude's explicit ask hook and Codex read-only escalation. The approved timing probes only ran `sleep` in disposable directories. They do not validate every per-mode policy or nested helper approval; the Codex custom `untrusted`/analysis presets remain an adapter implementation task.

### Live scoped HTTP MCP and elicitation

`scripts/acp-live-mcp-audit.mjs` started a local authenticated MCP audit server. Both providers passed:

- The per-session Authorization header survived ACP configuration and reached the local server; no unauthenticated request occurred.
- A form with two choices reached the correct parent session, retained its schema, and returned the chosen answer through ACP, the native agent, and MCP.
- Form cancellation and URL cancellation both reached the MCP tool as `action: 'cancel'`.
- A follow-up prompt after the questions/cancellations completed normally.

The server name was unique per session, demonstrating a way to avoid the confirmed Codex config-name collision. Adopting that convention would require adjusting Ramu's name-based question-tool rules. The probe uses a synthetic question tool, not Ramu's durable `ask_user` service, and it does not wait an hour to validate a timeout. The missing Codex timeout configuration remains confirmed.

### Saved native helper replay and a new published-bundle gap

`scripts/acp-live-helper-recovery.mjs` passed saved-helper replay for both providers. Claude's fixture was created through the direct SDK; its native helper reader also found the saved transcript. Codex's fixture was created through ACP over its native app-server. Each replay retained the child's transcript attribution and nonempty message IDs; a fresh host/process returned identical child IDs and transcript rows on the second boot. The successful fixtures' parent sessions were deleted, and the successful Codex helper thread was separately deleted.

**Codex 2.2.2's shipped bundle strips canonical child negotiation.** Initial Codex trials called helpers but produced no child-session announcements when only `clientCapabilities.subagents: {}` was sent. Inspection found that the package embeds a schema whose `zClientCapabilities` lacks `subagents`; the wire parser strips that field before `clientSupportsSubagents` reads it. The source implementation and the separately installed ACP SDK are newer than this embedded validation surface.

`scripts/acp-control-contracts.mjs` now parses requests with the unchanged published `zInitializeRequest`: canonical `subagents` is absent after parsing and child support evaluates false. The documented legacy `_meta.jetbrains.air` capability `nativeSubagentSessions` survives parsing and evaluates true. A live rerun with that legacy capability passed child announcements, transcript recovery, and stable IDs. This is a verified workaround, not canonical negotiation support. Rebuilding/patching the adapter's bundled schema is another path; installing a newer external SDK alone cannot replace a schema already bundled into its executable.

The first canonical-capability trial was not a helper recovery pass. It deleted its parent fixture, but no child-session ID was recorded by that trial; its helper cleanup is not claimed. The reproducible successful probe now uses explicit legacy negotiation and deletes its known child. It does not prove nested helper generations, resume after cancellation, or historical cross-provider helper recovery.

### Baseline checks

The full existing test suite passed: **43 files passed / 2 skipped, 410 tests passed / 9 skipped**. The opt-in real Codex hook-trust test was then run separately in a disposable `CODEX_HOME` and passed **1 test**. The current Ramu startup hook can be trusted through its native app-server path; ACP's complete Ramu routing hook/MCP/config composition still needs implementation and verification.

### Retaining native Aside after an ACP chat

The separate opt-in suite `scripts/acp-native-aside.live.test.ts` passed **2 live tests**. It uses saved ACP-owned audit chats and retains the native analysis path:

- Claude's direct SDK fork used `forkSession: true`, `persistSession: false`, `tools: []`, and a denying permission callback. It retained earlier context, had a different session ID, and left the parent's saved messages unchanged.
- The actual Ramu `codexAside` function read context from an ACP-owned thread using its existing ephemeral read-only native fork. The parent's saved turns were unchanged, and the saved-thread list for that disposable workspace gained no extra thread.

Both idle parent fixtures were cleaned up. A subsequent run passed **2 additional live tests** with a parent actively executing `sleep 10`. The native Aside began before the parent prompt resolved, retained the earlier saved token, and left the parent able to finish normally. Aside-only prompt text was absent from saved parent history; Codex's workspace had no additional durable thread. These active parent fixtures were also cleaned up. These tests do not certify freshness of uncommitted in-flight output, abort races, or automatic cleanup under a native process failure.

### Release recheck and isolated repairs

The registry recheck still returned Claude `0.89.1` and Codex `2.2.2`, with the same publication timestamps and git heads recorded above. Re-running the stock event/control probes reproduced the existing gaps.

`scripts/acp-isolated-patch-audit.mjs` passed against a temporary copy of the Codex published bundle, using synthetic native transport. It verifies a repaired canonical helper-capability schema, scoped HTTP auth plus a 3600-second MCP timeout, selectable custom edits/analysis modes whose exact policies reach `sendPrompt`, and an opt-in ephemeral fork while retaining the stock durable default. A diagnostic interception wrapper also retained the four previously dropped native payload types while preserving stock rate-limit/diff bookkeeping. The temporary module was removed. These checks establish prototype feasibility, not a production adapter implementation: extension validation, live wire delivery, session ownership, child attribution, and Ramu integration still need testing.

### Remaining state and settings contracts

`scripts/acp-state-contracts.mjs` passed **4 synthetic contract groups** using unchanged code from the published Codex bundle:

- Canonical compaction, plan, boolean config, and form/URL capabilities survive initialization parsing. Compaction updates survive the notification schema; repeated start/completion and legacy/item completion surfaces do not create duplicate terminal updates. Cancellation is scoped to its session; outstanding failures become terminal once.
- Checklist statuses map correctly. Command output chunks and exit codes survive, and streamed output is not repeated on completion.
- Negotiated Markdown plan snapshots survive the wire schema and are not repeated at completion. Clients without plan negotiation receive the completed plan as text.
- Additional roots survive new/load/resume/fork request schemas; duplicate/parent roots are removed, and invalid roots are rejected by the implementation before a native call.

The extended `scripts/acp-claude-host-contracts.mjs` also passed real-library/SDK control round trips through a synthetic native subprocess: model selection, effort, clearing default effort with explicit `null`, and boolean fast mode. Rejected effort/fast controls retain the prior displayed state, and an invalid effort is rejected. No model inference was requested. These results verify released control/state contracts; they do not verify real model availability, image interpretation, live automatic compaction, complex recovery after compaction, or Ramu's future UI mappings.

Reproduction:

```sh
node scripts/acp-isolated-patch-audit.mjs "$ACP_AUDIT_DIR"
node scripts/acp-state-contracts.mjs "$ACP_AUDIT_DIR"
node scripts/acp-claude-host-contracts.mjs "$ACP_AUDIT_DIR"
```

Additional reproduction commands:

```sh
node scripts/acp-live-interactions.mjs "$ACP_AUDIT_DIR" --live
node scripts/acp-live-mcp-audit.mjs "$ACP_AUDIT_DIR" --live
node scripts/acp-live-helper-recovery.mjs "$ACP_AUDIT_DIR" --live
RAMU_REAL_CODEX=1 pnpm exec vitest run test/codexHook.live.test.ts
RAMU_ACP_LIVE=1 RAMU_ACP_AUDIT_DIR="$ACP_AUDIT_DIR" \
  pnpm exec vitest run --config scripts/acp-audit.vitest.config.mts
```

### Final current-machine verification pass

The requested final pass rechecked registry releases (unchanged), setup negotiation, the published event/control/state contracts, isolated repair prototypes, native subscription reads, and native ownership/policy feasibility. The repository's full baseline passed **410 tests / 9 skipped**, typecheck passed, the desktop production build passed, and release-script checks passed **3 tests**. Baseline success describes the current native integrations; it does not certify a migrated runner.

The live reruns passed all **4 retained-native Aside tests**, both providers' steering/tool cancellation/permission cancellation and scoped HTTP MCP form/URL round trips, Claude native background helper Stop/routing denial, both providers' direct-native main-session recovery and helper replay with stable identities, and Codex streaming. The opt-in native Codex hook trust test passed **1 test**. Codex helper replay still required the legacy capability. The new saved recovery fixtures' own parent/child cleanup passed. This does not resolve the cleanup uncertainty for earlier failed canonical-negotiation fixtures described above.

`scripts/acp-live-image-compaction.mjs` added real inference checks in disposable audit chats. Both providers recognized the dominant color of a generated PNG supplied only as image bytes. Both passed manual `/compact` lifecycle, repeated restart recovery with stable replay, and continuation retaining a token from before compaction. Both owned chats were deleted. Automatic context-threshold compaction was not forced, and this does not certify every image format, long history, partial tool result, or historical fallback chain.

Two initial Claude assertions were too strict: completion updates can deliberately enrich the same terminal entity, and a compacted transcript can replay retained text as a compaction summary rather than ordinary message rows. The corrected test checks one entity ID, no state regression, stable summary/message replay, and successful context continuation. It passed with two terminal reports for one compaction entity. A future Ramu mapping must upsert by `compactionId`, preserving prior summary/metadata when later patches omit them.

```sh
CLAUDE_CODE_EXECUTABLE=/path/to/claude CODEX_PATH=/path/to/codex \
  node scripts/acp-live-image-compaction.mjs "$ACP_AUDIT_DIR" --live
pnpm typecheck
pnpm exec vitest run
pnpm build
pnpm test:scripts
```

**Disposition:** stock adapter parity has known failures, and combined migration readiness remains unverified. Passing diagnostic tests that deliberately reproduce a stock gap means the gap was confirmed; it does not mean the requirement passed. Existing `src/main/acp.ts` still sends no additional roots, rejects steering, lacks the required output/compaction/child mappings, and selects background modes only from `ask`/`plan` (Codex advertises `read-only`). These require a separate candidate integration before its end-to-end behavior can be tested. No production integration or dependency migration was made. Other supported platforms cannot be certified from this macOS-only run.

### Outstanding acceptance requirements

Every feature in the comparison table has now been classified, but not every feature can be validated end to end against the unmodified adapters. Technical readiness is still incomplete:

| Remaining requirement | Current evidence | Why it cannot yet be marked complete |
| --- | --- | --- |
| Codex subscription events during active turns | Structured native reads work; stock translator drops live updates; isolated forwarding wrapper retains payloads. | Implement owning-process event forwarding and test fallback/reset cadence under active turns. |
| Codex live patches, aggregate diffs, native async question metadata | Published translator tests confirm information loss; raw notification queue and isolated forwarding wrapper retain payloads. | Implement the adapter extension and test live delivery, ordering, reply flow, and main/child attribution. |
| Exact Codex edits/analysis modes | Native server accepts policies; isolated prototype exposes modes and preserves policies through `sendPrompt`. | Assert actual turn/resume settings in the repaired live adapter; stock presets do not match. |
| Scoped MCP identity and long question waits | HTTP auth/form/URL round trips pass with unique names; isolated timeout patch passes. | Validate extension inputs and adapt scoped tool-name matching; test Ramu's real async question store, drafts, late-answer steering, and restart. |
| Canonical Codex child negotiation | Canonical capability is stripped; legacy path passes live helper replay; isolated schema repair passes. | Verify repaired live negotiation or deliberately use legacy negotiation; integrate stable identity mapping into Ramu. |
| Claude host controls and dynamic routing | Real hook denial, real child Stop, synthetic dynamic callback state, and native structured usage pass. | Implement scoped Ramu controls and verify nested/resumed helpers, quota/type updates, and cross-provider routing together. |
| Historical recovery across providers | Main-session/child replay and live manual compaction/restart pass; current Ramu history/recovery tests pass. | Exercise partial tool results, missing histories, historical fallback ownership, and duplicate prevention through the new client mappings. |
| Aside during active parent work | Retained native Aside passes idle and active-parent committed-context/history isolation. | Test uncommitted in-flight snapshot freshness and cancellation/failure races; stock ACP fork alone does not preserve Codex ephemeral behavior. |
| Model/effort/fast, images, plan/context/compaction, output, additional roots | Claude settings and Codex plan/output/root contracts pass synthetic tests; both pass live PNG recognition and manual compaction/restart. | Implement Ramu mappings and test automatic compaction, attachment variants, model changes during lifecycle transitions, and resulting UI/state behavior. |
| Worktree isolation, Undo, reviews, schedules, recaps, fallback chains | Current full baseline suite passes; these are Ramu-owned workflows. | Combined runner terminal/error/usage/child mappings are not implemented, so migration-specific end-to-end behavior cannot be claimed. |
| Packaging, install/update, executable/login preferences | Current-machine setup succeeds with existing executables. | Package and test adapter management on supported platforms. No Linux/Windows packaged runtime was exercised here. |

These are concrete remaining implementation/validation requirements, not a claim that Claude/Codex lack ACP or that every stock gap is fundamental. The audit harness is isolated and does not replace Ramu's runners. No migration is authorized by passing these probes.

## Migration gate

Migration requires the user's explicit instruction, even if technical checks later pass. Technical readiness also requires supported replacements for the gaps, integration of the source-supported features, and the following checks:

- Exact access policies, permission/question cancellation, and tool-free background analysis.
- Streaming/deduplication, steering while tools run, late answers, and native async question metadata.
- Native background helper lifecycle, direct Stop, transcript recovery, scoped approvals, and cross-provider routing hooks.
- Structured subscription windows, on-demand refresh, pre-emptive/mid-turn fallback, and reset return.
- Live patch snapshots and aggregate turn diffs, including child attribution.
- Existing SDK/app-server session fixtures, historical provider sessions after fallback, restart continuation, and repeated recovery without duplicates.
- Aside isolation, cancellation, and fork cleanup; provider install/login/binary settings on supported platforms.
- Ramu's relevant automated checks and live-provider compatibility runs.

An upstream capability claim alone must not reopen this gate. Re-run the probes and update this audit when released adapters change. The user permits considering hybrid native paths and modifications; evaluate parity of the resulting combined integration rather than requiring every feature to pass through stock ACP. Technical readiness does not authorize migration.
