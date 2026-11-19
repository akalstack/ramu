// The person's own API key for each media service on this host. The key lives in the host credential store; ordinary
// state keeps only a reference and the name Settings → Providers shows.
import { MEDIA_SERVICES, type MediaAccount, type MediaService } from '@ramu/shared/types/media'
import { HostCredentialStore } from '../credentials/store'
import { SavedCredential } from '../workspace/forge/savedCredential'
import { mediaConnector, type MediaAuth, type MediaConnector } from './mediaServices'

interface SavedKey {
  token: string
  label: string
}

type State = ConstructorParameters<typeof SavedCredential>[1]
type SetState = ConstructorParameters<typeof SavedCredential>[2]

export class MediaAccounts {
  private readonly saved: Record<MediaService, SavedCredential<SavedKey>>
  private readonly errors = new Map<MediaService, string>()

  constructor(
    getState: State,
    setState: SetState,
    credentials = new HostCredentialStore(),
    private readonly connector: (
      service: MediaService,
    ) => Pick<MediaConnector, 'name' | 'tokenPage' | 'account'> = mediaConnector,
  ) {
    const saved = (service: MediaService) =>
      new SavedCredential<SavedKey>(
        { key: `media-${service}`, connectionId: `media-${service}`, shown: 'label' },
        getState,
        setState,
        credentials,
      )
    this.saved = { gemini: saved('gemini'), elevenlabs: saved('elevenlabs') }
  }

  /** Every service's key; `check` asks each service whether its saved key still works. */
  async list(check: boolean): Promise<MediaAccount[]> {
    return Promise.all(
      MEDIA_SERVICES.map(async (service) => {
        if (check && this.connected(service))
          await this.auth(service)
            .then((auth) => this.connector(service).account(auth))
            .then(
              () => this.errors.delete(service),
              (error: unknown) => this.errors.set(service, error instanceof Error ? error.message : String(error)),
            )
        return this.describe(service)
      }),
    )
  }

  /** Whether a key is saved, without reading it. */
  connected(service: MediaService): boolean {
    return !!this.saved[service].savedField()
  }

  private describe(service: MediaService): MediaAccount {
    const connector = this.connector(service)
    const shown = this.saved[service].savedField()
    return {
      service,
      name: connector.name,
      connected: !!shown,
      account: shown?.shown ?? null,
      error: shown ? (this.errors.get(service) ?? null) : null,
      tokenPage: connector.tokenPage,
    }
  }

  /** Checks a key with the service, then keeps it. A refused key never replaces a working one. */
  async save(service: MediaService, token: string): Promise<MediaAccount> {
    const { name } = await this.connector(service).account({ token })
    await this.saved[service].save({ token, label: name })
    this.errors.delete(service)
    return this.describe(service)
  }

  async disconnect(service: MediaService): Promise<void> {
    this.errors.delete(service)
    await this.saved[service].remove()
  }

  /** The key a call runs with. */
  async auth(service: MediaService): Promise<MediaAuth> {
    const value = await this.saved[service].read()
    if (!value) throw new Error(`Save a ${this.connector(service).name} API key in Settings → Providers first.`)
    return { token: value.token }
  }
}
