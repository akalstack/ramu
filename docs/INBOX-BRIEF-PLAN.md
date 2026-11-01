# Inbox Brief

Inbox gains a short Brief at the top. It is an addition, not a replacement. Remove work as it lands, document shipped behavior in the feature guides, and delete this plan when implementation and acceptance are finished.

## The need

Someone returning to Ramu asks one question: what needs me? Inbox answers it, but across separate places. Waiting is one tab, Recaps another, and a recap item can only be opened, finished, dismissed or snoozed, so fixing a failed thread still means opening it and working out what to do.

**Easier for the person:** one glance shows what matters, most urgent first, and the usual next step is one tap. Opening a thread becomes the exception.

## Decision: keep Inbox

Screens checked on desktop on 2026-11-01. Keep what already works: live tabs, answering requests in place, nothing to clear, snooze with Undo. An overhaul would throw that away to fix a problem that sits above it: Inbox has no summary and no suggested next step. **All** already mixes Waiting and Completed, so the Brief gives it a better top rather than a new page.

Problems found on the screens, fixed in this delivery:

- Two approval cards fill the first screen, so a third thing that matters falls below the fold.
- A failed thread has no action of its own, and no group of its own above finished work.
- **Recaps** shows "Preparing your first recap" above "No recaps yet", which disagree.

## Delivery

```
Good morning. 2 need you, 5 finished overnight.

1  Backfill dueDate failed · vps          Retry   Open
2  Checkout asks: ISO or locale?          ISO   Locale
3  Allow Bash: pnpm test · api            Allow once   Open

Finished: migration, API tests and 3 more   See all
```

- **Live and free:** the rows, counts and order come from thread state (`hostInbox`, `operatorSnapshot`), across hosts, and update as things change. No model call is needed to show them.
- **Order:** approvals and questions, then failures, then limits and paused goals. At most five rows, then **See all**.
- **One tap:** rows use the Operator's action list and `runOperatorActions`, so tapping a button is the confirmation. Question rows show their choices; free-text questions and anything with details open in place. Approvals keep **Allow once** only here; saved rules stay in the full card.
- **Optional wording:** with recaps on, the first line and the item text reuse the daily recap's wording. With recaps off, or before the first recap, the Brief still works from state alone.
- **Operator:** its box moves into the Brief, directly under the rows, when it is turned on.
- **Waiting cards:** collapse to one line each after the first, expanding on tap.
- **Phone:** the same rows at the top of Inbox. The daily push opens them.
- **Recaps tab:** the empty state says one thing, and shows **Preparing your first recap** only while one is running.

### Later options

Reading the Brief aloud, a second daily run, and suggested actions from recap text. Automatic actions stay out: the person taps.

## Services to extend

`packages/shared/src/hostInbox.ts` for order, `packages/shared/src/operator.ts` for actions, `apps/web/src/inbox/`, `apps/mobile/src/app/(tabs)/inbox/`, `apps/server/src/memory/recaps.ts` for wording.

## Acceptance

- With two approvals, a failed thread and five finished threads, the first screen shows all three that need the person in priority order, on desktop and phone, with no model call.
- **Retry** on a failed row continues that thread on its own host, and the row leaves when it runs.
- With recaps off, the Brief is complete.
- A viewer sees the rows without action buttons.
- Representative task: back after a night away, clear a failure and two questions without opening a thread.

Tests: shared order and row tests, web and mobile render tests. Desktop changes run `pnpm build` then `pnpm test:desktop-smoke`.
