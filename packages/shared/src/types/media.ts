// Media services an ability can run on with the person's own API key, billed to that account: video, speech, music
// and sound effects that no signed-in coding agent makes. Their keys are saved under Media in Settings → Providers.

export const MEDIA_SERVICES = ['gemini', 'elevenlabs'] as const
export type MediaService = (typeof MEDIA_SERVICES)[number]
export const MEDIA_SERVICE_NAMES: Record<MediaService, string> = {
  gemini: 'Google Gemini',
  elevenlabs: 'ElevenLabs',
}
export const isMediaService = (value: unknown): value is MediaService =>
  typeof value === 'string' && (MEDIA_SERVICES as readonly string[]).includes(value)

/** One media service's key on this host. The key never leaves the host. */
export interface MediaAccount {
  service: MediaService
  /** The service's name, such as "ElevenLabs". */
  name: string
  connected: boolean
  /** The account name the service reports for the saved key. */
  account: string | null
  /** Why the last check failed, in plain words. */
  error: string | null
  /** The service's page for creating a key. */
  tokenPage: string
}

export interface MediaAccountsSummary {
  accounts: MediaAccount[]
  /** False on a paired device that is not the host: keys change only on the host itself. */
  canAdminister: boolean
}
