# Simple Home and Inbox Brief

Home becomes a start screen with no lists, and Inbox becomes the one place that answers "what needs me?". Remove work as it lands, document shipped behavior in the feature guides, and delete this plan when implementation and acceptance are finished.

## The need

Someone returning to Ramu asks one question: what needs me? Desktop answers it twice. Home lists waiting threads, recaps needing attention and threads started together, and Inbox lists them again, while the sidebar marks the same threads. Inbox spreads its answer across tabs, and a recap item can only be opened, finished, dismissed or snoozed, so fixing a failed thread still means opening it and working out what to do.

**Easier for the person:** Home is only for starting work. One glance at Inbox shows what matters, most urgent first, on every connected host, and the usual next step is one tap.

## Decisions

- **Home has no lists.** It keeps the start box and one line, such as **2 need you · 5 finished**, that opens Inbox. Its Waiting, Needs your attention and Started together sections move to Inbox.
- **Keep Inbox on desktop and phone.** With the lists gone from Home it no longer duplicates anything, and it stays the only place for Recaps, Learned and the all-hosts view. No rename or overhaul: its live state, answering in place, nothing to clear, and snooze with Undo all work.
- **The Brief replaces the All and Waiting tabs.** They would otherwise repeat it. Tabs become **Brief**, **Running**, **Recaps**, **Learned** and **Completed**. Saved selections of All or Waiting open on Brief.
- **The Operator stays in Inbox,** inside the Brief.
- **Opening screens stay as they are.** Desktop opens on Home and the phone on Threads. Inbox never opens by itself, so the app starts the same way each time.

Problems found on the desktop screens, fixed in this delivery:

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

- **Home:** remove `HomeFeed`'s lists and `HomeGroups`, and keep one summary line, hidden when nothing needs attention. A host with no projects keeps its add-project prompt.
- **Started together:** group cards move from Home to the Brief, below the rows. The phone already shows them in Threads, and keeps them there.
- **Badge:** the Inbox badge counts what needs the person now, on desktop and phone: waiting threads, failed threads and recaps needing a decision. A failure stops counting once it is retried, opened or marked done.
- **Live and free:** the rows, counts and order come from thread state (`hostInbox`, `operatorSnapshot`), across hosts, and update as things change. No model call is needed to show them.
- **Order:** approvals and questions, then failures, then limits and paused goals, then recaps needing a decision. At most five rows, then **See all**.
- **One tap:** failures use the Operator's retry, and questions and approvals use the existing replies, so tapping a button is the confirmation. Free-text questions and anything needing detail expand in place. Approvals offer **Allow once** here; saved rules stay in the full card. **See all** expands the list in place.
- **Operator:** its box sits directly under the rows, when it is turned on.
- **Phone:** there is no Home to simplify. The same rows open Inbox, and the daily push opens them.
- **Recaps tab:** the empty state says one thing, and shows **Preparing your first recap** only while one is running.

## Services to extend

`apps/web/src/Home.tsx` and `HomeGroups.tsx` for what leaves Home, `packages/shared/src/hostInbox.ts` for order and tabs, `packages/shared/src/operator.ts` for actions, `apps/web/src/inbox/`, `apps/mobile/src/app/(tabs)/inbox/`.

## Acceptance

- Home shows the start box and one line, with no thread lists, and the line opens Inbox on the Brief.
- With two approvals, a failed thread and five finished threads, the first screen shows all three that need the person in priority order, on desktop and phone, with no model call.
- A failed thread raises the Inbox badge, and retrying it lowers the badge.
- **Retry** on a failed row continues that thread on its own host, and the row leaves when it runs.
- With recaps off, the Brief is complete.
- A viewer sees the rows without action buttons.
- Representative task: back after a night away, clear a failure and two questions without opening a thread.

Tests: shared order and row tests, web and mobile render tests. Desktop changes run `pnpm build` then `pnpm test:desktop-smoke`.
