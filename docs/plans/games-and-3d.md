# Games, 3D assets and plugins made by asking

## The need

A person asks: "make a small 3D game where a fox runs through a forest collecting coins, with music". Ramu already gets them part of the way. An App artifact runs a canvas game with no project ([Artifacts](../guide/artifacts.md)). `generate_image`, `make_music`, `make_sound`, `speak` and `make_video` make the art and sound ([Abilities](../guide/agents.md#abilities)). **Publish to the web** puts the game online, **Make it a project** turns it into a real app with deploys, and test devices check it on a phone. A 2D web game works end to end today.

A 3D game, or one built in an engine, breaks down in six places:

- **No 3D assets.** No ability makes a model, so the agent builds the fox out of boxes in code. Meshy and Tripo make textured, rigged and animated models from a prompt or a picture, but Ramu cannot call them.
- **Plugin abilities only take inline files.** An ability mapped to a Shared MCP tool reads `image` and `audio` content from the result (`apps/server/src/agent/abilities.ts`, `mcpCall`). 3D services run as tasks that take one to five minutes and return a download link, not bytes.
- **Apps cannot carry real assets.** An App's source is capped at 512 KB and 40 files (`packages/shared/src/interactive.ts`), with binary files inlined as base64. A GLB model is 1 to 30 MB. The pinned libraries are React, Chart.js and Dagre, so three.js comes from a CDN the page has to declare, and it fails offline and in preview.
- **Nothing shows a model.** A `.glb` in the files viewer, in a transcript row or on the phone is an unknown file.
- **Engines are out of reach.** An agent can edit a Godot scene's text, but it cannot run, check or export the project. For Unity it cannot see the editor at all.
- **Adding a service means writing a plugin by hand.** "Use Rodin instead" requires someone to know the [plugin layout](../guide/plugins.md#building-a-plugin). The agent cannot draft one and offer it for review.

## What goes where

| Need | Ramu | Plugin | Skill only |
| --- | --- | --- | --- |
| Make a model (Meshy, Tripo, later others) | A `model_3d` ability, the `make_model` tool, downloading the file, the viewer, cost on the row | The credential, the service's MCP server, the mapping to `model_3d` | No |
| Rig, animate, retexture, remesh | Nothing new | The service's own MCP tools, approved per call like any Shared MCP tool | No |
| Game engine (Godot, Unity) | Nothing new | A CLI or MCP server, the commands that only read, and a skill | No |
| How to build a game (loop, controls, asset budgets, import paths) | The App guide in `artifact_preview` | Shipped as each plugin's skill | Yes |

A skill alone is enough for know-how: project layout, a fixed-step game loop, touch and keyboard controls, polygon budgets, where models go in three.js, Godot or Unity. A skill alone is not enough for a paid service. A skill that calls Meshy with `curl` puts the key in the shell and the transcript, skips the install review and the "whose key is this" check, and never shows what a call cost. The plugin carries the credential and the MCP server, and its skill carries the know-how.

This follows the roadmap's rule that a media service moves to a plugin once it ships an MCP server that makes the file. Meshy publishes an official one (`@meshy-ai/meshy-mcp-server`), and Tripo's research group publishes `VAST-AI-Research/tripo-mcp`. Ramu therefore adds no first-party `MediaConnector` for either. Akalstack maintains both plugins in `akalstack/ramu-plugins`, pinned and signed, as it does Railway and Grafana.

Engines stay plugins too. Godot is open source and drives well from its CLI. Unity's agent path is still moving: Unity built an MCP server into its AI Assistant package, and reports say it is moving to a Unity CLI. Ramu should not own either path. Check which one Unity recommends before writing the Unity plugin.

## DeepSeek Harness Creator Mode, and what Ramu takes from it

DeepSeek Harness (MIT, a developer preview) builds everything as Cordis plugins running inside the app. Creator Mode is a session mode where the agent writes and loads those plugins in memory. Its seven official examples are a 3D landmark gallery, a 3D transformer explainer, an app-wide pixel-art restyle, a poster workbench, a video editing workbench, a paper reader and a token and cost dashboard. Each shows as a sidebar, a workbench opened from the chat, or a theme. DeepSeek calls the mode experimental, says some demos took several rounds, and the runtime has no security audit.

Ramu keeps plugin code out of the app. Plugins run only as MCP servers and CLIs (see Deferred under [Decisions](../roadmap.md#decisions-and-deferred-scope)), so a plugin a person or an agent writes can never read another page's data, a token or the transcript. Most of the examples are already Ramu artifacts. The gallery and the explainer become App artifacts once three.js is pinned. The dashboard is a Dashboard over the `activity` source. The poster is a Design. The restyle is a theme. None of them needs a separate mode, because Ramu already picks the artifact kind from the request, and a mode toggle would only add a step.

Ramu takes two things from it:

1. **A plugin made by asking.** "Connect Rodin for 3D models" with no plugin installed: the agent drafts the plugin and installs it as a Development plugin through the review card the person already knows. This is delivery step 5.
2. **Work that stays beside the thread.** An artifact already opens as a tab beside its thread. Docking an App into a project's threads as a panel (an asset gallery, a level editor) waits for people to ask for it; see Later options.

## Delivery

### 1. The `model_3d` ability and `make_model`

- `packages/shared/src/providers/abilities.ts`: add `model_3d` to `ABILITIES`, `make_model` to `ABILITY_TOOLS` with its label and done text ("Model made with {0}"), and add it to `MCP_ABILITIES` so plugin manifests can map it. Leave it out of `AUTO_MCP_ABILITIES`: a call costs credits and minutes, so Auto never spends them unasked, and the first call in a thread is an approval card that names the service.
- `make_model` takes a prompt, or an image attachment for image-to-3D (concept art from `generate_image` becomes a model), plus `detail` (`low`, `medium`, `high`, mapped to each service's polygon target), `textured` and `rigged`. The file is a GLB kept as an attachment with a poster PNG. In a thread with a project, it is also written to `assets/models/<name>.glb`.
- **Files from links and tasks:** `mcpCall` also accepts MCP `resource` blobs and `resource_link`s. It downloads an `https` link only from an origin the plugin declares, bounded to 100 MB, and keeps a file only if it starts with glTF's magic bytes. A mapping may name a `status` tool. Ramu then calls the status tool with the task id the first call returned, every few seconds, until a file or a failure, and shows progress on the row. Stop cancels it, and the wait ends after ten minutes.
- **The check costs nothing:** for `model_3d`, the live check calls the plugin's account or balance tool, not a generation, and the row shows the credits left when the service reports them.

### 2. A 3D viewer

- One three.js viewer in `apps/web` for `.glb` and `.gltf`. It orbits the model under neutral lights and shows its triangle count and size. A rigged model gets a menu of its animations. It appears in the files viewer, in the attachment card of a `make_model` row and in the artifact asset list.
- On the phone, the row shows the poster, and opening it loads the same viewer in a WebView.

### 3. Apps that carry game assets

- Pin three.js with `GLTFLoader` and `OrbitControls` as an offline library beside React, so a 3D App loads with no network and passes preview.
- **Assets by reference:** a `files` entry can name an attachment (as images already do) for `glb`, `gltf`, `bin`, `ktx2`, `png`, `mp3` and `ogg`. These files are stored with the version, outside the 512 KB source cap, at up to 25 MB a file and 50 MB an artifact. Add the glTF types to `MIME` in `apps/server/src/interactive/bundle.ts`.
- **Preview checks a 3D page:** the headless browser runs WebGL (SwiftShader), and a canvas that stays one color after the page loads fails the preview, as clipped text does.
- **Controls:** a focused artifact receives the keyboard, and the frame allows fullscreen and gamepads. On the phone, the guide asks for on-screen touch controls whenever a game uses keys.
- **Publish to the web** and **Make it a project** carry the assets.

### 4. Plugins Akalstack maintains

- **meshy** and **tripo:** the credential with a check, the MCP server pinned, `model_3d` mapped with its `status` tool, rigging, animation and retexturing left as the server's own tools, and a skill for game assets (polygon budgets, naming, scale, and import into three.js, Godot and Unity).
- **godot:** the `godot` binary through `platform_cli`, where `--version` and `--headless --check-only` only read and an export asks first. The skill covers project layout, the text scene format and web export, whose output can be published like any static site.
- **unity:** whichever official path Unity recommends when the plugin is written (its MCP server or its CLI), with a skill. A Unity licence and the editor stay on the person's computer.

### 5. A plugin made by asking

- A `plugin_create` tool next to `plugin_search` and `plugin_install` (`apps/server/src/plugins/tools.ts`). It runs `ramu plugin new` into `~/Ramu Plugins/<name>`, lets the agent write the manifest, the MCP server or CLI entry and a skill from the service's own documentation, runs `ramu plugin check` until it passes, and then installs the folder as a Development plugin through the usual review card. The agent never sees the key, because the person pastes it on the plugin's card. **Share** on a Development plugin's card pushes the folder to the person's own repository, and from there they can open a pull request to an index.
- When `plugin_search` finds nothing for a service, the agent offers this tool.

## Services to extend

- `packages/shared/src/providers/abilities.ts`, `packages/shared/src/plugins.ts` (the mapping's `status` tool)
- `apps/server/src/agent/abilities.ts` (`mcpCall`, `checkMcp`, the new tool), `apps/server/src/plugins/` (the mapping, `plugin_create`)
- `apps/server/src/interactive/` (asset references, `MIME`, the WebGL preview check, the pinned library, the App guide in `tools.ts`)
- `apps/web/src` files viewer and transcript attachment card; `apps/mobile` attachment row
- `akalstack/ramu-plugins` for the four plugins

## Acceptance

- **Representative task:** a person with the Meshy plugin installed types the fox request into a new thread. Without help, they get a concept image, a rigged fox with a run animation, a coin and trees, music and a pickup sound. The game is an App that plays on the desktop with keys and on the phone with touch. A fully black canvas fails the preview before anyone sees it, and **Publish to the web** puts it online. The person types the request and approves the Meshy calls, and nothing else. Run the same task in a plain agent with Meshy's MCP server, and count the steps, broken asset paths and keys that reached the transcript.
- With Tripo, a phone photo of a sketch becomes a model through image-to-3D.
- A Meshy account with no credits stops with the service's words and the plugin's card, not a stack trace.
- "Connect Rodin for 3D models" with no plugin: the agent makes a Development plugin, the review lists its MCP server and credential, the key goes on the card, and `make_model` uses Rodin in a new thread.
- With the godot plugin, "make this a Godot project and export it for the web" asks once for the export, and the result goes live with **Publish to the web**.

## Later options

- A physics library pinned beside three.js (Rapier), if games keep shipping their own.
- An App docked as a panel across a project's threads (an asset gallery, a level editor), if people ask for it after this ships.
- Unity checks through computer use on the editor window, for games that never leave the engine.
- A Blender plugin for retopology and levels of detail.
