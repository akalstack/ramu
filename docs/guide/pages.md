# Pages and interactive content

Agents can publish small interactive documents in a thread: explanations, diagrams, data explorers, calculators and prototypes. Their controls run locally with no further model call. A document you want to keep becomes a **page**: listed under **Pages** on the desktop and the phone, opened without its thread, changed by asking in any thread, and able to keep records and use your host's AI when you allow it.

## In a thread

Each document appears as a card. The card can **Reset**, switch width (Fit, Tablet, Phone), **Expand**, show older **Versions**, keep **Saved scenarios**, and **Export** HTML or source. **Ask about this** adds the document, with its current state, to your next message; **Choose values** attaches only the values you pick.

Each document has one live card: its newest version. When the agent revises it, the older card collapses in place to one row (the title, "v2 · replaced by v4", what the next version changed, and **Go to latest**), so the transcript keeps its order without three similar documents in a row. Expanding an older row shows that version read-only with **Restore**, which publishes it again as the newest version. While the agent checks a revision the live card says **Updating…**; a revision that fails its checks leaves the current version as it was and says why.

A revised card shows **Updated · v4** with the agent's one-line summary of the change, and **Compare** shows the previous and new versions side by side at phone or desktop width, with **Source changes** one click away. Values you entered carry over to the new version when the agent declared that they keep the same meaning (**Undo** puts the new version back to its defaults); otherwise the card lists your earlier values so you can enter them again. The phone follows the same rule, and **Go to latest** scrolls to the live card.

Documents run in an isolated, sandboxed frame with no access to your files or Ramu. They are offline unless the agent declared the exact HTTPS sites they need. On the phone they open in a separate private browser.

## Pages

Ask for something to keep ("make me a page to split our trip costs") and the agent publishes it as a page, or choose **Keep as page** on any card. **Pages** sits in the sidebar under Inbox and Schedules, and in the phone's tabs: every page on the host, newest first, pinned ones on top, searchable by title. A project's menu lists its pages too. **Make a page from this thread** (in a thread's More actions) asks the agent to turn what the thread found or built into a page.

A page opens full window on the desktop and full screen on the phone. Its saved values live on the host, so what you enter on the laptop is there on the phone; when two devices change it at once, the later one sees the other's values instead of overwriting them. On the phone, **Add to Home Screen or share** shares a `ramu://page/…` link that opens the page in Ramu; the last version opened stays as a **Saved copy** while the host is away, never shown as current.

- **Changing it:** **Ask about this** starts a thread with the page attached, and any thread can update a page by name. **Edit** lets you point at an element and say what to change; the agent gets that element, its text and its markup. **Versions** shows each version's phone and desktop screenshots with what changed, and **Restore** brings one back as the newest.
- **Errors:** a script error on any device is reported to the host with the version and the steps before it. The page shows **Fix this**, which starts a thread with that report; the agent reproduces it and publishes a fixed version.
- **Checks that stay:** the checks a version passed run again on every revision, so a change that breaks an existing control is caught before it is published.
- **Duplicate** copies a page's code and capabilities with none of its records, values or history. **Pin**, **Rename** and **Delete page** are in the page menu; deleting removes its records, photos, runs and share links, and threads keep their cards marked **Page deleted**.

## What a page may use

A page declares what it uses, and the first time it opens it asks once, in plain words, with each item allowed or not. **Page settings** shows the same list later, with today's usage, run history and share links. A new version that asks for more asks again for what is new. The page never sees a key, a token or another page.

- **Records:** named collections of records kept on the host (up to 10,000 records and 20 MB per page), checked against the fields the page declares. **Export records** downloads them as JSON and CSV; **Import CSV** adds rows. A version that renames or adds fields moves existing records with its declared rules, and its preview fails if records would not fit.
- **AI:** through the providers already signed in on the host, with the model you choose for the page (**Fast** is the maintenance model, **Smart** the default model) and a daily request limit. The model sees only what the page sends it. Page AI shows in **Activity** with the page's name, where it can be stopped.
  - **Ask:** one call with no tools, for parsing "coffee 35k yesterday", categorizing or reading a receipt photo, returning text or JSON in the shape the page asked for.
  - **Run:** a page agent whose only tools are the page's records, functions the open page offers, and the HTTPS sites it declared. Its steps show on the page, **Stop** ends it, deleting records waits for your **Allow**, and **Undo run** in the history puts back every record it changed. A page can offer its own runs as toolbar buttons.
  - **Hand off to a thread:** for work that needs code or a new version of the page; you confirm the request first.
- **Ask this page:** a page with records gets a question box ("how much on food in March?") answered from its records by a read-only page agent, with a small chart when there is a breakdown. **Keep as a panel** asks a thread to add that answer to the page.
- **Photos:** a photo you choose is resized on the device and kept with the page; location data is removed.
- **Notifications:** a few a day, on the desktop and as a push on the phone, opening the page. Their text reaches the phone through its push service; **Pages** in the phone's alert settings turns them off.
- **On its own:** runs on a schedule (hourly, daily or weekly) without the page open, and triggers that notify or start a run when a record matches. Schedules run once per period, once after the host was asleep.
- **Webhook:** an address in **Page settings** where outside services can send records, checked against the page's fields and limited in rate.
- **A project folder:** a page in a project can read one folder of it, never write.

On the phone, records you add without a connection wait on the phone and are sent in order when the host answers; any the host refuses are listed rather than dropped. A question asked offline waits while the page stays open.

## Sharing and shipping

- **Share links** (in **Page settings**) open the page on any device paired with this host, read-only or able to add records, for a household ledger. Model calls from a link use the page's own allowance. Links expire after 30 days unless renewed, and can be revoked.
- **Publish to the web** hands the page to a thread that deploys its exact HTML as a static site on your own account (GitHub Pages, Cloudflare Pages, Netlify or Vercel) with the usual approvals, and records the address; later versions offer **Update live site**. A page with records or AI cannot go on the web as it is.
- **Make it a project** writes the page's sources, record fields and records to a new folder in `~/Ramu Projects`, adds it as a project and starts a thread there to turn it into an app that builds and runs.

## For agents

Agents use `preview_interactive` to test a document (one HTML file or a small project, up to 512 KB) and `publish_interactive` to publish the exact tested version. Preview clicks the declared controls in a headless browser, takes screenshots at phone and desktop widths, and blocks publication on script errors or failed checks. A revision passes `previous` to both and a short `changes` sentence to publish; checks kept with the previous version run again unless dropped on purpose.

- `publish_interactive` with `page: true` keeps a new document as a page (with `title` and one emoji `icon`); `page: "<id>"` publishes a new version of an existing page from any thread.
- `page_list` and `page_get` find a page and read its sources, capabilities and last error; `page_records` queries, adds or updates its records; `page_run` starts one of its runs; `page_published` records where it is live.
- Capabilities are declared in `ramu.json` or a `<meta name="ramu-capabilities">` tag and used through `window.ramuContent`: `records`, `ai.ask`, `ai.run`, `ai.tool`, `pickImage`, `files`, `notify`, `folder` and `startThread`. Preview answers these from an in-frame fake so checks can exercise them.
- Pinned libraries: React 19.3.0, Chart.js 4.6.1, Dagre 2.0.4.
- `<link rel="stylesheet" href="ramu:kit">` adds app-styled cards, buttons, badges, tables and tabs; `<svg data-icon="name">` inserts a [Lucide](https://lucide.dev) icon. Both work offline.
- Theme variables (`--background`, `--foreground`, `--primary`, `--surface`, `--border`, `--chart-1` to `--chart-6` and more) follow the app's colors and light or dark mode.
- `window.ramuContent.setState()` and `onRestore()` keep custom state between views; on a page, that state is shared through the host.
