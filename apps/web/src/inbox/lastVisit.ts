const VISIT_KEY = 'ramu.last-visit'

// "Since your last visit" means since you last left Ramu, so the time moves when the window is hidden or closed, not
// when Home or the Inbox next mounts.
const mark = () => localStorage.setItem(VISIT_KEY, String(Date.now()))
window.addEventListener('pagehide', mark)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') mark()
})

/** When the person last left Ramu on this device, or 0 when they never have. */
export const lastVisit = () => Number(localStorage.getItem(VISIT_KEY) ?? 0)
