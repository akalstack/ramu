// A GitLab token saved in Settings for one server, for hosts without `glab`. Saved in the host credential store;
// ordinary state keeps only a reference and the server's origin.
import { HostCredentialStore } from '../../credentials/store'
import { SavedCredential } from './savedCredential'

export interface GitlabCredential {
  /** `gitlab.com` or a self-managed server, as `host[:port]`. */
  origin: string
  token: string
}

export class GitlabCredentials extends SavedCredential<GitlabCredential> {
  constructor(
    getState: ConstructorParameters<typeof SavedCredential>[1],
    setState: ConstructorParameters<typeof SavedCredential>[2],
    credentials = new HostCredentialStore(),
  ) {
    super({ key: 'gitlab-credential', connectionId: 'gitlab', shown: 'origin' }, getState, setState, credentials)
  }
}

let store: GitlabCredentials | null = null

export function configureGitlabCredentials(value: GitlabCredentials | null): void {
  store = value
}

/** The token saved in Settings, if any. */
export async function savedGitlabCredential(): Promise<GitlabCredential | null> {
  return (await store?.read().catch(() => null)) ?? null
}
