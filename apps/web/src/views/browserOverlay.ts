type Box = { left: number; top: number; right: number; bottom: number }
export interface Overlay {
  /** A modal dialog dims the whole window, so it hides the page wherever it sits. */
  modal: boolean
  box: Box
}

// Tooltips are left out: they come and go with the pointer and would make the page blink off and on as it moves.
const OVERLAYS = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]'

/**
 * The page is a native view drawn above the app, so any dialog, menu or popover that reaches into the pane would
 * be hidden behind it. The pane takes the page off screen while one is open.
 */
export function paneCovered(pane: Box, overlays: readonly Overlay[]): boolean {
  return overlays.some(
    ({ modal, box }) =>
      box.right > box.left &&
      box.bottom > box.top &&
      (modal || (box.left < pane.right && box.right > pane.left && box.top < pane.bottom && box.bottom > pane.top)),
  )
}

/** Open overlays outside the pane itself; the pane's own controls never hide its page. */
export function openOverlays(document: Document, pane: Element): Overlay[] {
  return [...document.querySelectorAll(OVERLAYS)]
    .filter((element) => !pane.contains(element) && !closing(element))
    .map((element) => ({
      modal: element.getAttribute('aria-modal') === 'true',
      box: element.getBoundingClientRect(),
    }))
}

/** A popup that is animating out, or hidden but still mounted, no longer covers anything. */
const closing = (element: Element) =>
  element.hasAttribute('data-ending-style') ||
  element.hasAttribute('data-closed') ||
  element.closest('[hidden], [aria-hidden="true"], [inert]') !== null
