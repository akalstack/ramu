// Narration for a Motion artifact's video, spoken on this computer: macOS's own `say`, or `espeak-ng` (or `espeak`)
// on Linux. Each scene's words become a WAV that is placed at that scene's start in one track, cut at the scene's end,
// and the video export mixes the track in. Nothing leaves the host. The text is passed in a file, never as a shell
// argument.
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { platformCli } from '../workspace/deploy/signIn'

/** A mono 16-bit track: its samples and their rate. */
export interface NarrationTrack {
  rate: number
  samples: Int16Array
}

type Speaker = { file: string; args: (text: string, out: string) => string[] }

/** The speech command on this computer, or null when it has none. */
export function speaker(): Speaker | null {
  const say = platformCli('say')
  if (say) return { file: say, args: (text, out) => ['-o', out, '--data-format=LEI16@24000', '-f', text] }
  const espeak = platformCli('espeak-ng') ?? platformCli('espeak')
  if (espeak) return { file: espeak, args: (text, out) => ['-w', out, '-f', text] }
  return null
}

/** The PCM samples and rate of a mono 16-bit WAV, from its `fmt ` and `data` chunks. */
export function readWav(bytes: Buffer): NarrationTrack {
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE')
    throw new Error('The speech command did not write a WAV file.')
  let rate = 0
  let channels = 1
  let at = 12
  while (at + 8 <= bytes.length) {
    const id = bytes.toString('ascii', at, at + 4)
    const size = bytes.readUInt32LE(at + 4)
    const body = at + 8
    if (id === 'fmt ') {
      channels = bytes.readUInt16LE(body + 2)
      rate = bytes.readUInt32LE(body + 4)
      if (bytes.readUInt16LE(body + 14) !== 16) throw new Error('The speech command wrote audio Ramu cannot read.')
    }
    if (id === 'data') {
      const end = Math.min(bytes.length, body + size)
      const frames = Math.floor((end - body) / (2 * channels))
      const samples = new Int16Array(frames)
      // Only the first channel is kept; speech engines write mono.
      for (let index = 0; index < frames; index++) samples[index] = bytes.readInt16LE(body + index * 2 * channels)
      return { rate, samples }
    }
    at = body + size + (size % 2)
  }
  throw new Error('The speech command wrote no audio.')
}

const run = (file: string, args: string[]) =>
  new Promise<void>((done, fail) =>
    execFile(file, args, { timeout: 60_000 }, (error) =>
      error ? fail(new Error('Speaking the narration failed.', { cause: error })) : done(),
    ),
  )

/** One scene's words as audio. */
export async function speak(text: string, voice: Speaker | null = speaker()): Promise<NarrationTrack> {
  if (!voice)
    throw new Error(
      'This computer has no speech command for narration. On Linux, install espeak-ng, then export again.',
    )
  const folder = await mkdtemp(join(tmpdir(), 'ramu-narration-'))
  try {
    const input = join(folder, 'script.txt')
    const output = join(folder, 'voice.wav')
    await writeFile(input, text)
    await run(voice.file, voice.args(input, output))
    return readWav(await readFile(output))
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
}

/**
 * The whole video's narration: each scene's words placed at the scene's start and cut at its end; null when no scene
 * has any. Scenes are spoken one after another, in order.
 */
export async function narrationTrack(
  scenes: readonly { seconds: number; narration?: string }[],
  say: (text: string) => Promise<NarrationTrack> = (text) => speak(text),
): Promise<NarrationTrack | null> {
  if (!scenes.some((scene) => scene.narration?.trim())) return null
  const spoken: (NarrationTrack | null)[] = []
  for (const scene of scenes) spoken.push(scene.narration?.trim() ? await say(scene.narration.trim()) : null)
  const rate = spoken.find((track) => track)!.rate
  const total = scenes.reduce((sum, scene) => sum + scene.seconds, 0)
  const samples = new Int16Array(Math.ceil(total * rate))
  let start = 0
  scenes.forEach((scene, index) => {
    const track = spoken[index]
    if (track) {
      const room = Math.floor(scene.seconds * rate)
      // A different rate (one engine for every scene, so rare) is stepped through rather than played at the wrong speed.
      const step = track.rate / rate
      for (let at = 0; at < room && Math.floor(at * step) < track.samples.length; at++)
        samples[Math.floor(start * rate) + at] = track.samples[Math.floor(at * step)]!
    }
    start += scene.seconds
  })
  return { rate, samples }
}

/** A track as a mono 16-bit WAV, for hearing a scene's narration before it is kept. */
export function wavOf(track: NarrationTrack): Buffer {
  const data = Buffer.from(track.samples.buffer, track.samples.byteOffset, track.samples.byteLength)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVEfmt ', 8, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(track.rate, 24)
  header.writeUInt32LE(track.rate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}
