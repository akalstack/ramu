// Pure rules for pairing a phone: what a scanned code leads to, how a failure reads, and when the welcome screen shows.
// No React Native imports, so Node tests cover them.
import { parsePairInput, type PairInput } from '@ramu/contracts'

/** The phone's choice to look around before pairing, kept in its drafts so the welcome screen stays away. */
export const WELCOME_DISMISSED = 'welcome-dismissed'

/**
 * Whether launching shows the welcome screen: only on a phone with no host, that has not chosen to look around first,
 * opening on the home list. A link into another screen (such as `ramu://pair`) opens that screen instead.
 */
export const showWelcome = (input: { hosts: number; dismissed: boolean; path: string }) =>
  input.hosts === 0 && !input.dismissed && input.path === '/'

export type ScanResult =
  | { kind: 'pair'; offer: PairInput & { code: string } }
  | { kind: 'review'; offer: PairInput }
  | { kind: 'expired' }
  | { kind: 'invalid' }

/**
 * What a scanned QR code leads to. A code with an encrypted address pairs at once; one that needs a decision (plain
 * HTTP to allow, or no code) opens the form to review. Reads the getramu.dev/pair link, `ramu://pair` and older codes.
 */
export function readScan(data: string, needsConsent: (url: string) => boolean, now = Date.now()): ScanResult {
  let offer: PairInput
  try {
    offer = parsePairInput(data, now)
  } catch (error) {
    return error instanceof Error && /expired/i.test(error.message) ? { kind: 'expired' } : { kind: 'invalid' }
  }
  if (offer.code && !needsConsent(offer.url)) return { kind: 'pair', offer: { ...offer, code: offer.code } }
  return { kind: 'review', offer }
}

export type PairProblem =
  { kind: 'expired' | 'too-many' | 'unreachable' | 'invalid' } | { kind: 'other'; detail?: string }

/** A pairing failure as something a person can act on, without a status code or a transport error. */
export function pairProblem(error: unknown): PairProblem {
  const message = error instanceof Error ? error.message : String(error ?? '')
  const name = error instanceof Error ? error.name : ''
  if (/too many/i.test(message)) return { kind: 'too-many' }
  if (/wrong, already used or expired|expired|already used/i.test(message)) return { kind: 'expired' }
  if (
    name === 'AbortError' ||
    name === 'TimeoutError' ||
    /network request failed|failed to fetch|timed? ?out|aborted|could not connect|unreachable|ECONN|ENOTFOUND/i.test(
      message,
    )
  )
    return { kind: 'unreachable' }
  // A bare status ("Pairing failed (403)") tells a person nothing; the host's own sentence does.
  if (!message || /^Pairing failed \(\d+\)$/.test(message)) return { kind: 'other' }
  return { kind: 'other', detail: message }
}

/** The name a newly paired host shows before it reports its own: the name the link carried, or its address. */
export function pairedName(offer: { url: string; name?: string }): string {
  if (offer.name) return offer.name
  try {
    return new URL(offer.url).hostname
  } catch {
    return offer.url
  }
}
