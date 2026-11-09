/** An artifact and the host it is kept on. */
export interface PageTarget {
  id: string
  host: string
}

let pending: PageTarget | null = null

/** The page to open when the Artifacts view mounts, for a card or notification that opened it before the switch. */
export const takePendingPage = () => {
  const target = pending
  pending = null
  return target
}

/**
 * Opens a page from anywhere: a thread card, a notification or the command palette. The app switches to Artifacts,
 * which lists every host's pages and opens this one from `host`.
 */
export function openPage(artifactId: string, host: string) {
  pending = { id: artifactId, host }
  window.dispatchEvent(new CustomEvent<PageTarget>('ramu:open-page', { detail: pending }))
}
