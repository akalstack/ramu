// The media services an ability runs on with the person's own key, against a fake fetch: what each sends, where the key
// goes, and how the file comes back.
import { describe, expect, it } from 'vitest'
import { elevenLabsMedia, geminiMedia, openAiMedia } from '../src/media/mediaServices'

interface Sent {
  url: string
  method: string
  headers: Record<string, string>
  body: Record<string, unknown> | null
}

function fakeFetch(answer: (sent: Sent) => Response) {
  const sent: Sent[] = []
  const fetcher = (async (url: string, init: RequestInit = {}) => {
    const request = {
      url,
      method: init.method ?? 'GET',
      headers: (init.headers ?? {}) as Record<string, string>,
      body: init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
    }
    sent.push(request)
    return answer(request)
  }) as unknown as typeof fetch
  return { fetcher, sent }
}

const auth = { token: 'key-1' }
const signal = new AbortController().signal
const interaction = (type: 'audio' | 'video', data: string) =>
  new Response(JSON.stringify({ steps: [{ type: 'model_output', content: [{ type, data }] }] }))

describe('Google Gemini', () => {
  it('records speech, makes music by length and makes video through the Interactions API with the key in its header', async () => {
    const { fetcher, sent } = fakeFetch(({ body }) =>
      interaction(body?.model === 'gemini-omni-1.2-flash' ? 'video' : 'audio', Buffer.from('bytes').toString('base64')),
    )
    const gemini = geminiMedia({ api: 'https://gemini.test/v1beta', fetch: fetcher })
    const speech = await gemini.make(auth, { ability: 'speech', prompt: 'Sync keeps every device current.' }, signal)
    expect(speech).toMatchObject({ extension: 'wav', model: 'gemini-3.8-flash-tts' })
    expect(speech.bytes.toString()).toBe('bytes')
    expect(sent[0]).toMatchObject({
      url: 'https://gemini.test/v1beta/interactions',
      headers: { 'x-goog-api-key': 'key-1' },
    })
    expect(sent[0]!.body).toMatchObject({
      response_format: { type: 'audio' },
      generation_config: { speech_config: [{ voice: 'Kore' }] },
    })

    expect((await gemini.make(auth, { ability: 'music', prompt: 'Calm piano', seconds: 20 }, signal)).model).toBe(
      'lyria-3-clip-preview',
    )
    const long = await gemini.make(auth, { ability: 'music', prompt: 'Calm piano', seconds: 90 }, signal)
    expect(long).toMatchObject({ extension: 'mp3', model: 'lyria-3.5' })
    expect(sent.at(-1)!.body!.input).toContain('About 90 seconds long')

    const video = await gemini.make(
      auth,
      { ability: 'video_generation', prompt: 'A paper plane', seconds: 30, aspect: 'portrait' },
      signal,
    )
    expect(video).toMatchObject({ extension: 'mp4', model: 'gemini-omni-1.2-flash' })
    expect(sent.at(-1)!.body!.response_format).toEqual({
      type: 'video',
      aspect_ratio: '9:16',
      resolution: '720p',
      duration: '15s',
    })
  })

  it('says to replace a refused key where it is saved, and refuses an ability it does not make', async () => {
    const { fetcher } = fakeFetch(
      () => new Response(JSON.stringify({ error: { message: 'API key not valid' } }), { status: 400 }),
    )
    const refused = fakeFetch(() => new Response('{}', { status: 403 }))
    await expect(
      geminiMedia({ fetch: fetcher }).make(auth, { ability: 'speech', prompt: 'Hi' }, signal),
    ).rejects.toThrow('API key not valid')
    await expect(geminiMedia({ fetch: refused.fetcher }).account(auth)).rejects.toThrow('Settings → Models → Abilities')
    await expect(
      geminiMedia({ fetch: fetcher }).make(auth, { ability: 'sound_effect', prompt: 'Whoosh' }, signal),
    ).rejects.toThrow('does not make')
  })
})

describe('ElevenLabs and OpenAI', () => {
  it('make sound effects, music and speech from the file their endpoints answer with', async () => {
    const { fetcher, sent } = fakeFetch(() => new Response(Buffer.from('mp3')))
    const eleven = elevenLabsMedia({ api: 'https://eleven.test/v1', fetch: fetcher })
    const sound = await eleven.make(auth, { ability: 'sound_effect', prompt: 'A soft whoosh', seconds: 2 }, signal)
    expect(sound).toMatchObject({ extension: 'mp3', model: 'eleven_text_to_sound_v2' })
    expect(sent[0]).toMatchObject({
      url: 'https://eleven.test/v1/sound-generation?output_format=mp3_44100_128',
      headers: { 'xi-api-key': 'key-1' },
      body: { text: 'A soft whoosh', duration_seconds: 2 },
    })
    await eleven.make(auth, { ability: 'music', prompt: 'Upbeat synth', seconds: 45 }, signal)
    expect(sent.at(-1)!.body).toMatchObject({ prompt: 'Upbeat synth', music_length_ms: 45_000 })

    const openai = openAiMedia({ api: 'https://openai.test/v1', fetch: fetcher })
    const speech = await openai.make(auth, { ability: 'speech', prompt: 'Hello' }, signal)
    expect(speech.bytes.toString()).toBe('mp3')
    expect(sent.at(-1)).toMatchObject({
      url: 'https://openai.test/v1/audio/speech',
      headers: { Authorization: 'Bearer key-1' },
      body: { model: 'gpt-4o-mini-tts', input: 'Hello', response_format: 'mp3' },
    })
    await expect(openai.make(auth, { ability: 'video_generation', prompt: 'x' }, signal)).rejects.toThrow(
      'does not make',
    )
  })
})
