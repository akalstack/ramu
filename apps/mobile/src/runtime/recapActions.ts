import type { RecapItem } from '@ramu/shared/types'
import { DEFAULT_SNOOZE_MS, snoozeUntil, type SnoozeChoice } from '@ramu/shared/snooze'
// What happens to a recap item when you act on it: the call to the host, the optimistic change on the phone, and the
// words for the Undo toast. No React Native in here, so it is unit tested.

export type RecapAction = 'open' | 'done' | 'dismissed' | 'snoozed'

/** Copy keys in `i18n.ts` for the toast that follows an action ("Marked done", "Dismissed", "Snoozed"). Undoing says nothing. */
export const RECAP_TOAST: Record<Exclude<RecapAction, 'open'>, 'recapDone' | 'recapDismissed' | 'recapSnoozed'> = {
  done: 'recapDone',
  dismissed: 'recapDismissed',
  snoozed: 'recapSnoozed',
}

/** The snooze menu: copy key and the moment each choice ends, the same three as on the desktop. */
export const SNOOZE_MENU: { choice: SnoozeChoice; label: 'snooze3h' | 'snoozeTomorrow' | 'snoozeNextWeek' }[] = [
  { choice: 'in-3-hours', label: 'snooze3h' },
  { choice: 'tomorrow', label: 'snoozeTomorrow' },
  { choice: 'next-week', label: 'snoozeNextWeek' },
]
export const snoozeEnds = (choice: SnoozeChoice, now = Date.now()) => snoozeUntil(choice, now)

/** The recap list with `action` applied, so the card goes (or comes back) at once; the host confirms it afterwards. */
export function applyRecapAction(
  items: readonly RecapItem[],
  id: string,
  action: RecapAction,
  until: number | undefined,
  now = Date.now(),
): RecapItem[] {
  return items.map((item) =>
    item.id === id
      ? {
          ...item,
          status: action,
          snoozedUntil: action === 'snoozed' ? (until ?? now + DEFAULT_SNOOZE_MS) : null,
        }
      : item,
  )
}

/** Sends the action to the host; a snooze with a chosen time passes it as the third argument. */
export async function actOnHost(
  call: (...args: unknown[]) => Promise<unknown>,
  id: string,
  action: RecapAction,
  until?: number,
): Promise<void> {
  await (action === 'snoozed' && until !== undefined ? call(id, action, until) : call(id, action))
}
