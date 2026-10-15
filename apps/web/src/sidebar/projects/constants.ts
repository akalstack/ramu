import type { Task } from '@ramu/shared/types'

/** Pinned chats lead their list (most recently pinned first); the rest follow by recent activity. */
export const pinnedFirst = (a: Task, b: Task) =>
  (a.pinnedAt ? 1 : 0) !== (b.pinnedAt ? 1 : 0)
    ? (b.pinnedAt ? 1 : 0) - (a.pinnedAt ? 1 : 0)
    : a.pinnedAt && b.pinnedAt
      ? b.pinnedAt - a.pinnedAt
      : b.lastActiveAt - a.lastActiveAt

/** Shared look of the small ghost icon buttons in section heads and rows. */
export const ICON_BUTTON_CLASS =
  'ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)'

/** Shared look of the inline error line under a row. */
export const ROW_ERROR_CLASS = 'error text-bad small text-caption row-error p-[1px_10px_2px_26px]'

/** Shared look of the hover-revealed action group at the end of a row. */
export const ROW_ACTIONS_CLASS =
  "row-actions [&:has([aria-expanded='true'])]:opacity-100 flex items-center gap-0.5 opacity-0 [transition:opacity_0.1s] flex-none"
