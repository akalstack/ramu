# Artifacts: everything an agent makes, kept and opened anywhere

A person asks an agent for a document, a deck, a design, a dashboard, a short explainer video, a diagram, a small app or a live view of their tools, and gets an **artifact**: a standalone result beside the chat that they open, edit, run, export and share from the desktop or the phone, and change by asking from any thread. Apps already do this for interactive web content; this plan widens artifacts to every kind of output, so one place holds everything agents make. Document shipped behavior in [Artifacts](guide/artifacts.md) and delete this plan when implementation and acceptance are finished.

## The need

Agents already make more than web pages, but only pages have a home:

- **Writing ends in the chat.** A report, plan or release note is a long message; editing one sentence means asking again or copying it out.
- **Decks, designs and videos end as files.** An agent can write a `.pptx` or an SVG into a folder, but nothing shows it, versions it or lets the person change it in place.
- **Charts are pictures.** A chart of real data goes stale the moment it is drawn; there is no way to keep it connected to where the data lives.
- **Every kind needs its own export.** People want a deck as PowerPoint or PDF, a doc as Word or Markdown, a video as MP4, a diagram as SVG, and today each is a separate request.
- **"Page" is the wrong word for most of these.** A slide deck or a video is not a page, so people do not look under Pages for them.

**Easier for the person:** "write the launch plan", "make a 6-slide deck from this report", "design the pricing screen in our style", "show this week's signups", "a 30-second explainer of how sync works" each end with something they can open from the sidebar or the phone's tab bar, edit directly where it makes sense, export in the format they need, and keep improving by asking from any thread. Nothing to find in a folder, nothing to convert by hand.

## Decision: rename Pages to Artifacts, keep one engine

**Rename.** Pages become **Artifacts** in every place a person or an agent reads them: the sidebar entry and the phone tab, the guide, the agent tools and the grant sheet. "Artifact" is the word people who use Claude already know for "a standalone result the model made". It covers every kind below and it is generic, not a product name. A web page is one kind of artifact: an **App**. The words "page" and "Page settings" stay only where they still mean a web page.

- **What is renamed:** everything, inside and out: the IPC namespace (`artifacts.*`), the agent tools (`artifact_*`), links (`ramu://artifact/…`) and the tables (`artifacts`, `artifact_records` and the rest). Ramu is alpha, so no old name is kept.

**One engine.** Every kind reuses what pages already have: an owner on the host, versions published from any thread with what changed, one live card per artifact in a thread, Restore, Compare, kept checks, a shared state, grants, runs, Fix this, Edit (point and ask), share links, Open to anyone, Publish to the web and Make it a project. What a kind adds is three things only:

- its source format,
- a renderer in the same sandboxed frame,
- its exports.

Rendering stays in the frame, so no kind gets a new path to Ramu's API.

## Kinds

| Kind | What it is | Source | Edit in place | Exports |
| --- | --- | --- | --- | --- |
| **Doc** | Writing that is kept and edited: reports, plans, notes, specs | Markdown with blocks (tables, callouts, embedded charts and diagrams) | Yes, rich text on desktop and phone | Markdown, DOCX, PDF, HTML |
| **Slides** | A deck from notes, a doc or a report | A slide list (layout, title, body, notes, image, chart) plus a theme | Text and order on desktop; text on phone | PPTX, PDF, PNG per slide |
| **Design** | Screens, mockups, prototypes, landing pages, one-pagers | HTML and CSS frames on a canvas, drawn with a design system's tokens | Text, colors from the system, and Edit (point and ask) | PNG, SVG, HTML, and **Make it a project** |
| **Dashboard** | Live charts and figures from a source the person connects | A source (records, a project folder, a Shared MCP server, Ramu data) plus chart and figure specs | Filters and ranges; layout by asking | CSV, PNG |
| **Motion** | An animated explainer, walkthrough or animated chart | A timeline of scenes in HTML and SVG with timings | Text and timing by asking | MP4 and WebM, rendered on the host |
| **App** | Interactive web content: calculators, games, trackers (today's pages) | HTML or a small project | By asking; values by using it | HTML, source, **Publish to the web**, **Make it a project** |
| **Diagram** | Flowcharts, sequence diagrams, concept maps, illustrations | Mermaid or SVG | Labels in place; layout by asking | SVG, PNG, Mermaid |
| **Live** | A view that refreshes itself from the person's tools: a Linear queue, a Notion page, a Drive folder | An App or Dashboard with refresh rules and granted Shared MCP servers | As its base kind | As its base kind |

The kind is chosen by the agent from the request, shown as a small mark on every row and card, and can be filtered in the list. A request that fits none (a one-line answer, a code change) stays a message or a diff, as today.

## The person's path

1. **Asking.** "Turn this report into 6 slides." The agent writes the slide list, previews it (each slide is rendered and checked at deck size, like pages are checked at phone and desktop widths) and publishes a Slides artifact. In the thread it is one live card showing the first slide, with **Open**.
2. **Opening beside the chat.** **Open** shows the artifact as a tab in the thread's workspace area, next to the conversation, the way a file opens. Ramu's layout has no right sidebar, and this adds none. Reading the deck and asking for changes happen side by side; **Full window** gives it the whole window.
3. **Finding it again.** **Artifacts** in the sidebar (desktop) and the phone's tab bar lists everything, newest first, with its kind's mark, project and last change. It can be filtered by kind and searched by title. **New** opens a thread with "Make me a …" begun for the chosen kind, from a kind menu.
4. **Editing directly.** A Doc's text, a deck's slide text and order, a diagram's labels and a design's text are edited in place. Each save is a new version marked "Edited by you", so the agent's next revision builds on it rather than overwriting it. Anything structural is asked for: Edit (point and ask) works on every kind, pointing at a slide, a chart, a frame or a paragraph.
5. **Exporting.** **Export** offers that kind's formats. Files that need the host to make them are made there and saved on the device: PPTX, DOCX, PDF and MP4.
6. **Sharing and shipping.** **Share link**, **Open to anyone**, **Publish to the web** and **Make it a project** work as they do for pages, for every kind that can be shown as a web page. A deck or doc publishes as a read-only site.

## Delivery

### 1. Kinds in the engine

App, Doc, Diagram, Slides, Dashboard (over tables the agent fills in), Design (fixed-size frames of HTML and CSS) and Motion (timed scenes played by CSS) are in the engine, with PDF for every kind, PowerPoint and slide images for decks, Word for docs and PNG for diagrams, kept per version (see [Kinds](guide/artifacts.md#kinds)). The remaining kinds and exports follow the same path: `artifact_publish` and `artifact_preview` take the kind and its source, validated by a zod schema per kind in `packages/shared/src/artifactSource.ts`, and the host draws the source into HTML for the sandboxed frame in `apps/server/src/interactive/kinds.ts`.

- **Narration in video:** MP4 and WebM are made today (frames stepped with the Web Animations API, encoded with the browser's WebCodecs and packaged by Mediabunny); narration still to be mixed in.

### 2. Phone

- Slides: **Present** on a display the phone is connected to (AirPlay or a cable), with the notes on the phone. Everything else for the phone is built: kind filters, viewers per kind, editing, exports to the share sheet, Add to Home Screen and the widget for apps and dashboards.

### 3. Documentation

- The site's feature list names the kinds, with the [shipping plan's](SHIP-AN-APP-PLAN.md) site rewrite.
- Each new behavior above is described in [Artifacts](guide/artifacts.md), the mobile README and VERIFICATION.md as it lands.

### 4. Two people editing one artifact

Merging edits on save, saying who else is editing, an editing share link that names one person on a paired device, and live typing on a doc's or Mermaid diagram's text (a Yjs copy on the host, synced about once a second, saved as a version after a quiet minute) are built ([Kinds](guide/artifacts.md#kinds), [Sharing and shipping](guide/artifacts.md#sharing-and-shipping)). Remaining:

- **Live typing on a deck's slide text,** field by field, the way a doc's text is.
- **Presence by part:** on which slide or heading each person is.

### 5. Voice-over for Motion

- A Motion artifact can have narration: the agent writes a script per scene, and the **speech** ability ([Abilities](ABILITIES-PLAN.md)) turns it into audio on a signed-in provider that offers it. The host mixes the audio into the MP4 with the browser's own audio encoder, timed to the scenes.
- **Narration** in the artifact's toolbar previews, re-records one scene, or removes the narration. The grant sheet says which provider receives the script, and no other content leaves the host.

## Safety

- Every kind renders in the same sandboxed frame as pages, offline unless sources are declared. Exports and refreshes run on the host with the artifact's grants, never with a thread's access.
- Export writers are pinned libraries working from the validated source. A model never writes the bytes of a PPTX, DOCX or MP4.
- An edit made in place and an agent's version never overwrite each other: both are versions, and Restore brings any one back.
- Live refresh can only read what was granted. A source that writes, sends or deletes asks in the toolbar every time, as page runs do now.

## Acceptance

- **Doc:** "write a launch plan for the sync feature" makes a Doc. Editing a paragraph on the phone and then asking "add a risks section" keeps the edit and adds the section. It exports as DOCX that opens in Word and as PDF.
- **Slides:** "turn this report into 6 slides" makes a deck that exports as PPTX opening in PowerPoint and Keynote. **Present** runs on the desktop with the phone turning slides.
- **Design:** with a design system drafted from a project's CSS, "design the pricing screen" uses its tokens, and **Make it a project** starts a project whose first screen matches it.
- **Dashboard and Live:** a dashboard of a page's records and of a project's deployments refreshes on schedule, shows "As of" offline on the phone, and notifies when a declared value changes.
- **Motion:** "a 30-second explainer of how sync works" plays in the card and exports an MP4 that plays on the phone.
- **Diagram:** a sequence diagram from a thread exports as SVG, and editing a label in place makes a new version.
- **Shipping:** from Home, "a pitch deck for my app" becomes Slides and "a booking site with payments" becomes a project, both without the person choosing a kind.
- **Two editors:** two people with an editing share link type in the same Doc at once. Both see each other's place, and the text merges with no lost edits.
- **Templates:** **Save as template** on the expense tracker and **New** from it on another host starts an App with the same code and no records.
- **Named service:** a Dashboard on Amplitude events refreshes from the connector and shows only what the grant names.
- **Voice-over:** the sync explainer gets narration from a signed-in speech provider, and the exported MP4 plays it in time with the scenes.
- Checks that need a physical phone, PowerPoint, Word or Keynote, or live sources are listed under [Acceptance](roadmap.md#acceptance) until run.

## Images, video and narration

Kinds that need generated images, video or narration (Design, Slides, Doc illustrations, Motion) get them through [Abilities](ABILITIES-PLAN.md), so a deck made on a Claude thread still gets its pictures from a signed-in provider that can make them.
