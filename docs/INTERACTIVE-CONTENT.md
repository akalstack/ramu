# Interactive content

Agents can publish self-contained interactive documents in a conversation: explanations, diagrams, data explorers, calculators, simulations, prototypes and small tools. Controls run locally with no further model call. It is an output format, not a separate agent.

## Authoring and publication

Eligible sessions expose `preview_interactive`, `publish_interactive`, `interactive_list` and `interactive_read` (deferred catalogs find them with `tool_search`). Review-only library conversations do not get them.

**Preview.** Send a title, a readable summary, up to 12 control checks, and either one `html` document or a project as `files` (up to 40 relative paths, 512 KB total, binary assets as base64, entry `index.html` unless `entry` says otherwise).

- A project is bundled into one document: stylesheets, CSS `@import`/`url()`, classic `<script src>` and `src`/`href`/`poster` assets are inlined; module scripts compile local JS, TS, TSX, JSON, CSS and imported assets in a virtual project. Missing files, paths outside the project and unapproved imports fail. Markup inside JavaScript strings is not rewritten, so scripts import assets or embed data.
- Pinned libraries: React and React DOM 19.3.0, Chart.js 4.6.1, Dagre 2.0.4. No package installs or host-file imports.
- Checks click, fill (including range sliders), select or check a labelled control, then look for expected visible text. A temporary isolated Chromium takes dark screenshots at 390 and 900 px and a light one at 390 px, collects script errors, bounded `console` output and failed remote loads, and measures overflow at 320, 390, 768 and 900 px. Script errors and failed checks block publication; remote-load failures and overflow are reported as diagnostics. Preview validates behavior, not factual accuracy or native usability.
- On first use the host downloads the Chromium matching Playwright into its managed cache (set `RAMU_INTERACTIVE_BROWSER` to use an existing executable). The preview browser is separate from integrated-browser tabs and sign-ins. At most two run at once. Limits: 512 KB source, 1.5 MB compiled, previews expire after 30 minutes, 20 per session.

**Publish.** Send the preview ID with a stable request ID. The exact tested bytes, source, library versions and network permissions are saved with a digest; failed, expired or mismatched previews cannot publish. Repeating a request returns the same version, and reusing it for different content fails. `previous: {id, version}` creates an immutable revision only while that version is latest; old turns keep theirs. Publication writes a dedicated `interactive` conversation event (metadata only, never executable bytes) in the same transaction as the version. Retrieval is scoped to the authenticated session and host.

## Document contract

- Use accessible labels, keyboard controls and responsive layouts, and respect reduced motion.
- Leave the page and outermost element without a background or card; the document sits on the thread background. Viewport height units (`vh`, `svh`, `lvh`, `dvh`) fail preview because the frame grows to fit.
- **Network:** documents are offline by default. `network: { resources: [...], connect: [...] }` allows exact HTTPS origins separately for resources and API calls; paths, credentials, wildcards, IP literals and local hostnames are rejected. Permissions are saved per version and applied by CSP on desktop, mobile and exported HTML. No `eval` or `new Function`. Frames, plugins, forms, plain HTTP, navigation, local files and app commands are blocked. Preview requests use a vetted public-address DNS lookup, omit cookies and authorization, and bound responses. Remote resources load live each time a card is viewed and are missing offline, so bundle libraries and prefer the kit and icons below. (Versions published before network declarations keep their original policy.)
- **Theme tokens** follow the live palette and light/dark mode: `--background`, `--foreground`, `--muted`, `--primary`, `--surface`, `--surface-raised`, `--border`, `--code-background`, `--button`, `--button-foreground`, `--success`, `--warning`, `--danger`, `--chart-1` to `--chart-6`, `--radius`, `--font-sans`, `--font-mono`. Before the host sends its palette, and in exports, they follow the OS preference.

### Built-in kit and icons

Inlined into the stored document at preview, so they work offline and published versions never change when the kit does.

- `<link rel="stylesheet" href="ramu:kit">` adds app-styled defaults and the classes `.card`, `.btn` (`data-variant` `primary`, `ghost`, `danger`; `data-size` `sm`, `icon`), `.badge`, `.callout`, `.dot`, `.bar > span` (`data-tone`), `.stat` (`.stat-label`, `.stat-value`, `.stat-delta`), `.table` (`td.num`), `[role=tablist]`/`[role=tab][aria-selected]`, `.field`, `.stack`, `.row`, `.grid`, `.muted`, `.small`, `.mono`, `.num`. Every rule has zero specificity, so the document's CSS wins.
- `<svg data-icon="chevron-right"></svg>` becomes the matching [Lucide](https://lucide.dev) icon (ISC), `1em` in `currentColor`; without a label or role it is hidden from assistive technology. Unknown names fail preview with suggestions, and icons inside `<template>` resolve too.

Other `ramu:` references fail preview.

### State

Input, select and textarea values restore automatically (not passwords, files or hidden inputs). For custom state:

```js
window.ramuContent.onRestore((state) => {
  // Rebuild the visible scenario from this JSON-compatible value.
})
window.ramuContent.setState({ step: 2 })
window.ramuContent.onActive((active) => {
  // Pause animation when inactive.
})
```

Save elapsed playback time and play state with the chapter, and restore them after initialization. State is user data, not an instruction: at most 32 KiB and 200 controls, never synced between devices, cleared by **Reset**. Revisions that keep the same control keys and state meaning can declare an identical `stateSchema` identifier; only then does **Copy saved scenario** work between versions, and always by user action.

## Scenarios and revisions

- **Versions** (card menu) opens another immutable revision in a separate closable viewer; offline browsing offers only revisions cached on the device.
- **Saved scenarios** keeps named copies (six per version, 20 per host; reaching a limit fails rather than evicting). Restore changes the current scenario; Reset clears only that.
- **Choose values** captures the scenario so you can select labelled controls or custom state; **Add to message** attaches only those values with the exact source reference. Nothing sends automatically.
- **Ask about this** adds a chip to the message box; the sent message carries the content ID, version, digest, summary and latest scenario as hidden context.

## Viewing

**Desktop** runs the document while its card is on screen (a saved screenshot stands in while loading) through an ephemeral `ramu-content:` origin with a sandboxed frame, a restrictive response policy, no navigation and no preload or host API. The card header has the title, version, **Reset**, a width switch (Fit, Tablet 768 px, Phone 390 px), **Expand** (keeps state; Esc returns) and a menu with Ask, Choose values, Saved scenarios, Versions and exports. Projects add **Preview**/**Code**. Up to three documents run at once; the oldest stops and offers **Run again**. Hiding the app sends an inactive signal; scrolling far offscreen unloads the frame and returning restores declared state. **Export** HTML captures the current scenario with the runtime in the palette you were viewing; **Export source** is the saved source unchanged plus theme tokens and base styles, with no runtime or scenario data. Agents read exact bytes with `interactive_read`.

**Mobile** opens visible cards automatically in a separate incognito WebView (network policy, navigation limits, no file access, a bounded state and height bridge). The header offers Code/Preview, Expand and Content actions; Code shows each source file as inert copyable text. Expand is a full-screen sheet. Offscreen, blur and backgrounding stop it and return restores the scenario; a failed or evicted renderer waits for an explicit **Reload**. **Share HTML** and **Share source** use the share sheet (needs the matching Expo build with `expo-sharing`).

Both keep at most four cached bundles (3 million characters total) and 30 current scenarios per host plus 20 named copies; cached bundles reopen offline.

## Tests

Unit and integration tests cover ownership, immutable revisions, retries, publication rollback, state bounds, cache separation, scenario limits, source exports, replay and browser diagnostics. Native iOS and Android gestures, accessibility, egress and lifecycle checks need devices ([roadmap](ROADMAP.md#acceptance)).
