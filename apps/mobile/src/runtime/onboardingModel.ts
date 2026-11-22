// Pure rules for the phone's first run: the steps, where a reopened app resumes, and what the Connected step offers for
// reaching the computer from anywhere. No React Native imports, so Node tests cover them.
import { routeName } from '@ramu/shared/networkLabel'
import { isLinkAddress, recommendRoutes, type LinkPool, type LinkStatus, type RouteKind } from '@ramu/shared/ramuLink'

export const ONBOARDING_STEPS = ['welcome', 'connect', 'connected', 'notifications', 'done'] as const
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number]

/** The step the phone was on, kept in its drafts so a reopened app resumes there; empty once finished or skipped. */
export const ONBOARDING_STEP = 'onboarding-step'

const PAIRED_STEPS: readonly OnboardingStep[] = ['connected', 'notifications', 'done']

/**
 * Where the onboarding opens: the saved step, moved back to Connect when no host is paired yet, and on to Connected
 * once one is (a host can arrive through the account or a link while the app was closed).
 */
export function resumeStep(saved: string | undefined, hosts: number): OnboardingStep {
  const step = (ONBOARDING_STEPS as readonly string[]).includes(saved ?? '') ? (saved as OnboardingStep) : 'welcome'
  if (hosts === 0) return PAIRED_STEPS.includes(step) ? 'connect' : step
  return PAIRED_STEPS.includes(step) ? step : 'connected'
}

/** Whether a reopened app returns to an onboarding left part way, after the phone was paired. */
export const resumesOnboarding = (saved: string | undefined, hosts: number) =>
  hosts > 0 && PAIRED_STEPS.includes(saved as OnboardingStep) && saved !== 'done'

export const nextStep = (step: OnboardingStep): OnboardingStep | null =>
  ONBOARDING_STEPS[ONBOARDING_STEPS.indexOf(step) + 1] ?? null

/** The step back goes to; Connected never returns to Connect, since the phone is already paired. */
export function previousStep(step: OnboardingStep): OnboardingStep | null {
  if (step === 'connected') return null
  return ONBOARDING_STEPS[ONBOARDING_STEPS.indexOf(step) - 1] ?? null
}

/** How the phone reaches the host now, for "Connected through …". */
export function connectedRoute(address: string): 'link' | 'LAN' | 'VPN' | 'Internet' | null {
  try {
    if (isLinkAddress(new URL(address).hostname)) return 'link'
  } catch {
    // An address that does not parse is named by routeName's own fallback.
  }
  const name = routeName(address)
  // Without an SSH target routeName never says SSH; the guard keeps the type to what a phone can be connected through.
  return name === 'SSH' ? null : name
}

/** What the Connected step offers for reaching the computer away from home. */
export type ReachPlan =
  | { kind: 'reachable' } // already through Ramu Link or another address that answers from anywhere
  | { kind: 'link-active'; hostname: string | null }
  | { kind: 'offer-link' } // a slot is free: one tap asks the computer to turn Ramu Link on
  | { kind: 'full'; alternative: RouteKind | null } // waitlisted, with the best other way to set up on the computer
  | { kind: 'blocked'; reason: 'suspended' | 'taken' | 'unavailable'; alternative: RouteKind | null }
  | { kind: 'on-computer' } // the computer did not say; set it up there

type HostTunnel = {
  link?: Pick<LinkStatus, 'state' | 'hostname'> | null
  pool?: LinkPool | null
  tools: Record<'cloudflared' | 'tailscale' | 'ngrok', boolean>
}

/**
 * Chooses the Connected step's offer from how the phone reaches the host and what the host reports about its tunnel.
 * A host that does not report it (an older host, or one that keeps network settings to itself) is set up there.
 */
export function reachPlan(address: string, tunnel: HostTunnel | null | undefined, signedIn: boolean): ReachPlan {
  const route = connectedRoute(address)
  if (route === 'link' || route === 'Internet') return { kind: 'reachable' }
  if (!tunnel) return { kind: 'on-computer' }
  const state = tunnel.link?.state
  if (state === 'active') return { kind: 'link-active', hostname: tunnel.link?.hostname ?? null }
  const options = recommendRoutes({
    link: tunnel.link ?? null,
    pool: tunnel.pool ?? null,
    signedIn,
    tools: tunnel.tools,
  })
  const first = options[0]?.kind ?? null
  if (first === 'link') return { kind: 'offer-link' }
  const alternative = options.find((option) => option.kind !== 'link')?.kind ?? null
  if (state === 'suspended' || state === 'taken' || state === 'unavailable')
    return { kind: 'blocked', reason: state, alternative }
  return { kind: 'full', alternative }
}

/** The guidance key for setting up another route on the computer, which the screen translates. */
export const ALTERNATIVE_COPY: Record<
  RouteKind,
  'tailscale' | 'ownRelay' | 'quick' | 'ngrok' | 'installTailscale' | 'link'
> = {
  link: 'link',
  tailscale: 'tailscale',
  'own-relay': 'ownRelay',
  quick: 'quick',
  ngrok: 'ngrok',
  'install-tailscale': 'installTailscale',
}
