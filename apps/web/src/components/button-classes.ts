/**
 * The quiet button states every toolbar, row action and card uses. They read only theme tokens (muted text, hover fill),
 * so a theme change reaches all of them. Keep each class string whole so Tailwind can find its tokens.
 */

/** Transparent button that fills on hover and while its menu is open. */
export const GHOST_BUTTON_CLASS =
  'ghost bg-transparent border-transparent text-muted-foreground hover:bg-fill-hover hover:text-foreground aria-expanded:bg-fill-hover'

/** Quiet square icon button; always give it an accessible label. */
export const GHOST_ICON_BUTTON_CLASS = `${GHOST_BUTTON_CLASS} icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)`

/** The quiet button with caption-size text, for chat toolbars and cards. */
export const GHOST_TEXT_BUTTON_CLASS = `${GHOST_BUTTON_CLASS} small text-caption`

/** The filled destructive action (Delete, Discard): the error color, darkened so white text reads on any theme. */
export const DANGER_ACTION_CLASS =
  'bg-[color-mix(in_srgb,var(--bad),black_30%)] hover:bg-[color-mix(in_srgb,var(--bad),black_18%)] text-(--bad-ink) border-transparent font-semibold'

/** The filled primary action (Save, Send, Confirm); it dims to a quiet raised fill when disabled. */
export const PRIMARY_ACTION_CLASS =
  'primary bg-primary text-primary-foreground border-transparent font-semibold justify-center hover:bg-primary-hover hover:text-primary-foreground aria-expanded:bg-primary-hover aria-expanded:text-primary-foreground disabled:bg-raised disabled:text-muted-foreground disabled:opacity-100'
