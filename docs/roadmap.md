# Roadmap

Unfinished work only. Completed items are removed; lasting behavior lives in the [guide](README.md#guide). Open an issue before starting anything here.

Every item needs scoped tests and typechecks for the packages it touches. Desktop-facing changes also run `pnpm build` then `pnpm test:desktop-smoke` ([contributing](../CONTRIBUTING.md#checks)). Checks that need a physical phone, a signed build, a live provider or a second host are listed under [Acceptance](#acceptance) and stay open until run; fake-provider tests do not close them.

## Release

- macOS signing and notarization in CI, and signed auto-update (`APP_AUTO_UPDATE` in `packages/shared/src/updates.ts` stays `false` until builds are signed). See [Releasing](contributing/releasing.md).
- A clean Linux x64 GUI run of the packaged app. Windows stays unsupported until macOS signing works.
- Mobile distribution: Apple and Google accounts, APNs/FCM credentials, TestFlight and Android internal builds.

## Implementation

- **Transport:** bounded replay and snapshot recovery for every resource, and defined connection outcomes (current, synchronizing, disconnected, authorization rejected, outcome unknown) that keep drafts and queued messages; mutations that cannot be retried report an unknown outcome and reconcile. Start from measurements on real networks ([Architecture](contributing/architecture.md#transport)).
- **Background terminals:** native command handles for Claude, Codex, OpenCode and Cursor need verified owner-lifecycle contracts. The ACP client-terminal boundary is written but enabled for no provider until one is verified against a live runtime.
- **Agent setup:** skill source and ownership details, and per-adapter rule delivery (path-matched activation only where a runtime supports it).
- **Mobile:** IME composition checks on a device, and terminal customization. Add a phone entry for a desktop setting only when it clearly helps someone away from the laptop.
- **Thread titles and state:** a verified provider that supplies titles, title provenance (provider, generated, manual), clearer approval/stopped/turn-limit labels, and request actions that open the exact owning session.
- **Browser and computer use:** provider capability negotiation and more session-import sources. **Open on this phone** reaches only dev servers listening beyond the host's loopback; forwarding one loopback port to one paired phone (expiring, IP-bound, shown with its port) needs a security review first. Computer use on Windows and Linux waits for native capture, permissions and signing.
- **Provider compatibility:** compatibility rules for OpenCode's ACP runner, Cursor and Antigravity after protocol checks; entry points that bypass `validateSettings`.
- **Host facts for agents:** `hostThreads.projects` could add each host's platform, architecture and description so `project_list` lets an agent recommend a host; it changes what a paired host learns, so it needs the same scrutiny as the rest of [host pairing](../SECURITY.md#host-pairing).
- **Activity tokens:** the weekly activity counts turns and reported cost; providers do not record per-turn token counts yet.
- **Helpers on another host:** `ramu_agent` with a `host` would mirror a helper's events into the parent live, which needs an event channel between hosts; a thread started there with its report covers the need until then.
- **Teammates:** a dedicated `teammate_message` tool so the lead and teammate address each other by name, and changes and usage shown per teammate.
- **Git hosting:** Bitbucket Cloud and Azure DevOps adapters, and saved GitLab tokens with clone and publish in Settings. A new forge adds an adapter beside GitHub's and GitLab's in `apps/server/src/workspace/forge/` and a case in `forge/route.ts`.
- **Code quality:** validate push payloads and RPC results on the clients (`any` remains in the phone's transport and push listeners, the desktop's host bridge and its preload). About 140 `react-hooks/exhaustive-deps` disables name the trigger they are keyed on and are mostly deliberate; convert one only when touching it, after checking it neither loops nor refetches.

## Acceptance

- **Physical iOS and Android devices:** everything in [apps/mobile/VERIFICATION.md](../apps/mobile/VERIFICATION.md), the Inbox Brief's one-tap rows, from pairing and permissions to the viewers, keyboards, push and Live Activities.
- **Packaged and signed desktop builds:** upgrading real profiles, browser session import with a real keychain, computer-use permission identity, theme and system-appearance changes, background-terminal stop timing, and installation on a second Mac.
- **Live providers and second hosts:** provider version compatibility records, Shared MCP across two providers, skill and rule delivery, project routing quality, plan-usage and limit-notice handling, GitHub with live tokens and Enterprise hosts, interactive content, agent-started threads and their reports, Auto splits and their briefs, threads started on a second physical host (pairing, ceiling, offline wait, revoke), Continue on another host between a Mac and a Linux host and from a phone, `ramu thread` from a live terminal agent, a schedule on another host running there once after that host sleeps, a login on two hosts shown once and activity totals matching each host, and the review sheet on a physical phone, title generation, the live view window above other apps while an agent works in Browser, an agent finding and fixing a layout bug in an Expo app on an iPhone Simulator (with idb) and an Android emulator, also watched from a phone against a remote Mac, Teammates across providers (Review stays read-only on each runtime), custom agents drafted and used on a live model, Resources figures for each provider with a helper agent and against Activity Monitor and `free`, multi-host load, and a matched HTTP versus WebSocket comparison. Paid calls and credentials are opt-in.

Representative tasks to run once the above is available:

- Ask an agent to open Calculator on one computer and compute `(125 * 8) + 42` (expect `1042`) while watching and stopping it from a phone and a second desktop.
- Stream an agent response and terminal output on one host, answer a permission and stop an agent on a second host, switch hosts, drop Wi-Fi, sleep the phone and resume with drafts and unread state intact.
- Scan concurrent threads (goal, approval, question, usage limit, stalled goal, failed run, unread result) and tell from icons and labels which needs action.

## Decisions and deferred scope

- **Certificate pinning:** not built. It needs a native transport replacement that cannot be verified without device builds. Reopen with a concrete threat that HTTPS pairing and host-identity checks do not cover.
- **Preference sync:** hosts talk to each other only through host pairings for agent-started threads, and no account system exists, so settings do not follow a person across hosts. Credentials and workspace state stay out of any future sync.
- **Remote administration:** network access, pairing and device permissions are managed only at the host. A device's **Change settings** permission covers settings, not this; widening it needs reviewable changes and recovery first.
- **Relay:** no relay or tunnel service. Design it separately from direct-host push.
- **Deferred:** a full mobile editor, dedicated mobile provider sign-in, chunked large-file upload, marketplaces for MCP, themes or skills, arbitrary plugin or hook execution, automatic provider-file or credential synchronization, AI conflict resolution, local grounding models and VMs for computer use, and vector retrieval for learning.
- **Evidence rule:** claim an improvement over another application only with matched-task evidence, not source inspection or one demo.
