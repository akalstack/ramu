// The Azure DevOps personal access token a host uses, with the organization Settings browses repositories in.
// Saved in the host credential store; ordinary state keeps only a reference and the organization.
import { HostCredentialStore } from '../../credentials/store'
import { SavedCredential } from './savedCredential'

export interface AzureCredential {
  token: string
  /** Where repositories are browsed and created; a checkout's own remote names its organization. */
  organization?: string
}

export class AzureCredentials extends SavedCredential<AzureCredential> {
  constructor(
    getState: ConstructorParameters<typeof SavedCredential>[1],
    setState: ConstructorParameters<typeof SavedCredential>[2],
    credentials = new HostCredentialStore(),
  ) {
    super({ key: 'azure-credential', connectionId: 'azure', shown: 'organization' }, getState, setState, credentials)
  }

  saved(): { organization: string | null } | null {
    const saved = this.savedField()
    return saved ? { organization: saved.shown } : null
  }
}

let store: AzureCredentials | null = null

export function configureAzureCredentials(value: AzureCredentials | null): void {
  store = value
}

/** The token to use: the one saved in Settings, else `AZURE_DEVOPS_EXT_PAT` (the Azure CLI's) with `AZURE_DEVOPS_ORG`. */
export async function azureCredential(
  env: NodeJS.ProcessEnv = process.env,
): Promise<(AzureCredential & { source: 'saved' | 'environment' }) | null> {
  const saved = await store?.read().catch(() => null)
  if (saved) return { ...saved, source: 'saved' }
  if (env.AZURE_DEVOPS_EXT_PAT)
    return {
      token: env.AZURE_DEVOPS_EXT_PAT,
      ...(env.AZURE_DEVOPS_ORG ? { organization: env.AZURE_DEVOPS_ORG } : {}),
      source: 'environment',
    }
  return null
}
