/**
 * The quiet button states every toolbar, row action and card uses. They read only theme tokens (muted text, hover fill),
 * so a theme change reaches all of them. Keep each class string whole so Tailwind can find its tokens.
 */

/** Transparent button that fills on hover and while its menu is open. */
export const GHOST_BUTTON_CLASS =
  'ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover'

/** Quiet square icon button; always give it an accessible label. */
export const GHOST_ICON_BUTTON_CLASS = `${GHOST_BUTTON_CLASS} icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)`

/** The quiet button with caption-size text, for chat toolbars and cards. */
export const GHOST_TEXT_BUTTON_CLASS = `${GHOST_BUTTON_CLASS} small text-caption`
