// The Bitbucket Cloud credential a host uses: an Atlassian API token with its account email, or a workspace,
// project or repository access token. Saved in the host credential store; ordinary state keeps only a reference.
import { HostCredentialStore } from '../../credentials/store'
import { SavedCredential } from './savedCredential'

export interface BitbucketCredential {
  /** Present for an API token (Basic auth); absent for an access token (Bearer). */
  email?: string
  token: string
}

export class BitbucketCredentials extends SavedCredential<BitbucketCredential> {
  constructor(
    getState: ConstructorParameters<typeof SavedCredential>[1],
    setState: ConstructorParameters<typeof SavedCredential>[2],
    credentials = new HostCredentialStore(),
  ) {
    super({ key: 'bitbucket-credential', connectionId: 'bitbucket', shown: 'email' }, getState, setState, credentials)
  }

  /** Whether one is saved, without reading the secret. */
  saved(): { email: string | null } | null {
    const saved = this.savedField()
    return saved ? { email: saved.shown } : null
  }
}

let store: BitbucketCredentials | null = null

export function configureBitbucketCredentials(value: BitbucketCredentials | null): void {
  store = value
}

/** The credential to use: the one saved in Settings, else `BITBUCKET_EMAIL` with `BITBUCKET_API_TOKEN`, else
 * `BITBUCKET_ACCESS_TOKEN`. */
export async function bitbucketCredential(
  env: NodeJS.ProcessEnv = process.env,
): Promise<(BitbucketCredential & { source: 'saved' | 'environment' }) | null> {
  const saved = await store?.read().catch(() => null)
  if (saved) return { ...saved, source: 'saved' }
  if (env.BITBUCKET_EMAIL && env.BITBUCKET_API_TOKEN)
    return { email: env.BITBUCKET_EMAIL, token: env.BITBUCKET_API_TOKEN, source: 'environment' }
  if (env.BITBUCKET_ACCESS_TOKEN) return { token: env.BITBUCKET_ACCESS_TOKEN, source: 'environment' }
  return null
}
