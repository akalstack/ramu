# Roadmap

Work that is not finished yet. What already works is in the [guide](README.md#guide). Ramu is in a stability push: fixes are welcome any time, but open a [discussion](https://github.com/akalstack/ramu/discussions/categories/ideas) or an issue before starting anything here.

| Section | What it holds |
| --- | --- |
| [To build](#to-build) | Code to write; nothing blocks it |
| [Blocked](#blocked) | Waiting on another project's release or on hardware |
| [Later](#later) | Options, not planned |

Every change needs focused tests and typechecks for the packages it touches; desktop-facing changes also run `pnpm build` then `pnpm test:desktop-smoke` ([Contributing](../CONTRIBUTING.md#checks)).

## To build

- **Transport:** bounded replay and snapshot recovery for every resource, and defined connection outcomes (current, synchronizing, disconnected, authorization rejected, outcome unknown) that keep drafts and queued messages; non-retriable mutations report an unknown outcome and reconcile. Start from measurements on real networks ([Architecture](contributing/architecture.md#transport)).
- **Windows:** a Windows build: the local service over a named pipe, finding provider CLIs, `gh` and ripgrep, keeping the host awake, and a Squirrel installer that hands `ramu://` links to the running app.
- **Delivery modes for Ship:** today [Ship](guide/git-hosting.md#shipping-a-change) carries one change in an existing project to a finish line, and every reply to a reviewer, merge and production deploy stops for the person. Someone building their own app asks five separate times to get from an idea to a live address; someone on a team sends each drafted reply by hand. A project gets a delivery mode, suggested from who owns the repository as the finish line is, set beside it in **Live app…** on the desktop and the phone. It extends the Ship loop (`apps/server/src/background/ship.ts`), the finish lines (`packages/shared/src/ship.ts`), the pull request tools and the uptime watch; it adds no second loop.
  - **Personal, idea to production:** one ask ("build this and put it live") creates the project, publishes it to the person's own Git host as a private repository, picks a deploy platform, runs the first deploy and records the live address, without the thread stopping between steps. Tokens and secrets still ask once with the masked card. The first production deploy of a project asks; later ones run on their own when checks pass, then check the live address, and a failed check offers the rollback the uptime watch already has.
  - **Team, ready pull request:** the finish line is **Ready for review**. After a review round the agent pushes its fixes as now, and a reply that only reports what was fixed goes out at once, listed under **Done for you** with **Undo**; a reply that disagrees with the reviewer or needs a decision still waits in **Review replies**.
  - **Merging on its own:** a per-project switch, off by default, that turns on the Git host's own auto-merge once the pull request is approved and its checks pass, so branch protection and required reviews still apply.
  - **Limits:** `ramu.json` on the default branch can forbid sending replies or merging without asking, read from the Git host's copy as the finish line limit is. Approving or requesting changes on someone else's pull request always asks, and the round limits stay.
  - **Acceptance:** on a host with no projects, "build a booking page and put it live" ends with a live address that loads, after one production question and the token cards; on an organization's repository, a pull request with review comments reaches approved with the person sending nothing but the replies held for them; with the switch on it merges when approved and green, and with `ramu.json` forbidding it the switch is off and says why.
- **Presenting from the phone:** **Present** a deck on a display the phone is connected to (AirPlay or a cable), with speaker notes on the phone ([Artifacts](guide/artifacts.md)).

## Blocked

- **Starting points for test devices:** **Save as starting point** would make a Simlock baseline the next thread opens from. Waits for Simlock's agent-device front to allocate from a baseline (Ramu pins 0.6.0, which cannot).
- **Test device video through a tunnel:** when WebRTC cannot connect (a tunnel blocking UDP), play Simlock's stream through Ramu's connection, decoded with WebCodecs in a WebView. Start by checking on a physical phone that its WebView decodes H.264 with WebCodecs.
- **Computer use on Windows and Linux:** waits for native capture, permissions and signing on each.
- **Media services as plugins:** move ElevenLabs from its built-in connector to a plugin signed in with the ElevenLabs account. ElevenLabs archived its local MCP server, and its hosted one (`api.elevenlabs.io/v1/mcp`) makes speech but no music or sound effects yet, and registers no client a sign-in can use. Move it once the hosted server makes all three and accepts Ramu's sign-in.
- **Mobile dev builds:** `apps/mobile/package.json` builds `expo-video` from source because its prebuilt binary does not match `expo-modules-core` 58.0.26; drop the override once Expo ships a matching binary.

## Later

- **Games and 3D:** Rapier beside three.js if games keep shipping their own physics; an App docked as a panel across a project's threads if asked for; Unity checks through computer use; a Blender plugin for retopology and levels of detail.
- **Tools across hosts:** sending a key to another host, sealed and confirmed with a matching number, if re-entering keys proves the main friction (needs a [host pairing](security-model.md#host-pairing)-level review); installing from the phone; adopting provider-folder skills and servers so they travel; one server following several projects ([On your other hosts](guide/plugins.md#on-your-other-hosts)).
- **Cloud hosts:** Ramu hosts attached to the account and listed in the host switcher, with a web app to reach them.
- **Ramu Link, sealed:** a channel sealed to the host identity key inside the [Ramu Link](guide/remote-hosts.md#ramu-link) tunnel, so Cloudflare's edge sees only ciphertext; it needs every call over one connection first.
- **Codex call costs:** price Codex calls in cost-aware Auto once Codex reports cost; Ramu keeps no price table of its own, since published prices change and disagree.
- **Browser recording:** change videos on pull requests, if people ask for them; it needs a video encoder Ramu does not ship.
- **Certificate pinning:** only with a threat that HTTPS pairing and host-identity checks do not cover; it needs a native transport replacement.
- **Not planned unless people ask:** a full mobile editor, mobile provider sign-in, chunked large-file upload, a theme marketplace, plugin code inside Ramu and plugin hooks, automatic provider-file or credential sync, local grounding models and VMs for computer use, and vector retrieval for learning.
