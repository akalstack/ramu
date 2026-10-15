// A pairing link opened from outside the app waits here until the Remote access screen is showing.
let pending: string | null = null
const EVENT = 'ramu:pair-link'

export function offerPairLink(link: string) { pending = link; window.dispatchEvent(new Event(EVENT)) }
export function takePairLink(): string | null { const link = pending; pending = null; return link }
export function onPairLink(listener: () => void) { window.addEventListener(EVENT, listener); return () => window.removeEventListener(EVENT, listener) }
