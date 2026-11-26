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
- **Delivery modes for Ship:** [Ship](guide/git-hosting.md#shipping-a-change) carries one change in an existing project to a finish line, and a project chooses what it does without asking (sending fix replies, **Merge when approved**, later production deploys). Two things are still missing: someone building their own app asks five separate times to get from an idea to a live address, and a change waiting on a reviewer looks like an agent at work. Both extend the Ship loop (`apps/server/src/background/ship.ts`), the finish lines (`packages/shared/src/ship.ts`), the pull request tools and the uptime watch; neither adds a second loop.
  - **Personal, idea to production:** one ask ("build this and put it live") creates the project, publishes it to the person's own Git host as a private repository, picks a deploy platform, runs the first deploy and records the live address, without the thread stopping between steps. Tokens and secrets still ask once with the masked card, and the first production deploy asks. After a later deploy, a failed check of the live address offers the rollback the uptime watch already has.
  - **Waiting on people:** a pull request says what it waits on from its Git host's own rules, and a shipping thread waiting on reviewers offers reviewers and drafts a reminder. Still missing:
    - **A merge queue:** with **Merge when approved** on, a merge queue decides where the repository has one.
  - **Acceptance:** on a host with no projects, "build a booking page and put it live" ends with a live address that loads, after one production question and the token cards.
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
