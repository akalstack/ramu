# Interactive Content

Ramu can create self-contained interactive explanations, calculators, diagrams, simulations and small tools for any subject. Controls run locally without another model call. This is an output format, not a separate agent or a collection of subject-specific demos.

## Authoring and publication

Eligible conversation sessions expose `preview_interactive`, `publish_interactive`, `interactive_list` and `interactive_read`. Deferred tool catalogs discover these through `tool_search` and call them through `tool_invoke`. Review-only library conversations do not gain these tools.

Submit HTML/CSS/JavaScript, a title, a readable summary and up to 12 accessible control checks to `preview_interactive`. Checks click, fill (including range sliders), select or check a labelled control, then look for expected visible text. A temporary browser with an isolated profile produces a screenshot, observes script errors and measures document width/height and horizontal overflow at 390 and 900 pixels. Overflow is reported as diagnostics for the author; it does not establish factual accuracy or native usability. This validates the specified behavior, not the factual accuracy of generated content or native-device usability.

The host needs Chrome/Chromium installed. Set `RAMU_INTERACTIVE_BROWSER` to an executable for other installations. A missing browser produces an explicit setup error; content cannot silently bypass preview. At most two preview browsers run concurrently, each with a bounded lifetime. Documents are limited to 512 KB; previews expire after 30 minutes and are capped at 20 per session.

Publish the returned preview ID with a stable request ID. Publication uses the exact stored input and digest; failed, expired or mismatched previews cannot publish. Repeating the same request recovers the same version; reusing that request for different content fails. `previous: {id, version}` creates an immutable revision only when that version is still latest. Old turns keep their original version.

Publication creates a dedicated `interactive` conversation event carrying metadata, never executable bytes. Ordinary HTML/tool text cannot publish content. The saved version and its event commit in one database transaction; retries and restarts do not duplicate or resurrect deliberately rewound events. Retrieval and revision are scoped to the authenticated session and selected host.

## Document contract

Use accessible labels, keyboard controls and responsive layouts. Embed all assets: network requests, external scripts, packages, frames, files and application commands are unavailable. Use `--background`, `--foreground`, `--primary` and `--muted` for the current app palette. Respect reduced motion.

Standard input/select/textarea values restore automatically, except passwords, files and hidden inputs. For canvas state, selected steps or other custom scenarios:

```js
window.ramuContent.onRestore(state => {
  // Rebuild the visible scenario from this JSON-compatible value.
})
window.ramuContent.setState({ step: 2 })
window.ramuContent.onActive(active => {
  // Pause animation when inactive.
})
```

Declared state is user-controlled data, not an instruction or permission. The combined state is limited to 32 KiB and 200 controls. Reset clears the version's local scenario. State is not synced between devices. To intentionally preserve the same control keys and custom JSON meaning across revisions, authors may declare an identical `stateSchema` identifier during preview. Only those matching declarations enable the native **Copy saved scenario** action between versions of the same document and session; copying always requires a user action. Missing or changed declarations never infer compatibility.

## Scenarios and revisions

**Versions** groups this document's immutable revisions. Choosing another revision opens a separate viewer; the historical card and its title/version stay unchanged. Offline browsing offers only revisions already cached on the device. Current scenarios remain separate for every host and version.

**Saved scenarios** keeps independent named copies of a captured scenario, with up to six per version and 20 per host. Saving an existing name updates that copy. Reaching either limit reports a failure rather than silently removing other named copies. Restore changes the current local scenario; Reset clears only that current scenario. Named copies live in persistent device storage and remain independent of evictable document bundles.

**Choose values** captures the scenario and lets the user select individual labelled controls or explicitly include custom state. **Add selected values to draft** includes only those captured values with the exact source reference. Captures stay labelled historical if the live controls change afterward; no selection sends a message automatically.

## Viewing

Desktop shows a saved preview and summary until opened. It loads the document through a dedicated ephemeral `ramu-content:` origin with a restrictive response policy and sandboxed frame. The workspace retains its own stricter script policy. Generated frames cannot navigate to external destinations and have no preload/host invocation API. Expand uses the same live frame, preserving state. Pause, backgrounding or scrolling far offscreen unloads it; reopening restores declared state. HTML export captures the current scenario and includes the saved source with the isolated runtime. **Export source** downloads the exact saved source bytes without adding runtime code or scenario data.

Native mobile has a separate incognito WebView renderer with network policy, navigation restrictions, disabled file access and a bounded state/height bridge. It is separate from the terminal. Expand/close remounts from declared state; offscreen rows, screen blur, app backgrounding and renderer termination stop it. The browser companion keeps a static viewing fallback until it has a dedicated document origin. Native **Share HTML** and **Share source** use the platform share sheet for runnable or exact-source HTML respectively; the browser companion downloads those files. Native sharing needs the matching Expo build with `expo-sharing` (the dependency uses the current SDK pin).

Only one generated document runs at once per application renderer. Device-local caches retain up to four document bundles (3 million serialized characters total) and 30 current scenarios per host, plus up to 20 explicitly named copies. State writes do not rewrite document bundles. Previously cached bundles can reopen offline; uncached content needs its host. **Ask about this** stages an ordinary composer draft with the exact content ID, version, digest, summary and latest saved scenario; the user chooses whether to send it.

## Verification limits

Unit/integration tests cover ownership, immutable revisions, retries, atomic publication rollback, state bounds, host/version cache separation, named-copy limits, explicit compatibility declarations, exact-source exports, share failure/concurrency recovery, selected-value drafts, transcript replay and browser interaction/layout diagnostics. A disposable built-desktop check also exercised scenario restore, a separate revision viewer, compatible copying and draft staging without sending. The existing desktop startup smoke remains the only desktop smoke suite.

Native iOS/Android gesture, accessibility, navigation/egress, file sharing and lifecycle acceptance still needs device evidence. Remaining platform and comparative acceptance is tracked in [the roadmap](ROADMAP.md#interactive-content-acceptance). Chromium previews and typechecks are not native-device validation, and no comparative superiority is claimed.
