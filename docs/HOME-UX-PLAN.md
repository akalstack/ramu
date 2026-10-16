# Home UX review and plan

Review of the desktop Home (`apps/web/src/NewTask.tsx` start box and `apps/web/src/Home.tsx` feed), 2026-10-16, made from the code and from e2e screenshots of the built app at 1440×900 with a project, two running threads and two schedules. The mobile app has its own section at the end. The marketing site (`apps/site`) is out of scope.

**Status (2026-10-16).** Part of step 1 is implemented; the rest and step 2 (Inbox) and the mobile plan are not.

Done on desktop:

- One `FeedSection` heading style (`HomeSection.tsx`) for agents, recaps, **What Ramu learned** and **Coming up**; agent cards are borderless and compact (the separate Open button is gone; the title opens the thread).
- Order: waiting agents, then recaps that need attention, then running and usage-limited agents, then recaps since your last visit, learned and upcoming. Recaps and schedules show three rows with **Show all**.
- Hero compacts (smaller minimum height, mark hidden) whenever the feed has content.
- "Since your last visit" now means since you left the app, so recaps no longer disappear on the next visit to Home.
- The background-service line shows only when the service is stopped, with a **Start** button. Recap freshness moved into the refresh button's tooltip.
- The heading no longer duplicates the project menu; with no projects Home offers **Open a folder**.

Not done: Inbox page, remembering the last-used project, schedule deep links, recap undo and snooze choices (need server support), the mobile Inbox. The default project was left alone because many specs assume "No project".


> **Revised after commit 1e60ad1 (2026-10-16).** That commit landed after the first draft of this review. It replaced the **Running in the background** list with `HomeAgents.tsx` (an agents overview: Waiting for your input, Running, Waiting for allowance, and a collapsed Completed group, with Open/Stop buttons and inline question, approval and form cards), shrank the hero when agents are present, hid the checkout chip behind an icon, and added a first-run `Onboarding` dialog. Findings 1, 2, 6 and 8 below are updated for it; the rest are unchanged.

## Where Home stands

Home is the New thread page: a hero (mark, heading), the composer with its chip tray, then `HomeFeed` below it. The feed stacks up to six blocks in this order: the agents overview (`HomeAgents`), **What Ramu learned**, recap error, **Needs your attention**, **Since your last visit**, **Coming up**, then a footer with background-service status and recap freshness. Each block renders only when it has content.

An earlier decision (2026-10-12) made Home _be_ the New thread page, with background threads, recaps and schedules under the box. That decision stands for this plan: Home stays the start surface. What changes is how much of the feed it carries and in what order.

## Findings

Ordered by impact.

1. **The feed starts below the fold, and now it can also grow very tall.** `.start-view` has `min-h-[min(560px,72vh)]` (`NewTask.tsx`). Since 1e60ad1 it drops to `min(320px,42vh)` only when `.home-agents` is present, so an empty-agents Home still puts the first feed row near y≈620 in a 900px window (measured before that commit). The new agents overview renders every agent as a full card, and a waiting thread embeds its whole question or approval, so a few agents push recaps, **What Ramu learned** and **Coming up** far below the fold. **Needs your attention** (recaps) still renders after the agents block.
   - **Two "needs you" lists.** Waiting-for-input agents (answerable in place) and attention recaps are separate blocks with different looks. They should be one block.
2. **Block styles disagree, and there are now three.** Recaps use a 15px semibold heading and a borderless raised card; **Coming up** uses a small muted heading and flat rows; the new agent cards use a plain `font-medium` heading, `border border-border` and shadcn `outline` buttons, which departs from the borderless, shade-and-spacing direction recorded on 2026-10-12. There is no shared section component, and Home.tsx still repeats long class strings. A reader can't tell which block matters more.
3. **"Since your last visit" empties itself.** `lastVisit` is read when `HomeFeed` mounts and `ramu.last-visit` is overwritten in the same effect (`Home.tsx:26-31`). `HomeFeed` remounts each time you return to Home, so recap items vanish on the second visit without being dismissed. This needs confirming in the running app, but the code path is clear.
4. **Background-service status is easy to miss when it matters.** A 11px grey label with a dot sits in the feed footer. If the service is stopped, threads and schedules will not run when Ramu closes, but the label is the same size and colour as when it is running. The status bar already exists and is the better home for a "running" indicator.
5. **Recap freshness is noise.** "Daily recap updated 2 seconds ago" shows even when there are no recap items, and the relative time never refreshes. It belongs next to the refresh action, not as a permanent footer line.
6. **Rows don't deep-link, and the agent cards are heavy.** "Coming up" rows open the Schedules list, not the schedule you clicked, and show three rows with no "View all". Each agent card carries Open and Stop buttons plus a title button that also opens, which is three controls for one action; a `Done` group and helpers share the same cards. The overview duplicates the sidebar spinners (still worth keeping for collapsed projects, usage waits and in-place answers), but rows should be compact and expand only when input is pending.
7. **The start box defaults to "No project" even when projects exist** (`HomePage`: `ws.composing ?? NO_PROJECT`). The project is also switchable in two places at once: the heading menu and the tray chip. The default should be the last-used project.
8. **Little help after first run.** `Onboarding` (new) now walks a first-time user through a provider and **Choose a project**, but **Set up later** drops them on a Home with no visible "Open a folder" action. Adding a project is then a small sidebar icon or a hidden folder drag-and-drop (`NewTask.tsx` `onDrop`).
9. **Recap actions have no undo.** Dismiss and Mark done are immediate, and Snooze is fixed at one day. Several cards each carry a violet primary "Open thread", so a long list shouts.
10. **Only the latest "What Ramu learned" is reachable from Home.** History lives in Settings → Memory & skills.

## Recommendation

Two steps. Do step 1 first; it fixes most of the above with no structural change. Do step 2 once step 1 has shipped.

### Step 1: fix the page we have (no new navigation)

- **Compact the hero.** Drop `min-h-[min(560px,72vh)]` in every state, not only when agents exist. Place the heading and composer in the upper third; hide the animated mark once the feed has any content. Target: the first feed row is visible at 720px window height.
- **Reorder by actionability:** Needs you → Running → Since your last visit → What Ramu learned → Coming up. Merge the agents overview's **Waiting for your input** group and attention recaps into one **Needs you** block, keeping the in-place answering from `HomeAgents`.
- **One `FeedSection` component** (title, count, optional "View all", consistent heading and row style) replacing the repeated class strings, and used by `HomeAgents` too. Agents become compact rows (one click opens; Stop in a row menu); a row expands to its question, approval or form only when input is pending. Cards only for recaps. Drop the `border-border` card style.
- **Cap Home at a glance:** at most three rows per block with "View all" (links to step 2 once it exists; until then, expand in place).
- **Fix the last-visit logic.** Record the visit on window blur or app start, not on every mount, and keep dismissed/snoozed state as the only way an item leaves.
- **Move status out of the feed.** Show nothing when the background service runs (the status bar shows a dot). When it is stopped, show a banner row with a Start button. Put recap freshness in the refresh button's tooltip.
- **Deep links:** a "Coming up" row opens that schedule; a Running row opens the thread (already does).
- **Default project:** remember the last-used project for the start box. Remove the duplicate switcher: keep the tray chip, make the heading plain text ("What should we work on in `demo`?" without a menu), or keep the heading menu and drop the chip. Pick the chip; it is the pattern the composer tray already uses.
- **Empty state:** with no projects, show an **Open a folder** button and the drop hint in the hero (covers users who pressed **Set up later** in `Onboarding`).
- **Undo for Dismiss / Mark done** as a toast action; offer Snooze durations (later today, tomorrow, next week) in a menu.

### Step 2: an Inbox page with tabs

Home keeps only the glance. Depth moves to a new global **Inbox** page, built the same way as Schedules (a sidebar nav row between **New thread** and **Schedules** that swaps the main area, `ui.sidebar` value, `globalPage` handling in `App.tsx`).

- **Nav row:** "Inbox" with the attention count in the existing `.activity-badge` slot. When the sidebar is hidden the count already shows on the sidebar toggle (`attentionChats`).
- **Tabs inside the page** (a segmented control with counts, never in the title bar): **Needs you · Running · Recaps · Learned · Done**. Persist the selected tab. **Done** lists marked-done and dismissed recaps so Undo is not the only recovery.
- **Learned** moves the full summary history here (today only in Settings), with the unread dot per item.
- **Home becomes:** hero + composer + up to three Needs you rows and three Running rows, each with "View all" into the matching Inbox tab.

Why a page and not tabs on Home: tabs on Home would hide content behind clicks on a screen whose job is a quick glance and a start box, and would add a second navigation layer under the sidebar. A page keeps Home short and gives the feed room to grow.

### Considered and not chosen

- Tabs on Home itself (above).
- Title-bar tabs, an activity rail or a right sidebar: ruled out earlier by the owner.
- One page per feed type: too many sidebar rows for content that is empty most of the time.
- Moving recaps into Settings: Settings already holds the learning history, but recaps are things to act on, not to configure.

## Blast radius

Check these before and after any change:

- `HomeFeed` (which now renders `HomeAgents`) is shared by Home and by New thread via `NewTask feed` (`NewTask.tsx`); a change to the feed changes both. `HomeAgents` has its own server test (`apps/server/test/agentsOverview.test.ts`, `agent.all`) and documentation in `docs/AGENTS.md` ("Agents overview"). `feed={false}` is used when the box is docked beside a file.
- `e2e/specs/summaries.spec.mjs` depends on the `Home` button and `.learned-card`; `e2e/specs/settings.spec.mjs` depends on the **Refresh recap** button being visible, and hidden when daily recaps are off.
- `chat`, `layout`, `panels`, `workspace` and `i18n` specs also click the **Home** button, and `comparison-plan.spec.mjs` pins the `HomeAgents` structure (`.home-agents`, section labels, headings, `article` rows, Show completed); run them too.
- Docs that describe Home: `docs/AGENTS.md` ("Home lists it under **Running in the background**"), `docs/AUTOMATION.md` (Home recaps), `docs/LEARNING.md` (Home summary card). Update them with the change.
- Every new label needs an Indonesian entry in `packages/shared/src/locales/id.ts`; remove strings for removed copy (`docs/LOCALIZATION.md`). `pnpm test:e2e i18n` covers switching.
- Shell layout changes (a new nav row, a new global page) touch `App.tsx` page switching, saved workspace state (`sidebar` values) and the command palette; add a palette command and a shortcut for Inbox that does not clash with existing ones.

## Verification

Build, then run `pnpm test:e2e summaries settings chat layout panels workspace i18n comparison-plan`. Attach before/after screenshots at 1440×900 and 1280×720 with: no content, a running thread, a needs-input thread, a recap, and a stopped background service. Follow the repo's rule to report which checks ran (`CONTRIBUTING.md`). Run `pnpm check` before pushing.

## Suggested order of work

1. `FeedSection`, reorder, merged Needs you block, compact hero (findings 1, 2).
2. Last-visit fix; status and freshness moved (findings 3, 4, 5).
3. Deep links, default project, one switcher, empty state (findings 6, 7, 8).
4. Undo and snooze menu (finding 9).
5. Inbox page and tabs, then thin Home to the glance (finding 10 and the structure above).

## Mobile

Read from `apps/mobile/src/app/index.tsx`, `components/ActivityTray.tsx`, `app/_layout.tsx`, `apps/server/src/remote/mobilePush.ts` and the mobile README. Not run on a device; confirm layout findings on iOS 26 and Android.

### What mobile has today

- **Home ("Workspaces")** is one list: Outbox, **Needs you**, Pinned, one collapsible section per project, then Standalone threads. Above it: computer switcher, a workspace filter, status chips (All, Running, Needs you, Failed, Archived) and search. The header has a bell, a terminal button and settings.
- **Bottom of the screen is taken.** On iOS 26 a glass capsule holds search and a compose button; on Android an extended FAB holds New thread.
- **The bell opens the Activity sheet** (`ActivityTray`): threads waiting, threads working, the computer's background tasks and missed notices. `app/activity.tsx` is only a deep-link redirect into a thread.
- **Notifications:** push for a thread done, needing input or failed, with generic text only (no prompts, paths or computer names), plus Live Activities and in-app banners.
- **Not on mobile at all:** recaps, **What Ramu learned**, and a schedules view. The plan has schedules created through prompts and commands. The shared host dispatcher forwards every non-`network.*` method from a paired phone (`apps/server/src/index.ts`), so `recaps.get`, `recaps.act`, `summaries.get` and `schedules.*` should already be reachable; confirm there is no per-method gating before building.

### Findings

1. **The same state appears in three places:** the **Needs you** group, the **Needs you** chip and the bell sheet.
2. **The bell badge is not a signal.** Its count adds waiting, working, background and missed items, so it stays above zero whenever anything runs.
3. **The phone is where "what happened while I was away" matters most, and mobile has no answer to it.** No recap, no upcoming schedules, no learned summary.
4. **The title says "Workspaces" over a list of threads.** Desktop says Threads and Projects.

### Decision: same page, bottom tab bar, or notifications?

None of the three alone. Recommendation: **keep Home as the thread list, add one Inbox page reached from the bell, and use notifications only for things that need you now.**

- **Same page as projects: no, for recaps, schedules and learned.** The list is already long, and putting a feed above the projects adds scrolling before the thing people open the app for. Keep **Needs you** where it is.
- **Bottom tab bar: not now.** It would stack under or fight the iOS 26 glass capsule and the Android FAB, and today there are only two destinations (Threads and Inbox). Revisit when there are four or more top-level destinations (for example Threads, Inbox, Schedules and Terminals); then use native tabs and show the search and compose controls on the Threads tab only.
- **Notifications alone: no.** They suit interruptions, not a digest. A recap pushed daily is noise, and a missed push leaves nothing to look at afterwards.

### The Inbox page

- A full-screen route (`/inbox`) opened from the bell, replacing the Activity sheet. Same name as the desktop Inbox in step 2 above, so the product has one concept.
- **Segmented tabs at the top (not a bottom bar):** **Needs you · Recaps · Scheduled · Learned**, with counts. Scoped to the selected computer, like Home.
  - **Needs you:** threads waiting on you plus attention recaps. Rows open the thread; recap rows use the existing `SwipeRow` for Done, Snooze and Dismiss. Answering in place can come later; opening the thread already works.
  - **Recaps:** items since your last visit, with the same last-visit fix as desktop.
  - **Scheduled:** next runs, last result, Pause/Resume and Run now (`schedules.pause`, `schedules.runNow`).
  - **Learned:** the latest summaries with an unread dot, read-only, with **Looks good**.
- **Bell badge** counts only things that need action: waiting threads, unread recaps or summaries, failed scheduled runs. Running threads no longer count; they already show in the list and in Live Activities.
- Home stays a thread list. Remove the duplicate **Needs you** chip (keep the group), and rename the title to match desktop.
- The computer switcher shows "N need you" per computer so another computer's work is visible without switching.

### Notification rules

- **Push (interrupt):** thread needs input, thread failed, thread done (already built), and, new, a **scheduled run failed or finished**. Same generic text and privacy rules as today; the tap opens the thread, or the Inbox **Scheduled** tab if no thread exists.
- **Silent (badge on the bell, no push):** recaps and learned summaries.
- **Optional, off by default:** a once-a-day digest push ("Your daily recap is ready"), generic text only.
- **Settings → Notifications** gets one switch per category (input, failed, done, scheduled, digest), sent to the host with the device registration so the host only pushes what is on. Foreground banners stay suppressed in favour of the in-app notice, as today.

### Mobile blast radius

- `apps/mobile/src/runtime/store.tsx` and `types.ts` need the new data and a refresh path; the host event stream must carry `automation:changed`-style updates, or the Inbox polls on focus.
- Capability handshake: older hosts must show the existing "update your host" message for the Inbox instead of an empty page (README: `mobile-companion` capability).
- Push: `apps/server/src/remote/mobilePush.ts` (new category, per-device preferences), `PushRouting.tsx` (new tap target).
- Tests: `apps/mobile/test/*.test.mjs` (store and turns), `e2e/specs/mobile.spec.mjs`, and a new Inbox spec with a fake schedule and a fake recap.
- i18n: every new label in `apps/mobile/src/i18n.ts` for English and Bahasa Indonesia.
- The native adaptive header and glass controls need a development build, not Expo Go (README).
- iOS 26 glass capsule and Android FAB must still sit above the list on Home after the bell changes; take screenshots on both.

### Mobile order of work

1. Confirm host methods are reachable from a paired phone; add types and a store slice; add the capability flag.
2. `/inbox` route with the **Needs you** tab and the reworked bell badge; remove the Needs you chip.
3. **Scheduled** tab and the scheduled-run push category.
4. **Recaps** and **Learned** tabs.
5. **Settings → Notifications** switches and the optional digest.
6. Re-evaluate a bottom tab bar when a fourth top-level destination exists.
