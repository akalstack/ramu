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

/** A key a signed-in provider already holds for the same service, and that provider's name. */
export interface SharedMediaKey {
  token: string
  from: string
}

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
    /** Antigravity signed in with a Gemini API key lends it to Gemini, so the same key is never asked for twice. */
    private readonly shared: (service: MediaService) => SharedMediaKey | null = () => null,
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

  /** Whether a key is saved here or lent by a signed-in provider, without reading a saved one. */
  connected(service: MediaService): boolean {
    return !!this.saved[service].savedField() || !!this.shared(service)
  }

  private describe(service: MediaService): MediaAccount {
    const connector = this.connector(service)
    const shown = this.saved[service].savedField()
    const lent = shown ? null : this.shared(service)
    return {
      service,
      name: connector.name,
      connected: !!shown || !!lent,
      account: shown?.shown ?? null,
      sharedFrom: lent?.from ?? null,
      error: shown || lent ? (this.errors.get(service) ?? null) : null,
      tokenPage: connector.tokenPage,
    }
  }

  /** The key saved under Media itself, for a provider signing in with the same service's key. */
  async savedKey(service: MediaService): Promise<string | null> {
    return (await this.saved[service].read())?.token ?? null
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

  /** The key a call runs with: the one saved under Media, else the one a signed-in provider lends. */
  async auth(service: MediaService): Promise<MediaAuth> {
    const value = (await this.saved[service].read()) ?? this.shared(service)
    if (!value) throw new Error(`Save a ${this.connector(service).name} API key in Settings → Providers first.`)
    return { token: value.token }
  }
}
