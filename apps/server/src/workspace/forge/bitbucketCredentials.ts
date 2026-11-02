// The Bitbucket Cloud credential a host uses: an Atlassian API token with its account email, or a workspace,
// project or repository access token. Saved in the host credential store; ordinary state keeps only a reference.
import { randomUUID } from 'node:crypto'
import { HostCredentialStore, type HostCredentialScope } from '../../credentials/store'

export interface BitbucketCredential {
  /** Present for an API token (Basic auth); absent for an access token (Bearer). */
  email?: string
  token: string
}

interface Index {
  hostId: string
  reference?: string
  email?: string
}

const STATE_KEY = 'bitbucket-credential'

export class BitbucketCredentials {
  private cached?: BitbucketCredential | null
  constructor(
    private readonly getState: (key: string, fallback: Index | null) => Index | null,
    private readonly setState: (key: string, value: Index) => void,
    private readonly credentials = new HostCredentialStore(),
  ) {}

  private index(): Index {
    const index = this.getState(STATE_KEY, null)
    if (index?.hostId) return index
    const created = { hostId: randomUUID() }
    this.setState(STATE_KEY, created)
    return created
  }

  private scope(index: Index): HostCredentialScope {
    return { hostId: index.hostId, integration: 'forge', connectionId: 'bitbucket', accountId: 'host' }
  }

  /** Whether one is saved, without reading the secret. */
  saved(): { email: string | null } | null {
    const index = this.index()
    return index.reference ? { email: index.email ?? null } : null
  }

  async read(): Promise<BitbucketCredential | null> {
    if (this.cached !== undefined) return this.cached
    const index = this.index()
    if (!index.reference) return (this.cached = null)
    const value = JSON.parse(await this.credentials.read(this.scope(index), index.reference)) as BitbucketCredential
    return (this.cached = value)
  }

  async save(value: BitbucketCredential): Promise<void> {
    const index = this.index()
    const reference = await this.credentials.put(this.scope(index), JSON.stringify(value))
    this.setState(STATE_KEY, { hostId: index.hostId, reference, ...(value.email ? { email: value.email } : {}) })
    this.cached = value
    if (index.reference) await this.credentials.remove(this.scope(index), index.reference).catch(() => {})
  }

  async remove(): Promise<void> {
    const index = this.index()
    this.setState(STATE_KEY, { hostId: index.hostId })
    this.cached = null
    if (index.reference) await this.credentials.remove(this.scope(index), index.reference).catch(() => {})
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
