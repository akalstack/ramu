/** A tab in the integrated browser, as the workspace shows it. */
export interface BrowserTabInfo {
  id: string
  hostId: string
  threadId: string
  runId: string | null
  profileId: string
  url: string
  title: string
  /** Who may drive the page now. The agent acts only after the person releases it. */
  controller: 'human' | 'agent' | 'none'
  generation: number
  crashed: boolean
}
