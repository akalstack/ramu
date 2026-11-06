# Pages: sites made in a thread, kept and opened anywhere

A person asks an agent for a small site (a trip planner, a price calculator, a dashboard of their spending, a one-page invitation) and gets a page they keep: listed in one place, opened later on the desktop or the phone, updated by asking again, shared with a link, and turned into a real deployed project when it outgrows a page. A page can also keep its own records on the host and use the host's AI providers, so an expense dashboard can turn "coffee 35k yesterday" or a receipt photo into a transaction without the person filling in a form. Document shipped behavior in [Interactive content](guide/interactive-content.md) (renamed **Pages and interactive content**) and delete this plan when implementation and acceptance are finished. Section 1 fixes how revisions show in a thread today and ships before the rest.

## The need

[Interactive content](guide/interactive-content.md) already builds and checks small documents: `preview_interactive` runs them headless at phone and desktop widths, `publish_interactive` stores the tested bytes with versions, saved scenarios and export, and the phone opens them in a private browser. But a document belongs to the thread that made it:

- **Finding it again:** there is no list. Reopening last week's calculator means remembering which thread made it and scrolling to the card.
- **Using it on the phone:** the phone opens it only from that thread's transcript, and state saved on one device is not on the other.
- **Changing it:** a new version needs the same thread; a fresh thread starts from nothing unless the person attaches it.
- **Sharing it:** **Export** downloads an HTML file the person then has to host or send.
- **Remembering things:** a document has saved scenarios but no records, so a dashboard where someone adds transactions over months has nowhere to keep them.
- **Using AI:** a document cannot ask a model anything; the person goes back to a thread for every "categorize these" or "summarize this month", although the host already has signed-in providers.
- **Growing it:** when the page needs real data, sign-in or a domain, nothing carries it into a project; the person starts over.

**Easier for the person:** "make me a page that …" ends with something they keep, open from the phone's home screen in two taps, change by asking from any thread, and share or deploy without leaving Ramu. A page that needs judgment (parse, categorize, summarize, suggest) gets it from the providers they already use, with no API key to paste and no thread to open.

## Decision: one engine, a new home

Pages are interactive content that has been kept, not a second system. The same compiler, bundler, sandbox, `ramu:kit`, pinned libraries, preview checks, versions and 512 KB limit serve both; building a parallel site builder would split checks, security review and agent instructions for no gain. What changes is ownership: a document published in a thread stays a card in that thread; **Keep as page** (or the agent publishing with `page`) moves its ownership from the thread to the host, with a stable id, title, icon and its own version history. The thread card then points at the page.

Page capabilities (records, AI from a single call to a full agent run, camera, notifications, schedules) are features of the host offered to the sandbox through `window.ramuContent`, declared by the page and granted by the person, so a page never holds a key, a token or a network path to Ramu's API.

Anything a page cannot be (a backend, many files, more than 512 KB, a public site with its own domain, a database other people outside Ramu write to) is a project, and [From an idea to a deployed app](SHIP-AN-APP-PLAN.md) handles it. **Make it a project** is the bridge.

## The person's path

1. **Asking.** In any thread: "make a page to split our trip costs". The agent previews and publishes as today; because the request asks for something to keep, it publishes with `page: true` (or the person taps **Keep as page** on the card).
2. **Finding.** **Pages** in the sidebar (desktop) and in the phone's tabs lists every page on the host, newest first, with its title, icon, project (if any) and last change. Search by title. Pin one to the top.
3. **Opening anywhere.** A page opens full-window on the desktop and full-screen on the phone, with its saved state shared through the host, so values entered on the laptop are there on the phone. **Add to Home Screen** on the phone opens it directly next time.
4. **Changing it.** **Ask about this** on an open page starts or continues a thread with the page attached; the agent's next `publish_interactive` with the page's id adds a version. **Versions** restores an earlier one.
5. **Sharing.** **Share link** gives a read-only link for devices paired with this host. **Publish to the web** is the ship-an-app path: a static deploy on the person's own account.
6. **Using its powers.** The first time a page asks for records, AI, the camera or notifications, it shows one sheet naming each capability in plain words ("Uses Claude Sonnet to read what you type, up to 200 requests a day"), which the person allows or changes. **Page settings** shows the same list later, with usage.
7. **Growing.** **Make it a project** creates a project from the page's sources (the same `project_create` the ship-an-app plan adds), starts a thread with the page as context, and the page records the project so its card says where it went.

## Delivery

### 1. Revising a document in a thread

This ships first and on its own, because it hurts today. Every `publish_interactive` revision adds a full new card to the transcript and leaves each older version at full size above it, so after three revisions the person scrolls past three similar documents, cannot tell which one is current, and may enter values in an old one. Saved state does not follow the new version unless they copy it from the menu.

- **One live card per document.** The newest version is the only full card. Each older card collapses in place to one row: the title, "v2 · replaced by v4", a one-line summary of what changed, and **Go to latest**. Expanding a collapsed row shows that version read-only with **Restore**. Collapsing keeps the transcript's order, so what the agent saw and said at each step stays where it happened.
- **Updating in place while the agent works.** While a revision is being previewed, the current card shows "Updating…" with the preview's progress instead of a new card appearing only at the end; a failed preview leaves the current version untouched and says why.
- **What changed.** The new card's header says "Updated · v4" with the agent's change summary (a required, short `changes` field on revisions) and **Compare**, which shows the previous and new versions' phone or desktop screenshots side by side, with the source diff one click away.
- **State carries over.** When the new version's saved-state shape matches (`canCopyInteractiveState` already decides this), the person's values move to it automatically, with **Undo** on the notice; when it does not, the card says the values could not carry over and offers the previous version's values to copy by hand.
- **Values in an old version are not lost.** Entering values in an expanded old version is not possible; **Restore** publishes it as a new version, so the newest card is always the one in use.
- **Phone.** The same rule in the phone transcript: one live card, older versions as rows, **Go to latest** scrolls to it. The private browser always opens the latest version unless an older one was expanded.
- **Pages.** A kept page's card in any thread always shows the page's current version, with "Updated in another thread" when that thread changed it.

Server and shared changes: a `changes` field on `publish_interactive` revisions, a latest-version lookup per document for both clients, and the transcript grouping in `packages/shared` so desktop and phone collapse the same events. Tests cover grouping, state carry-over and restore.

### 2. Pages on the host

- **Storage:** an `interactive_pages` table (id, title, icon, project id or none, pinned, current version, created and changed times) beside the existing publication tables; a page's versions are the publications it owns, so nothing is copied. Deleting a page is the person's action and keeps the threads' cards as "Page deleted".
- **Shared state:** `window.ramuContent.setState()` on a page saves to the host (bounded, per page, last write wins with a version check) instead of only the viewing device, so the desktop and phone see the same values. Thread cards keep today's per-view state.
- **IPC:** `pages.list`, `pages.get`, `pages.update` (title, icon, pin, project), `pages.delete`, `pages.keep` (from a publication) and `pages.restoreVersion`, validated with zod and limited to the paired device's permissions like the rest of the host API.
- **Agent tools:** `publish_interactive` gains optional `page` (`true` for a new page, or a page id for a new version) and `title`; `page_list` and `page_get` return pages (titles, ids, current sources) so an agent in any thread can update one by name. Deleting pages is not an agent action.

### 3. Capabilities

A page declares what it uses in `ramu.json` (or a `<meta name="ramu-capabilities">` tag for a single file); `preview_interactive` validates it and checks each call against fakes, so a broken capability fails before publication. Each call goes through the frame's message channel to the host, which checks the grant, the bounds and the page id; the page never sees credentials or other pages' data.

- **Records** (`ramuContent.records`): named collections of JSON records with a declared zod-compatible schema (`transactions: {date, amount, currency, category, note, receipt?}`), with add, update, delete, list and simple queries (filter, sort, sum by field, date range). Stored per page on the host in SQLite, bounded (10,000 records and 20 MB per page), included in **Export** as CSV and JSON, and imported from CSV. A new version that changes a schema declares a migration that `preview_interactive` runs on a copy first. This is what makes a ledger, a habit tracker or a reading list possible without a backend.
- **Camera and files** (`ramuContent.pickImage()`): a photo or file the person chooses, downscaled on the device and stored with the record, for receipts and labels; together with `ai.ask(..., {images})` a receipt becomes a transaction.
- **Notifications** (`ramuContent.notify(title, body)`): a phone and desktop notification that opens the page, limited to a few per day and shown in the grant sheet ("Tells you when spending passes your budget").
- **Schedules:** a page can declare a recurring job (`daily 08:00: summarize yesterday`) that runs on the host through the existing schedule runner: it calls the page's declared function in a headless frame with the same grants, so a summary or reminder happens without the page being open. Listed in [Schedules](guide/background-work.md) under the page.
- **Ramu data, read-only** (later, after review): a page could read the host's own figures the person already sees (Activity tokens, threads by status, a project's pull requests and deployments) for personal dashboards, each source a separate grant. Not files, credentials or transcripts.

#### AI in a page

A page uses the host's AI at three levels and picks the smallest that does the job. All three go through the providers already signed in on the host (no key in the page), the model the person chose for the page in **Page settings** (defaulting to the fastest signed-in model; the page asks for `fast` or `smart`, never a named provider), and the page's daily budget. Each appears in **Activity** with the page's name and is refused with a clear error when the provider is signed out or at its usage limit.

- **Ask** (`ramuContent.ai.ask(prompt, {schema?, images?, stream?})`): one model call with no tools, returning text or JSON checked against the schema (one retry on a mismatch). For parsing "coffee 35k yesterday", categorizing, reading a receipt, a short summary. Fast and cheap, safe to call on a button press.
- **Run** (`ramuContent.ai.run(task, {tools, schema?, maxSteps?})`): a full agent loop on the host, scoped to the page. The agent plans, calls tools, reads results and continues until it has the answer or reaches its step and token budget. Its tools are only what the page was granted:
  - the page's **records** (query, add, update; deleting asks the person in the page),
  - **page functions** the page registers with `ramuContent.ai.tool(name, schema, handler)`, run inside the page's own frame (`convertCurrency`, `addToBudget`, `drawChart`), so a page extends the agent without new host code,
  - the page's declared **HTTPS origins** through a fetch tool, and **web search** when granted,
  - **Shared MCP servers** the person grants to this page one by one (for example a mail server to find bank statements), through the host's existing [Shared MCP](guide/agents.md#rules-and-mcp) setup.

  It never gets files, a shell, Git, other pages or threads. The run streams its steps to the page (`onStep`), so the page can show "Read 120 transactions · grouped by category · writing summary", and the person can **Stop** it from the page, from **Activity** or from the phone. The final answer is checked against the schema. Runs use the same provider runtimes as threads (Claude, Codex, OpenCode, Cursor) in a locked-down mode with Ramu's page tools as the only tools; a provider that cannot run without its built-in tools is offered only for **Ask**. Runs are kept in **Page settings → History** with their steps, so the person can see why a record changed and undo the run's record changes as one step.
- **Hand off to a thread** (`ramuContent.startThread(prompt)`): for work that needs files, code or the page itself to change ("add a currency switch", "build me an import from my bank's CSV"), the page proposes a normal Ramu thread with the page and its records attached; the person confirms it, the thread works with its usual access and approvals, and its report returns as a notice on the page. The agent can use `page_records` and publish a new version of the page.

A page can also expose its own flows: a **Run** declared in `ramu.json` with a name and a prompt (`monthly-review: "Compare this month with the last three, flag unusual spending, and add a note record"`) shows as a button in the page's toolbar, can be called by schedules, and can be started by an agent in a thread with `page_run`.

Agents get the matching instructions in `tools.ts`: when to use records instead of saved state, schemas first, choosing ask, run or a thread by the work, schemas on every AI result, page functions for anything the page already knows how to do, and never calling AI on every keystroke.

### 4. What only Ramu can do

These come from what Ramu already has (an always-on host, agents that can fix code, a phone app with widgets and Live Activities, projects with Git), and each removes a step the person would otherwise take by hand.

- **Pages that fix themselves.** A script error or failed capability call on any device is reported to the host with the page's version, state and the steps before it. The page shows **Fix this**, which hands off to a thread with that report attached; the agent reproduces it with `preview_interactive`, publishes a fixed version and the page reloads. Nobody copies an error message.
- **Checks that stay.** The controls and checks `preview_interactive` ran are kept with the page and run again on every new version and whenever a pinned library changes, so a change that breaks the add-transaction button is caught before it is published, not discovered on the phone.
- **Point and ask.** **Edit** on an open page lets the person tap an element (on the phone, with voice through the native keyboard) and say what to change: "make this total bigger", "put the chart first". The selection, its text and a screenshot go to the thread like the browser panel's annotations, so the agent changes the right thing the first time.
- **Ask this page.** Every page with records gets a question box with no code from the page: "how much on food in March?" runs a read-only page agent over the records and answers with numbers and a small chart. A useful answer can be kept as a new panel on the page with one tap, which publishes a version.
- **Works offline on the phone.** Records added without a connection queue on the phone and sync when the host answers, with conflicts shown, not overwritten. Ask and Run calls made offline wait in the same queue, so the expense tracker works on a plane.
- **On the phone's home screen.** A page can declare a **widget** (a number, a short list or a small chart from its records, refreshed by the host) for the iOS and Android home screen, and a long Run shows as a Live Activity like agent work does today.
- **Triggers on records.** Besides schedules, a page can declare "when a record matches, run this" (a transaction over the budget, a habit missed three days), which notifies or starts a declared Run. The same webhook path as [webhook schedules](guide/background-work.md#when-a-request-arrives) can add records from outside (a bank's email alert, a form on the person's site), validated against the schema.
- **Pages from work already in Ramu.** "Make a page from this thread" turns a thread's results (a test report, a comparison, a migration checklist) into a page; a page in a project can be granted read-only access to one folder of that project (for example `data/`), so a project's dashboard updates when its files change. Never the whole checkout, and never write access.
- **Visual version history.** **Versions** shows each version's phone and desktop screenshots from its checks side by side with a one-line summary of what changed, so the person restores the right one without opening each.
- **Duplicate as a template.** **Duplicate** copies a page with its code and capabilities but empty records, so a household ledger becomes a club's ledger in one step, and another host can import it from a share link.
- **Your data stays on your host.** Records, photos and run history never leave the host except to the provider a call uses, and the grant sheet says which provider sees what.

### 5. Desktop

- **Pages** in the left sidebar under Inbox and Schedules (no right sidebar), opening a list built from the existing list rows, and a page view that reuses the interactive card's frame at full size with its toolbar (Fit, Tablet, Phone, **Versions**, **Ask about this**, **Share link**, **Export**, the page menu).
- **Keep as page** on every interactive card; a kept card shows the page's title and **Open page**.
- Projects show their pages in the project's menu, so a page made for a project is found from both places.

### 6. Phone

- A **Pages** tab entry listing the host's pages (with the existing host filter), opening a page in the private browser already used for interactive content, now loaded from the host by page id so it works without the thread.
- **Add to Home Screen** through the phone's share sheet with the page's title and icon; the link opens the Ramu app at that page and asks to reconnect when the host is unreachable, never showing a stale copy as current.
- Offline: the last opened version is cached on the phone and marked "Saved copy" until the host answers.

### 7. Share link

- **Share link** makes a link to the current version for anyone using a device paired with this host, opened in the same sandbox, read-only by default; **Can add records** lets a household share one ledger. AI calls from a shared link use the owner's grant and count against the same daily limit. It names the host, can be revoked, and expires after 30 days unless renewed.
- Opening a page to people without Ramu goes through the host's own tunnel ([Your own tunnel](guide/remote-hosts.md#your-own-tunnel)) on a separate hostname serving only that page's static bytes, never Ramu's API. It needs a security review before it ships, like the tunnelled app in the ship-an-app plan's **Own server**; until then the path for outsiders is **Publish to the web**.

### 8. Connection with shipping an app

- **Publish to the web** exports the page's tested bytes as a static site and deploys it through the ship-an-app plan's `HostingAdapter` (GitHub Pages, Cloudflare Pages, Netlify or Vercel), on the person's account, with the same one-time approval for the first production deploy. The page remembers the target and live URL; a new version offers **Update live site**. This needs only the deploy targets from that plan, not a repository or CI.
- A page with records or AI cannot be published to the web as is: the sheet says so and offers **Make it a project**, where the ship-an-app plan gives it a database and a server-side model call on the person's own accounts.
- **Make it a project** writes the page's sources and its record schemas (as a database schema and seed data) (they are already kept with each publication) into a new project through `project_create`, using the Vite + React stack when the page uses React and a static site otherwise, then follows that plan's path from **Building** onward.
- Ship-an-app's stack choice sends a request like "a page that adds up my monthly costs" to a page instead of a project when it needs no backend, data shared between people or a domain, so the smallest thing that works is made first.

### 9. Documentation

- Rename and extend [Interactive content](guide/interactive-content.md) to **Pages and interactive content**: keeping a page, the Pages list, opening on the phone, shared state, versions, share links, publishing to the web and making it a project. Document each capability with a worked example (the expense dashboard). Update [Agents](guide/agents.md) (`page`, `page_list`, `page_get`, `page_records`), [Providers](guide/providers.md) (pages using a provider, and where their usage shows), the [mobile README](../apps/mobile/README.md) and [VERIFICATION.md](../apps/mobile/VERIFICATION.md), and [SECURITY.md](../SECURITY.md) (share links and tunnel isolation).
- Every string through `t()` with its Indonesian translation.

## Safety

- Pages run in the same sandbox as interactive content: no access to files, Ramu or other pages, offline unless they declared exact HTTPS origins. Shared state is bounded and stored per page.
- Capabilities are granted per page and listed in plain words; a new version that asks for more shows the grant sheet again. The page never receives provider credentials, and AI calls carry no thread, file or memory context beyond what the page sends.
- A page run's tools are fixed by the page's grants for the whole run; it cannot widen them, reach the host's files or shell, or start a thread without the person's confirmation. Runs are bounded in steps, tokens, time and record writes, and every run's record changes can be undone together.
- Records, fetched pages and MCP results are untrusted input to the run. Deleting records, sending through an MCP server or anything that leaves the host asks the person in the page, whatever the grant, so an instruction planted in a record can at worst change records the run could already change, and those can be undone.
- AI calls are bounded in size, rate and daily count, and records in count and bytes; images are stripped of location metadata before storage.
- Webhook-added records are checked against the page's schema and limited in rate; a project folder grant is read-only, one folder, and shown in the grant sheet with its path. Widgets show only what the page declared for them, and nothing on a locked phone unless the person allows it.
- Share links are revocable, revocable and expiring; a page served beyond paired devices never shares an origin or port with Ramu's API.
- Publishing to the web and the first deploy are the person's actions, through the same approval card as any production deploy.

## Acceptance

- **Revise in a thread:** ask for a calculator, then three changes. The transcript shows one full card (the latest, with what changed and the values entered earlier), three one-line older versions in their places, and **Restore** on v1 brings it back as v5.
- **Keep and reopen:** ask for "a page to split trip costs between four people", enter amounts on the desktop, then open it from the phone's Pages list a day later from another network over a tunnel and see the same amounts, without finding the thread.
- **Expense dashboard:** ask for "a dashboard where I add transactions and see spending by category each month". On the phone, type "coffee 35k yesterday" and photograph a receipt; both become categorized transactions through the host's model. A month later the dashboard shows the totals, a daily summary arrives as a notification, **Monthly review** runs as a page agent that reads the records, converts currencies through a page function and adds a note, with its steps visible and **Stop** working from the phone; **Undo run** removes its changes. A request to add a bank import hands off to a thread that publishes a new version.
- **Fix and edit without words for code:** a page that throws on the phone shows **Fix this**, and the fixed version loads there without the person describing the error; tapping the total and saying "make this bigger" changes that element only.
- **Offline and widget:** transactions added in airplane mode sync when the phone reconnects, and the home-screen widget shows this month's total within a minute.
- **Ask this page:** "how much on food in March?" answers correctly from the records with no code written for it, and **Keep** adds it as a panel.
- **Change from anywhere:** in a new thread, "add a currency switch to my trip page" updates the same page as a new version, and **Versions** restores the old one.
- **Home Screen:** a page added to the phone's Home Screen opens in two taps and says when the host is offline.
- **Publish:** the trip page goes live on GitHub Pages from **Publish to the web** with one approval, and **Update live site** ships the next version.
- **Grow:** **Make it a project** on a React page produces a project that builds and runs in the browser panel with the same behavior, and the ship-an-app path deploys it.
- Live checks on physical phones and with real hosting accounts are listed under [Acceptance](roadmap.md#acceptance) until run.
