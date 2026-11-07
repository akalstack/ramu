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

- **Kinds and their preview checks:**
- **Renderers** share `ramu:kit` and the theme tokens, so every kind looks like Ramu in light and dark. Rendering stays offline unless the artifact declares sources.
- **Exports run on the host:**
  - **Narration in video:** MP4 and WebM are made today (frames stepped with the Web Animations API, encoded with the browser's WebCodecs and packaged by Mediabunny); narration still to be mixed in.

### 2. Editing in place

A Doc's Markdown and a Mermaid diagram's source (desktop and phone) and a deck's slide text and order (desktop and phone) are edited with **Edit text** and saved as a version marked "Edited by you"; an edit made on an older version is refused rather than merged, and agents are told to keep the person's wording ([Kinds](guide/artifacts.md#kinds)). Remaining:

- The Doc in the editor Ramu already uses for files (Tiptap on the desktop) instead of its Markdown, and a native rich-text view on the phone.
- A deck's columns and quote attribution on the phone (it edits titles, text, notes and order), labels edited on the drawn diagram itself (today in its Mermaid source), and a design frame's text.
- The device that made an edit, kept with its version.

### 3. Dashboards and Live artifacts

- **Built:** a Dashboard's table can read its project's deployments, usage or uptime, again on every open (at most every five minutes), with "As of" ([Kinds](guide/artifacts.md#kinds)).
- **More sources** are the ones a page can already be granted: its own records, one project folder (read-only), Ramu data (read-only) and Shared MCP servers allowed one by one.
- **Built:** watched figures on a kept dashboard's live tables are read every ten minutes and a change is told to the person's devices ([Kinds](guide/artifacts.md#kinds)). A dashboard's refresh rule (`refreshMinutes`) sets how often, and the phone's saved copy shows the "As of" of its last read when offline. **Refresh** in the desktop toolbar changes it.
- **Live** is a Dashboard or App whose refresh runs on the host through the existing page schedules. It can raise a notification when a declared value changes, using the existing triggers. MCP calls that only read run without asking each time once the person allowed that server for that artifact. Anything that writes still asks in the toolbar.

### 4. Design systems

A Design with tokens (colors, type, radius) can be the host's design system, chosen with **Use as design system**; new Designs, decks and dashboards are drawn with its tokens ([Kinds](guide/artifacts.md#kinds)). Remaining:

- A design system per project instead of per host, its fonts as files, and spacing tokens.
- App artifacts following it too. (**Restyle** applies the system to an existing deck, dashboard or design today.)
- From a codebase, the agent can draft a design system from the project's own CSS variables and components. The person reviews it before it is used.

### 5. Desktop

- The artifact view opens as a workspace tab beside the chat, with the toolbar each kind needs:
  - Doc: outline, edit.
  - Motion: play and scrub.
  - Dashboard: range and refresh.
- Thread cards for every kind show a live preview (the first slide, the doc's opening, the chart, the poster frame) with **Open**, **Keep as artifact** and the kind's export.
- While presenting Slides, speaker notes show on a second display when there is one.

### 6. Phone

- The **Artifacts** tab gets kind filters beside the host filter. Each kind has a viewer that fits the phone:
  - Slides: swipe, with Present when the phone is connected to a display.
  - Doc: reading width, with editing.
  - Motion: native video for the exported MP4.
  - Dashboard: figures above charts.
- **Export** hands the file to the share sheet; **Add to Home Screen or share** and the home-screen widget work for every kind.
- **Present from the phone:** the phone turns slides on the desktop's Present view of the same deck.

### 7. Connection with shipping an app

The [shipping plan](SHIP-AN-APP-PLAN.md) and this one share one rule: make the smallest thing that does the job first, and grow it when it needs more.

- **Start box routing:** the shipping plan's stack choice on Home sends a request to the right kind before it reaches a project:
  - "a page that adds up my monthly costs" becomes an App artifact,
  - "a pitch deck" becomes Slides,
  - "a dashboard of our signups" becomes a Dashboard on the project's database once it has one.

  Only a request that needs a backend, data shared between people or its own domain becomes a project.
- **Design to project:** **Make it a project** on a Design already starts a project from it with `design/` as the reference. Remaining: offering a Design as the starting point in Home's **New project** choices.
- **App to project:** an App artifact grows into a project through **Make it a project** (built), and **Publish to the web** moves onto the shipping plan's `HostingAdapter` when it exists. The static GitHub Pages, Netlify, Vercel and Cloudflare Pages deploys built for pages are its first targets.
- **Shipped apps feed dashboards:** a deployed project's deployments, usage and uptime (shipping plan sections 3, 8 and 9) become Dashboard and Live sources. "Show me this week's errors and deploys" is an artifact, not a page of the hosting dashboard.
- **Launch artifacts:** **Make a release note** and **Make a launch deck** from a project's merged pull requests are Doc and Slides artifacts on the project, ready to export or publish with the site.

### 8. Documentation

- [Artifacts](guide/artifacts.md) gets a section per kind, edit in place, exports, design systems, dashboards and live refresh. The mobile README, VERIFICATION.md, SECURITY.md (exports run on the host; live refresh and what each source can read), [Agents](guide/agents.md) (the `artifact_*` tools and `kind`) and the site's feature list are updated.
- Every string goes through `t()` with its Indonesian translation.

### 9. Two people editing one artifact

Ramu is one person across devices today, so versions are enough. A household or a small team sharing an artifact through a share link that can edit needs more:

- **Presence:** who has the artifact open, and on which part (a slide, a heading), shown on both sides.
- **Merging:** a Doc's and a deck's text are kept as a CRDT (Yjs) on the host, so two people typing at once merge instead of making competing versions. A version is still saved when either stops editing for a minute, so Restore and Compare keep working.
- **Access:** an editing share link names the person it is for and can be revoked like any share link. Kinds without text (Dashboard, Motion) stay one editor at a time, with "Being edited by …" shown to the other.

### 10. Templates

**Save as template** (desktop) and starting a new artifact from one (desktop and phone) are built ([Templates](guide/artifacts.md#templates)). Remaining:

- A template's design system, once design systems exist. (**New** on the desktop and **Start from a template** on the phone offer templates today.)
- Templates travel between hosts the way **Import an artifact** does now: a template share link opens on another connected host as a copy.
- Starting points for the kinds still to come (a landing page for Design, a 30-second explainer for Motion); the report, deck, dashboard and flowchart ship today.

### 11. Dashboards from named services

- Besides records, folders, Ramu data and Shared MCP servers, a Dashboard or Live artifact can read **named services** through connectors on the host: Salesforce, Amplitude and Grafana first.
- Each connector is one file implementing `query(spec)` with that service's own sign-in, kept in `credentials/`. It is read-only, and each service is its own grant on the artifact, listed in plain words.
- A connector is added only after its sign-in and the data it can read are reviewed and written up in SECURITY.md, the same bar as Shared MCP.

### 12. Voice-over for Motion

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
