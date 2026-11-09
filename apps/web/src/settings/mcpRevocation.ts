export type Revocation = 'none' | 'revoked' | 'unsupported' | 'failed'

/**
 * What to tell the person after Disconnect: whether the service was also asked to revoke the tokens it issued, so a
 * deleted copy is never mistaken for a revoked token. Nothing to say when nothing was signed in.
 */
export function revocationNotice(result: Revocation | undefined): string | null {
  switch (result) {
    case 'revoked':
      return 'Disconnected. The service was also asked to revoke Ramu’s sign-in.'
    case 'unsupported':
      return 'Disconnected from Ramu. This service can’t revoke sign-ins, so it stays valid there until it expires. To end it now, revoke it in the service’s settings.'
    case 'failed':
      return 'Disconnected from Ramu, but the service could not be asked to revoke the sign-in. To end it now, revoke it in the service’s settings.'
    default:
      return null
  }
}
