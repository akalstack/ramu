# Home UX review and plan

Review of the desktop Home (`apps/web/src/NewTask.tsx` start box and `apps/web/src/Home.tsx` feed), 2026-10-16, made from the code and from e2e screenshots of the built app at 1440×900 with a project, two running threads and two schedules. Mobile (`apps/mobile`) and the marketing site (`apps/site`) are out of scope.

This is a plan only. Nothing here is implemented.

## Where Home stands

Home is the New thread page: a hero (mark, heading), the composer with its chip tray, then `HomeFeed` below it. The feed stacks up to six blocks in this order: **Running in the background**, **What Ramu learned**, recap error, **Needs your attention**, **Since your last visit**, **Coming up**, then a footer with background-service status and recap freshness. Each block renders only when it has content.

An earlier decision (2026-10-12) made Home _be_ the New thread page, with background threads, recaps and schedules under the box. That decision stands for this plan: Home stays the start surface. What changes is how much of the feed it carries and in what order.

## Findings

Ordered by impact.

1. **The feed starts below the fold and the most actionable block comes late.** `.start-view` has `min-h-[min(560px,72vh)]` (`NewTask.tsx:471`), and the hero is centred in it, so the composer ends near y≈590 and the first feed row starts near y≈620 in a 900px window. On a 13" laptop the feed is off-screen. Inside the feed, **Needs your attention** renders after Running and Learned, so it is usually the furthest thing down.
2. **Block styles disagree.** Running and recap blocks use a 15px semibold heading and a card; **Coming up** uses a small muted heading and flat rows. There is no shared section component; each block repeats an 800-character class string. A reader can't tell which block matters more.
3. **"Since your last visit" empties itself.** `lastVisit` is read when `HomeFeed` mounts and `ramu.last-visit` is overwritten in the same effect (`Home.tsx:26-31`). `HomeFeed` remounts each time you return to Home, so recap items vanish on the second visit without being dismissed. This needs confirming in the running app, but the code path is clear.
4. **Background-service status is easy to miss when it matters.** A 11px grey label with a dot sits in the feed footer. If the service is stopped, threads and schedules will not run when Ramu closes, but the label is the same size and colour as when it is running. The status bar already exists and is the better home for a "running" indicator.
5. **Recap freshness is noise.** "Daily recap updated 2 seconds ago" shows even when there are no recap items, and the relative time never refreshes. It belongs next to the refresh action, not as a permanent footer line.
6. **Rows don't deep-link.** "Coming up" rows open the Schedules list, not the schedule you clicked. The block shows three rows with no "View all". Running rows duplicate the sidebar spinners (still useful for collapsed projects and for rate-limit waits, so keep them, but make them compact).
7. **The start box defaults to "No project" even when projects exist** (`HomePage`: `ws.composing ?? NO_PROJECT`). The project is also switchable in two places at once: the heading menu and the tray chip. The default should be the last-used project.
8. **No path for a first-run user.** With zero projects, Home shows the hero, a composer and a footer. Adding a project is a small sidebar icon or a hidden folder drag-and-drop (`NewTask.tsx` `onDrop`). There is no visible "Open a folder" action.
9. **Recap actions have no undo.** Dismiss and Mark done are immediate, and Snooze is fixed at one day. Several cards each carry a violet primary "Open thread", so a long list shouts.
10. **Only the latest "What Ramu learned" is reachable from Home.** History lives in Settings → Memory & skills.

## Recommendation

Two steps. Do step 1 first; it fixes most of the above with no structural change. Do step 2 once step 1 has shipped.

### Step 1: fix the page we have (no new navigation)

- **Compact the hero.** Drop `min-h-[min(560px,72vh)]`. Place the heading and composer in the upper third; hide the animated mark once the feed has any content. Target: the first feed row is visible at 720px window height.
- **Reorder by actionability:** Needs you → Running → Since your last visit → What Ramu learned → Coming up. Merge needs-input threads and attention recaps into one **Needs you** block with the thread's question or the recap action inline.
- **One `FeedSection` component** (title, count, optional "View all", consistent heading and row style) replacing the repeated class strings. Cards only for recaps; everything else is a row.
- **Cap Home at a glance:** at most three rows per block with "View all" (links to step 2 once it exists; until then, expand in place).
- **Fix the last-visit logic.** Record the visit on window blur or app start, not on every mount, and keep dismissed/snoozed state as the only way an item leaves.
- **Move status out of the feed.** Show nothing when the background service runs (the status bar shows a dot). When it is stopped, show a banner row with a Start button. Put recap freshness in the refresh button's tooltip.
- **Deep links:** a "Coming up" row opens that schedule; a Running row opens the thread (already does).
- **Default project:** remember the last-used project for the start box. Remove the duplicate switcher: keep the tray chip, make the heading plain text ("What should we work on in `demo`?" without a menu), or keep the heading menu and drop the chip. Pick the chip; it is the pattern the composer tray already uses.
- **Empty state:** with no projects, show an **Open a folder** button and the drop hint in the hero.
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

- `HomeFeed` is shared by Home and by New thread via `NewTask feed` (`NewTask.tsx`); a change to the feed changes both. `feed={false}` is used when the box is docked beside a file.
- `e2e/specs/summaries.spec.mjs` depends on the `Home` button and `.learned-card`; `e2e/specs/settings.spec.mjs` depends on the **Refresh recap** button being visible, and hidden when daily recaps are off.
- `chat`, `layout`, `panels` and `workspace` specs also click the **Home** button; run them too.
- Docs that describe Home: `docs/AGENTS.md` ("Home lists it under **Running in the background**"), `docs/AUTOMATION.md` (Home recaps), `docs/LEARNING.md` (Home summary card). Update them with the change.
- Every new label needs an Indonesian entry in `packages/shared/src/locales/id.ts`; remove strings for removed copy (`docs/LOCALIZATION.md`). `pnpm test:e2e i18n` covers switching.
- Shell layout changes (a new nav row, a new global page) touch `App.tsx` page switching, saved workspace state (`sidebar` values) and the command palette; add a palette command and a shortcut for Inbox that does not clash with existing ones.

## Verification

Build, then run `pnpm test:e2e summaries settings chat layout panels workspace i18n`. Attach before/after screenshots at 1440×900 and 1280×720 with: no content, a running thread, a needs-input thread, a recap, and a stopped background service. Follow the repo's rule to report which checks ran (`CONTRIBUTING.md`). Run `pnpm check` before pushing.

## Suggested order of work

1. `FeedSection`, reorder, merged Needs you block, compact hero (findings 1, 2).
2. Last-visit fix; status and freshness moved (findings 3, 4, 5).
3. Deep links, default project, one switcher, empty state (findings 6, 7, 8).
4. Undo and snooze menu (finding 9).
5. Inbox page and tabs, then thin Home to the glance (finding 10 and the structure above).
