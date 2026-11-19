// Narration for a Motion video: each scene's words placed at the scene's start and cut at its end, and the computer's
// own speech command read back as samples.
import { describe, expect, it } from 'vitest'
import { narrationTrack, readWav, speak, speaker } from '../src/interactive/narration'

/** A mono 16-bit WAV of `samples`, as speech commands write. */
function wav(samples: number[], rate = 10): Buffer {
  const data = Buffer.alloc(samples.length * 2)
  samples.forEach((value, index) => data.writeInt16LE(value, index * 2))
  const fmt = Buffer.alloc(16)
  fmt.writeUInt16LE(1, 0)
  fmt.writeUInt16LE(1, 2)
  fmt.writeUInt32LE(rate, 4)
  fmt.writeUInt32LE(rate * 2, 8)
  fmt.writeUInt16LE(2, 12)
  fmt.writeUInt16LE(16, 14)
  const chunk = (id: string, body: Buffer) => {
    const head = Buffer.alloc(8)
    head.write(id, 0, 'ascii')
    head.writeUInt32LE(body.length, 4)
    return Buffer.concat([head, body])
  }
  const body = Buffer.concat([Buffer.from('WAVE', 'ascii'), chunk('fmt ', fmt), chunk('data', data)])
  return Buffer.concat([chunk('RIFF', body)])
}

describe('narration', () => {
  it('reads a WAV’s samples and rate', () => {
    expect(readWav(wav([1, -2, 3], 8000))).toEqual({ rate: 8000, samples: Int16Array.from([1, -2, 3]) })
    expect(() => readWav(Buffer.from('nope'))).toThrow('WAV')
  })

  it('places each scene’s words at its start and cuts them at its end', async () => {
    // At 10 samples a second: scene one is 1 s, scene two 2 s; the first voice runs long and is cut.
    const track = await narrationTrack(
      [{ seconds: 1, narration: 'Hello' }, { seconds: 2 }, { seconds: 1, narration: 'Bye' }],
      async (text) => readWav(wav(text === 'Hello' ? Array(15).fill(7) : [9, 9], 10)),
    )
    expect(track?.rate).toBe(10)
    expect(Array.from(track!.samples.slice(0, 11))).toEqual([...Array(10).fill(7), 0])
    expect(Array.from(track!.samples.slice(30, 33))).toEqual([9, 9, 0])
    expect(await narrationTrack([{ seconds: 1 }], async () => readWav(wav([1])))).toBeNull()
  })

  it.skipIf(!speaker())('speaks with this computer’s own command', async () => {
    const track = await speak('Sync works offline.')
    expect(track.rate).toBeGreaterThan(8000)
    expect(track.samples.length).toBeGreaterThan(track.rate / 2)
  })
})
