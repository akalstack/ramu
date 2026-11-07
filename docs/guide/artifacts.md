# Artifacts

Agents can publish small interactive documents in a thread: explanations, diagrams, data explorers, calculators and prototypes. Their controls run locally with no further model call. A document you want to keep becomes an **artifact**: listed under **Artifacts** on the desktop and the phone, opened without its thread, changed by asking in any thread, and able to keep records and use your host's AI when you allow it.

## Kinds

The agent picks the kind from what you ask for. Each artifact's kind shows as a small mark on its row under **Artifacts** and on its card in the thread, and **Artifacts** on the desktop can be filtered by kind.

| Kind | What it is | Exports |
| --- | --- | --- |
| **App** | Interactive web content: calculators, trackers, explorers, games | HTML, source, PDF |
| **Doc** | Writing to keep: a report, plan, spec or notes, written in Markdown with tables, task lists, footnotes and Mermaid diagrams | Markdown, HTML, Word, PDF |
| **Diagram** | A flowchart, sequence, state or concept diagram, written in Mermaid or SVG | SVG, PNG, PDF, and Mermaid when written in it |
| **Slides** | A deck of up to 60 slides: title, content (with an optional image), two columns, image, chart (bar, line or pie) and quote layouts, with speaker notes and a light or dark theme | PowerPoint, PDF, slide images |

Docs, diagrams and decks are drawn on the host into the same sandboxed frame as apps, in the app's colors for light and dark, with no script and nothing loaded from the network. Mermaid is drawn with [Pele](https://pele.run); an SVG keeps only drawing elements, so it cannot run script, follow links or load files. Versions, Compare, Restore, share links, **Open to anyone** and **Publish to the web** work for every kind. **Export** on the desktop downloads the kind's formats; on the phone the card's actions and the artifact's menu hand them to the share sheet.

- **Made on the host:** PDF (every kind, printed by the host's headless browser with nothing reachable on the network; a deck prints one 16:9 slide per page), PowerPoint (written from the deck's source, speaker notes included), Word (written from a doc's Markdown; images keep their description and only web and mail links stay links) and slide images (one 1920 × 1080 PNG per slide, in a zip), and a diagram's PNG at twice its drawn size. Each is kept with the version it was made from, so exporting the same version again is instant. An export is at most 10 MB.
- **Decks:** a slide whose text does not fit fails the preview, naming the slide, so a published deck has no cut-off text. On the desktop the artifact's toolbar moves between slides and **Present** shows one slide at a time on the whole screen; the arrow keys, Space and Page Up or Down turn slides and Escape stops.

Below, an App's **page** is the web page it shows, as in **Page settings**. Records, AI and the other capabilities are for apps.

## In a thread

Each document appears as a card. The card can **Reset**, switch width (Fit, Tablet, Phone), **Expand**, show older **Versions**, keep **Saved scenarios**, and **Export** HTML or source. **Ask about this** adds the document, with its current state, to your next message; **Choose values** attaches only the values you pick.

Each document has one live card: its newest version. When the agent revises it, the older card collapses in place to one row (the title, "v2 · replaced by v4", what the next version changed, and **Go to latest**), so the transcript keeps its order without three similar documents in a row. Expanding an older row shows that version read-only with **Restore**, which publishes it again as the newest version. While the agent checks a revision the live card says **Updating…**; a revision that fails its checks leaves the current version as it was and says why.

A revised card shows **Updated · v4** with the agent's one-line summary of the change, and **Compare** shows the previous and new versions side by side at phone or desktop width, with **Source changes** one click away. Values you entered carry over to the new version when the agent declared that they keep the same meaning (**Undo** puts the new version back to its defaults); otherwise the card lists your earlier values so you can enter them again. The phone follows the same rule, and **Go to latest** scrolls to the live card.

Documents run in an isolated, sandboxed frame with no access to your files or Ramu. They are offline unless the agent declared the exact HTTPS sites they need. On the phone they open in a separate private browser.

## Keeping an artifact

Ask for something to keep ("make me a page to split our trip costs") and the agent publishes it as an artifact, or choose **Keep as artifact** on any card. **Artifacts** sits in the sidebar under Inbox and Schedules, and in the phone's tabs: every artifact on the host, newest first, pinned ones on top, searchable by title. **New** starts a thread with "Make me a page to" begun. A project's menu lists its artifacts too. **Make a page from this thread** (in a thread's More actions) asks the agent to turn what the thread found or built into an App.

An artifact opens full window on the desktop and full screen on the phone. Its saved values live on the host, so what you enter on the laptop is there on the phone; when two devices change it at once, the later one sees the other's values instead of overwriting them. On the phone, **Add to Home Screen or share** shares a `ramu://artifact/…` link that opens it in Ramu. The last version opened stays as a **Saved copy** while the host is away, never shown as current.

- **Changing it:** **Ask about this** starts a thread with the artifact attached, and any thread can update an artifact by name. **Edit** lets you point at an element and say what to change; the agent gets that element's screenshot, its text and its markup. **Versions** shows each version's phone and desktop screenshots with what changed, and **Restore** brings one back as the newest.
- **Errors:** a script error on any device is reported to the host with the version and the steps before it. The page shows **Fix this**, which starts a thread with that report; the agent reproduces it and publishes a fixed version.
- **Checks that stay:** the checks a version passed run again on every revision, so a change that breaks an existing control is caught before it is published. When an update to Ramu changes the libraries pages are built with (React, Chart.js, Dagre), each project page's checks run once against them, and a page they would break shows **Fix this** before anyone publishes with them.
- **Duplicate** copies an artifact's code and capabilities with none of its records, values or history. **Import an artifact…** under Artifacts does the same with a share link from another host this desktop is connected to. **Pin**, **Rename** and **Delete artifact** are in its menu; deleting removes its records, photos, runs and share links, and threads keep their cards marked **Artifact deleted**.

## What an artifact may use

A page declares what it uses, and the first time it opens it asks once, in plain words, with each item allowed or not. **Page settings** shows the same list later, with today's usage, run history and share links. A new version that asks for more asks again for what is new. The page never sees a key, a token or another page.

- **Records:** named collections of records kept on the host (up to 10,000 records and 20 MB per page), checked against the fields the page declares. **Export records** downloads them as JSON and CSV; **Import CSV** adds rows. A version that renames or adds fields moves existing records with its declared rules, and its preview fails if records would not fit.
- **AI:** through the providers already signed in on the host, with the model you choose for the page (**Fast** is the maintenance model, **Smart** the default model) and a daily request limit. The model sees only what the page sends it. Page AI shows in **Activity** with the page's name, where it can be stopped.
  - **Ask:** one call with no tools, for parsing "coffee 35k yesterday", categorizing or reading a receipt photo, returning text or JSON in the shape the page asked for.
  - **Run:** a page agent whose only tools are the page's records, functions the page offers, the HTTPS sites it declared, web search when you allow it, and Shared MCP servers you allow for this page one by one (each call asks you first in the page). Its steps show on the page, **Stop** ends it, deleting records waits for your **Allow**, and **Undo run** in the history puts back every record it changed. A page can offer its own runs as toolbar buttons.
  - **Hand off to a thread:** for work that needs code or a new version of the page; you confirm the request first.
- **Ask this page:** a page with records gets a question box ("how much on food in March?") answered from its records by a read-only page agent, with a small chart when there is a breakdown. **Keep as a panel** asks a thread to add that answer to the page.
- **Photos:** a photo you choose is resized on the device and kept with the page; location data is removed.
- **Notifications:** a few a day, on the desktop and as a push on the phone, opening the artifact. Their text reaches the phone through its push service; **Artifacts** in the phone's alert settings turns them off.
- **On its own:** runs on a schedule (hourly, daily or weekly) without the page open, and triggers that notify or start a run when a record matches. Schedules run once per period, once after the host was asleep. The host loads the page offline to let such runs use its functions. **Schedules** lists every page run under **Page runs**, on the desktop and the phone.
- **Webhook:** an address in **Page settings** where outside services can send records, checked against the page's fields and limited in rate.
- **A project folder:** a page in a project can read one folder of it, never write.
- **Ramu data:** a page can read figures you already see in Ramu, read-only, each source allowed on its own: token use by day and provider (the last 30 days), thread titles and states, and pull requests on threads. Threads and pull requests are the page's project's when it has one. Never transcripts, files, credentials or settings.

On the phone, **Show in the home screen widget** puts a page's declared widget (a number or a short list from its records) on the iOS or Android home screen; it refreshes when Ramu opens, when the page changes and every quarter hour, and says when it was read. A page run that keeps working shows as a Live Activity on iOS. Records you add without a connection wait on the phone and are sent in order when the host answers; any the host refuses are listed rather than dropped. A question asked offline waits while the page stays open.

## Sharing and shipping

- **Share links** (in **Page settings**) open the page on any device paired with this host, read-only or able to add records, for a household ledger. Model calls from a link use the page's own allowance. Links expire after 30 days unless renewed, and can be revoked.
- **Publish to the web** deploys the page's exact tested HTML as a static site on your own account: GitHub Pages through the GitHub login in Settings, Netlify or Vercel through the account connected in **Settings → Git → Hosting accounts** ([Deploying an app](deploy.md#connect-an-account)), or Cloudflare Pages with a token you paste once, kept in the host's credential store. Choosing the platform and pressing **Publish** is the approval. The page shows its address, and when a newer version exists, **Update live site** deploys it to the same site. A page with records or AI cannot go on the web as it is; the menu offers **Make it a project** instead.
- **Open to anyone** (in **Page settings**) shows the page to people without Ramu while this host is on: it gets an address of its own through the host's Cloudflare (`cloudflared`) or ngrok tool and serves only that page, read-only. Only a page that uses no records, AI or other host feature can be opened; **Close to everyone** ends it, and open pages open again after a restart.
- **Make it a project** writes the page's sources, record fields and records to a new folder in `~/Ramu Projects`, adds it as a project and starts a thread there to turn it into an app that builds and runs.

## For agents

Agents use `artifact_preview` to test a document (one HTML file or a small project, up to 512 KB) and `artifact_publish` to publish the exact tested version. A doc (`kind: "doc"`, Markdown in `source`, up to 200 KB) or a diagram (`kind: "diagram"`, `format` `mermaid` or `svg`, the text in `source`) is previewed the same way and has its own checks: a diagram must parse, and every heading of a doc must have an anchor of its own (no empty headings, no two with the same name, and every `#link` reaches one). Preview clicks the declared controls in a headless browser, takes screenshots at phone and desktop widths, and blocks publication on script errors or failed checks. A revision passes `previous` to both and a short `changes` sentence to publish; checks kept with the previous version run again unless dropped on purpose.

- `artifact_publish` with `artifact: true` keeps a new document as an artifact (with `title` and one emoji `icon`); `artifact: "<id>"` publishes a new version of an existing artifact from any thread.
- `artifact_list` and `artifact_get` find an artifact and read its kind, sources, capabilities and last error; `artifact_records` queries, adds or updates its records; `artifact_run` starts one of its runs; `artifact_published` records where it is live. `artifact_read` and `artifact_versions` read a thread's own documents.
- Capabilities are declared in `ramu.json` or a `<meta name="ramu-capabilities">` tag and used through `window.ramuContent`: `records`, `ai.ask`, `ai.run`, `ai.tool`, `pickImage`, `files`, `notify`, `folder` and `startThread`. Preview answers these from an in-frame fake so checks can exercise them.
- Pinned libraries: React 19.3.0, Chart.js 4.6.1, Dagre 2.0.4.
- `<link rel="stylesheet" href="ramu:kit">` adds app-styled cards, buttons, badges, tables and tabs; `<svg data-icon="name">` inserts a [Lucide](https://lucide.dev) icon. Both work offline.
- Theme variables (`--background`, `--foreground`, `--primary`, `--surface`, `--border`, `--chart-1` to `--chart-6` and more) follow the app's colors and light or dark mode.
- `window.ramuContent.setState()` and `onRestore()` keep custom state between views; on a kept artifact, that state is shared through the host.
