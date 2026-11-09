// Media services an ability runs on with the person's own API key, saved in the host's credential store and billed to
// that account: Google Gemini (video with Omni Flash, speech, music with Lyria), ElevenLabs (speech, music, sound
// effects) and OpenAI (speech). Each request sends only the caller's prompt or text; the file comes back as bytes.
import type { Ability } from '@ramu/shared/providers/abilities'
import type { MediaService } from '@ramu/shared/types/deploy'
import type { HostingAuth, HostingIdentity } from '../workspace/deploy/adapter'

/** What an ability asks a media service for. `seconds` and `aspect` apply to video, music and sound effects. */
export interface MediaRequest {
  ability: Ability
  /** The description, or for speech the words to say. */
  prompt: string
  seconds?: number
  aspect?: 'landscape' | 'portrait'
}

export interface MediaFile {
  bytes: Buffer
  extension: 'mp3' | 'wav' | 'mp4'
  /** The model that made it, as the service names it. */
  model: string
}

export interface MediaConnector {
  readonly id: MediaService
  readonly name: string
  readonly tokenPage: string
  readonly kind: 'media'
  account(auth: HostingAuth): Promise<HostingIdentity>
  make(auth: HostingAuth, request: MediaRequest, signal: AbortSignal): Promise<MediaFile>
}

/** A refusal in the person's words: a bad key says where to replace it; anything else says what the service said. */
async function failure(name: string, response: Response, what: string): Promise<Error> {
  const body = (await response.text().catch(() => '')).slice(0, 2000)
  let detail = ''
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } | string; detail?: unknown; message?: unknown }
    const error = parsed.error
    const text =
      (typeof error === 'object' && typeof error?.message === 'string' && error.message) ||
      (typeof error === 'string' && error) ||
      (typeof parsed.message === 'string' && parsed.message) ||
      (typeof parsed.detail === 'object' && parsed.detail && 'message' in parsed.detail
        ? String((parsed.detail as { message: unknown }).message)
        : '')
    detail = text ? ` ${text.slice(0, 300)}` : ''
  } catch {
    // Not JSON: the status says enough.
  }
  if (response.status === 401 || response.status === 403)
    return new Error(
      `${name} refused the saved API key while ${what}. Replace it in Settings → Media.${detail}`,
    )
  if (response.status === 429 || response.status === 402)
    return new Error(`${name} is at its limit or out of credit while ${what}.${detail}`)
  return new Error(`${name} could not finish ${what} (HTTP ${response.status}).${detail}`)
}

type Fetch = typeof fetch

async function send(
  fetcher: Fetch,
  name: string,
  url: string,
  init: RequestInit,
  what: string,
  signal?: AbortSignal,
): Promise<Response> {
  const response = await fetcher(url, { ...init, ...(signal ? { signal } : {}) })
  if (!response.ok) throw await failure(name, response, what)
  return response
}

const bytesOf = async (response: Response) => Buffer.from(await response.arrayBuffer())

/** The base64 file in an Interactions API reply: the last model output part of that type. */
function interactionPart(reply: unknown, type: 'audio' | 'video'): { data?: string; uri?: string } | null {
  const steps = (reply as { steps?: { type?: string; content?: { type?: string; data?: string; uri?: string }[] }[] })
    .steps
  const parts = (steps ?? [])
    .filter((step) => step.type === 'model_output')
    .flatMap((step) => step.content ?? [])
    .filter((part) => part.type === type)
  return parts.at(-1) ?? null
}

/** Google's Gemini API through its Interactions endpoint, with the key in `x-goog-api-key`. */
export function geminiMedia(options: { api?: string; fetch?: Fetch } = {}): MediaConnector {
  const api = options.api ?? 'https://generativelanguage.googleapis.com/v1beta'
  const fetcher = options.fetch ?? fetch
  const headers = (auth: HostingAuth) => ({ 'x-goog-api-key': auth.token, 'Content-Type': 'application/json' })
  const interact = async (auth: HostingAuth, body: Record<string, unknown>, what: string, signal: AbortSignal) =>
    (await (
      await send(
        fetcher,
        'Google Gemini',
        `${api}/interactions`,
        { method: 'POST', headers: headers(auth), body: JSON.stringify(body) },
        what,
        signal,
      )
    ).json()) as unknown
  return {
    id: 'gemini',
    name: 'Google Gemini',
    tokenPage: 'https://aistudio.google.com/apikey',
    kind: 'media',
    async account(auth) {
      await send(fetcher, 'Google Gemini', `${api}/models?pageSize=1`, { headers: headers(auth) }, 'checking the key')
      return { id: 'gemini', name: 'Gemini API key', defaultScope: null, broadScope: null, expiresAt: null }
    },
    async make(auth, request, signal) {
      if (request.ability === 'speech') {
        const model = 'gemini-3.8-flash-tts'
        const reply = await interact(
          auth,
          {
            model,
            input: [{ type: 'user_input', content: [{ type: 'text', text: request.prompt }] }],
            response_format: { type: 'audio' },
            generation_config: { speech_config: [{ voice: 'Kore' }] },
          },
          'recording the narration',
          signal,
        )
        const part = interactionPart(reply, 'audio')
        if (!part?.data) throw new Error('Google Gemini returned no audio.')
        // A unary reply is a complete WAV file: 24 kHz mono 16-bit PCM.
        return { bytes: Buffer.from(part.data, 'base64'), extension: 'wav', model }
      }
      if (request.ability === 'music') {
        // The clip model makes 30 seconds; the full model takes its length from the prompt.
        const short = (request.seconds ?? 30) <= 30
        const model = short ? 'lyria-3-clip-preview' : 'lyria-3.5'
        const input = short ? request.prompt : `${request.prompt}. About ${request.seconds} seconds long.`
        const reply = await interact(auth, { model, input }, 'making the music', signal)
        const part = interactionPart(reply, 'audio')
        if (!part?.data) throw new Error('Google Gemini returned no music.')
        return { bytes: Buffer.from(part.data, 'base64'), extension: 'mp3', model }
      }
      if (request.ability === 'video_generation') {
        const model = 'gemini-omni-1.2-flash'
        const seconds = Math.min(15, Math.max(3, Math.round(request.seconds ?? 8)))
        const reply = await interact(
          auth,
          {
            model,
            input: request.prompt,
            response_format: {
              type: 'video',
              aspect_ratio: request.aspect === 'portrait' ? '9:16' : '16:9',
              resolution: '720p',
              duration: `${seconds}s`,
            },
          },
          'making the video',
          signal,
        )
        const part = interactionPart(reply, 'video')
        if (part?.data) return { bytes: Buffer.from(part.data, 'base64'), extension: 'mp4', model }
        if (part?.uri) {
          const url = /^https:\/\//.test(part.uri)
            ? part.uri
            : `${api}/${part.uri.replace(/^\/+/, '')}:download?alt=media`
          if (!url.startsWith('https://generativelanguage.googleapis.com/') && !url.startsWith(api))
            throw new Error('Google Gemini returned a video address Ramu does not download from.')
          const response = await send(
            fetcher,
            'Google Gemini',
            url,
            { headers: { 'x-goog-api-key': auth.token } },
            'downloading the video',
            signal,
          )
          return { bytes: await bytesOf(response), extension: 'mp4', model }
        }
        throw new Error('Google Gemini returned no video.')
      }
      throw new Error(`Google Gemini does not make ${request.ability} here.`)
    },
  }
}

/** A premade ElevenLabs voice every account has. */
const ELEVENLABS_VOICE = 'JBFqnCBsd6RMkjVDRZzb'

/** ElevenLabs with the key in `xi-api-key`; its audio endpoints answer with the file itself. */
export function elevenLabsMedia(options: { api?: string; fetch?: Fetch } = {}): MediaConnector {
  const api = options.api ?? 'https://api.elevenlabs.io/v1'
  const fetcher = options.fetch ?? fetch
  const headers = (auth: HostingAuth) => ({ 'xi-api-key': auth.token, 'Content-Type': 'application/json' })
  const audio = async (
    auth: HostingAuth,
    path: string,
    body: Record<string, unknown>,
    what: string,
    signal: AbortSignal,
  ) =>
    bytesOf(
      await send(
        fetcher,
        'ElevenLabs',
        `${api}${path}${path.includes('?') ? '&' : '?'}output_format=mp3_44100_128`,
        { method: 'POST', headers: headers(auth), body: JSON.stringify(body) },
        what,
        signal,
      ),
    )
  return {
    id: 'elevenlabs',
    name: 'ElevenLabs',
    tokenPage: 'https://elevenlabs.io/app/settings/api-keys',
    kind: 'media',
    async account(auth) {
      await send(fetcher, 'ElevenLabs', `${api}/models`, { headers: headers(auth) }, 'checking the key')
      return { id: 'elevenlabs', name: 'ElevenLabs API key', defaultScope: null, broadScope: null, expiresAt: null }
    },
    async make(auth, request, signal) {
      if (request.ability === 'speech') {
        const model = 'eleven_multilingual_v2'
        const bytes = await audio(
          auth,
          `/text-to-speech/${ELEVENLABS_VOICE}`,
          { text: request.prompt, model_id: model },
          'recording the narration',
          signal,
        )
        return { bytes, extension: 'mp3', model }
      }
      if (request.ability === 'music') {
        const model = 'music_v1'
        const seconds = Math.min(600, Math.max(3, Math.round(request.seconds ?? 30)))
        const bytes = await audio(
          auth,
          '/music',
          { prompt: request.prompt, music_length_ms: seconds * 1000, model_id: model },
          'making the music',
          signal,
        )
        return { bytes, extension: 'mp3', model }
      }
      if (request.ability === 'sound_effect') {
        const model = 'eleven_text_to_sound_v2'
        const bytes = await audio(
          auth,
          '/sound-generation',
          {
            text: request.prompt,
            model_id: model,
            ...(request.seconds ? { duration_seconds: Math.min(30, Math.max(0.5, request.seconds)) } : {}),
          },
          'making the sound',
          signal,
        )
        return { bytes, extension: 'mp3', model }
      }
      throw new Error(`ElevenLabs does not make ${request.ability} here.`)
    },
  }
}

/** OpenAI's speech endpoint with a Bearer key; its Videos API shut down in September 2026. */
export function openAiMedia(options: { api?: string; fetch?: Fetch } = {}): MediaConnector {
  const api = options.api ?? 'https://api.openai.com/v1'
  const fetcher = options.fetch ?? fetch
  const headers = (auth: HostingAuth) => ({ Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' })
  return {
    id: 'openai',
    name: 'OpenAI',
    tokenPage: 'https://platform.openai.com/api-keys',
    kind: 'media',
    async account(auth) {
      await send(fetcher, 'OpenAI', `${api}/models`, { headers: headers(auth) }, 'checking the key')
      return { id: 'openai', name: 'OpenAI API key', defaultScope: null, broadScope: null, expiresAt: null }
    },
    async make(auth, request, signal) {
      if (request.ability !== 'speech') throw new Error(`OpenAI does not make ${request.ability} here.`)
      const model = 'gpt-4o-mini-tts'
      const response = await send(
        fetcher,
        'OpenAI',
        `${api}/audio/speech`,
        {
          method: 'POST',
          headers: headers(auth),
          body: JSON.stringify({ model, voice: 'alloy', input: request.prompt, response_format: 'mp3' }),
        },
        'recording the narration',
        signal,
      )
      return { bytes: await bytesOf(response), extension: 'mp3', model }
    },
  }
}

const connectors: Record<MediaService, MediaConnector> = {
  gemini: geminiMedia(),
  elevenlabs: elevenLabsMedia(),
  openai: openAiMedia(),
}

export const mediaConnector = (service: MediaService): MediaConnector => connectors[service]
