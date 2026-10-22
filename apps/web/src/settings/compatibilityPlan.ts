import type { ProviderStatus } from '@ramu/shared/providers/providers'

export type CompatibilityAction = 'update' | 'update-ramu' | 'check-again' | 'change-path'

export interface CompatibilityPlan {
  actions: CompatibilityAction[]
  /** The newer release is also known to be incompatible, so no one-click update is offered. */
  manualInstall: boolean
}

/**
 * The next useful action for a runtime the host's policy flags. Unverified and supported runtimes stay quiet; a bundled
 * SDK is fixed by updating Ramu, an installed CLI by updating it (only to a target the same policy accepts) or by
 * pointing Ramu at another executable. Check again is always available once something is flagged.
 */
export function compatibilityPlan(
  status: ProviderStatus | undefined,
  { customBinary, canUpdate }: { customBinary: boolean; canUpdate: boolean },
): CompatibilityPlan {
  const compatibility = status?.compatibility
  if (
    !status?.installed ||
    !compatibility ||
    compatibility.status === 'supported' ||
    compatibility.status === 'unverified'
  )
    return { actions: [], manualInstall: false }
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
