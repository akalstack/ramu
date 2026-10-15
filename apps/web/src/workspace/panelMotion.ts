export type PanelMotionScope = 'tools' | 'workspace' | 'terminal' | 'editor' | 'sidebar' | 'right' | 'chat'

/**
 * Panes animate themselves now (see paneMotion.tsx): their own size eases, live, as in the Codex app. This used to snapshot the
 * outgoing panel with a View Transition and slide it, which froze the page and fought any animation of the pane itself.
 * Callers still name a scope, so one pane can be given its own treatment later, but every change applies at once.
 */
export function animatePanelChange(
  update: () => void,
  _scope: PanelMotionScope,
  _entering: boolean | (() => boolean) = false,
  _captureIncoming = false,
) {
  update()
}

/** A divider takes ownership of layout; nothing is in flight any more, so there is nothing to finish. */
export function cancelPanelMotion() {}

/** App preference adds to the OS preference; it never overrides accessibility settings. */
export function reducedMotion(): boolean {
  return (
    document.documentElement.hasAttribute('data-reduce-motion') ||
    matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}
