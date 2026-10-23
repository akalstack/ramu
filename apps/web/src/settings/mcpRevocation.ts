export type Revocation = 'none' | 'revoked' | 'unsupported' | 'failed'

/**
 * What to tell the person after Disconnect: whether the service was also asked to revoke the tokens it issued, so a
 * deleted copy is never mistaken for a revoked token. Nothing to say when nothing was signed in.
 */
export function revocationNotice(result: Revocation | undefined): string | null {
  switch (result) {
    case 'revoked':
      return 'Disconnected. The service was also told to revoke the sign-in Ramu held.'
    case 'unsupported':
      return 'Disconnected from Ramu. This service has no way to revoke a sign-in, so it stays valid there until it expires. Revoke it in the service’s own settings if you need it ended now.'
    case 'failed':
      return 'Disconnected from Ramu, but the service could not be asked to revoke the sign-in. Revoke it in the service’s own settings if you need it ended now.'
    default:
      return null
  }
}
