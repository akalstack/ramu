import { providerName, type ProviderStatus } from './providers'

export type CompatibilityAction = 'update' | 'update-ramu' | 'check-again' | 'change-path'

export interface CompatibilityPlan {
  actions: CompatibilityAction[]
  /** The newer release is also known to be incompatible, so no one-click update is offered. */
  manualInstall: boolean
}

/**
 * The next useful action for a runtime the host's policy says Ramu cannot use. Every other runtime, including one with
 * limited support or no rule yet, stays quiet because it still works; a bundled
 * SDK is fixed by updating Ramu, an installed CLI by updating it (only to a target the same policy accepts) or by
 * pointing Ramu at another executable. Check again is always available once something is flagged.
 */
export function compatibilityPlan(
  status: ProviderStatus | undefined,
  { customBinary, canUpdate }: { customBinary: boolean; canUpdate: boolean },
): CompatibilityPlan {
  const compatibility = status?.compatibility
  if (!status?.installed || compatibility?.status !== 'incompatible') return { actions: [], manualInstall: false }
  const actions: CompatibilityAction[] = []
  let manualInstall = false
  if (compatibility.runtime === 'sdk') actions.push('update-ramu')
  else {
    const targetBlocked = status.updateCompatibility?.status === 'incompatible'
    if (status.updateAvailable && !customBinary && canUpdate) {
      if (targetBlocked) manualInstall = true
      else actions.push('update')
    } else if (!customBinary) manualInstall = true
    actions.push('change-path')
  }
  actions.push('check-again')
  return { actions, manualInstall }
}

/**
 * What is wrong with a runtime Ramu cannot use, and what to do, as one paragraph; null for every runtime that works.
 * `t` translates an English copy key, so the desktop and the phone word it the same way.
 */
export function incompatibleText(
  status: ProviderStatus,
  plan: CompatibilityPlan,
  t: (key: string, values?: Record<string, string>) => string,
): string | null {
  const result = status.compatibility
  if (result?.status !== 'incompatible') return null
  const name = providerName(status.provider)
  return [
    result.observedVersion
      ? t('{0} {1} does not work with this Ramu release.', { '0': name, '1': result.observedVersion })
      : t('This {0} version does not work with this Ramu release.', { '0': name }),
    result.affects?.length ? `${result.affects.join(', ')}.` : '',
    result.recommend ? t('Use {0}.', { '0': result.recommend }) : '',
    plan.manualInstall ? t('Install a compatible version yourself, then check again.') : '',
  ]
    .filter(Boolean)
    .join(' ')
}
