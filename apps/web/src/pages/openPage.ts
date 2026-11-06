let pending: string | null = null

/** The page to open when the Artifacts view mounts, for a card or notification that opened it before the switch. */
export const takePendingPage = () => {
  const id = pending
  pending = null
  return id
}

/** Opens a page from anywhere: a thread card, a notification or the command palette. The app switches to Artifacts. */
export function openPage(pageId: string) {
  pending = pageId
  window.dispatchEvent(new CustomEvent('ramu:open-page', { detail: { id: pageId } }))
}
