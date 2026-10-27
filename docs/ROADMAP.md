# Roadmap

Unfinished work only. Completed items are removed; lasting behavior lives in the feature guides. Open an issue before starting anything here.

Every item needs scoped tests and typechecks for the packages it touches. Desktop-facing changes also run `pnpm build` then `pnpm test:desktop-smoke` ([contributing](../CONTRIBUTING.md#checks)). Checks that need a physical phone, a signed build, a live provider or a second host are listed under [Acceptance](#acceptance) and stay open until run; fake-provider tests do not close them.

## Release

- macOS signing and notarization in CI, and signed auto-update (`APP_AUTO_UPDATE` in `packages/shared/src/updates.ts` stays `false` until builds are signed). See [Releasing](RELEASING.md).
- A clean Linux x64 GUI run of the packaged app. Windows stays unsupported until macOS signing works.
- Mobile distribution: Apple and Google accounts, APNs/FCM credentials, TestFlight and Android internal builds.

## Implementation

- **Transport:** bounded replay and snapshot recovery for every resource, and a written set of connection outcomes (current, synchronizing, disconnected, authorization rejected, outcome unknown) that keeps drafts and queued messages through each. Mutations that cannot be retried safely report an unknown outcome and reconcile.
- **Background terminals:** native command handles for Claude, Codex, OpenCode and Cursor need verified owner-lifecycle contracts. The ACP client-terminal boundary is written but enabled for no provider until one is verified against a live runtime.
- **Agent setup:** skill source and ownership details, owned-link cleanup, per-adapter rule delivery (path-matched activation only where a runtime supports it), and an "effective setup" view that never claims a file is loaded merely because it was written.
- **Shared MCP:** provider-session HTTP/stdio lifecycle and approvals around the gateway, discovery and import previews, and approvals shared across accounts so a backup account continues a task without another prompt.
- **Mobile:** advanced composer parity (command and skill discovery, elicitation fields, IME), terminal customization, and pages for skills, MCP and memory. Add a phone entry for a desktop setting only when it clearly helps someone away from the laptop.
- **Thread titles and state:** a verified provider that supplies titles, title provenance (provider, generated, manual), clearer approval/stopped/turn-limit labels, and request actions that open the exact owning session.
- **Browser and computer use:** provider capability negotiation, remote and mobile collaborative control, more session-import sources. Computer use on Windows and Linux waits for native capture, permissions and signing.
- **Provider compatibility:** compatibility rules for OpenCode's ACP runner, Cursor and Antigravity after protocol checks; entry points that bypass `validateSettings`.
- **Git hosting:** GitLab, Bitbucket Cloud and Azure DevOps. A new forge adds an adapter beside GitHub's in `apps/server/src/workspace/forge/`.
- **Remote security:** remaining viewer write-surface controls. The server allowlist is the boundary, not hidden controls.
- **Code quality:** replace the remaining `any` types and `react-hooks/exhaustive-deps` warnings reported by `pnpm lint`.

## Acceptance

- **Physical iOS and Android devices:** host discovery and pairing, voice input, interactive content gestures, browser and computer-use viewers, Explorer, mobile settings and model flow, push and Live Activities, terminal customization, and viewer-role recovery. The checklist is [apps/mobile/VERIFICATION.md](../apps/mobile/VERIFICATION.md).
- **Packaged and signed desktop builds:** upgrading real profiles, browser session import with a real keychain, computer-use permission identity, theme and system-appearance changes, background-terminal stop timing, and installation on a second Mac.
- **Live providers and second hosts:** provider version compatibility records, Shared MCP across two providers, skill and rule delivery, project routing quality, plan-usage and limit-notice handling, GitHub with live tokens and Enterprise hosts, interactive content, title generation, multi-host load, and a matched HTTP versus WebSocket comparison. Paid calls and credentials are opt-in.

Representative tasks to run once the above is available:

- Ask an agent to open Calculator on one computer and compute `(125 * 8) + 42` (expect `1042`) while watching and stopping it from a phone and a second desktop.
- Stream an agent response and terminal output on one host, answer a permission and stop an agent on a second host, switch hosts, drop Wi-Fi, sleep the phone and resume with drafts and unread state intact.
- Scan concurrent threads (goal, approval, question, usage limit, stalled goal, failed run, unread result) and tell from icons and labels which needs action.

## Decisions and deferred scope

- **Transport:** see [Architecture](ARCHITECTURE.md#transport). Revisit only with measurements from real networks.
- **Certificate pinning:** not built. It needs a native transport replacement that cannot be verified without device builds. Reopen with a concrete threat that HTTPS pairing and host-identity checks do not cover.
- **Preference sync:** hosts never talk to each other, and no account system exists, so settings do not follow a person across hosts. Credentials and workspace state stay out of any future sync.
- **Mobile administration:** remote network and device administration stays host-only until explicit administrative grants, reviewable changes and recovery exist.
- **Relay:** no relay or tunnel service. Design it separately from direct-host push.
- **Deferred:** a full mobile editor, dedicated mobile provider sign-in, chunked large-file upload, marketplaces for MCP, themes or skills, arbitrary plugin or hook execution, automatic provider-file or credential synchronization, AI conflict resolution, local grounding models and VMs for computer use, and vector retrieval for learning.
- **Evidence rule:** claim an improvement over another application only with matched-task evidence, not source inspection or one demo.
