import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readSettledFile, reviewText } from '../src/review/reviewLive'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('review text detection', () => {
  it('keeps text that contains a replacement character as text', () => {
    expect(reviewText(Buffer.from('const missing = "�" // shown when a glyph is missing\n'))).toContain('�')
  })

  it('treats a file cut through a multi-byte character as unreadable', () => {
    const whole = Buffer.from('Loading…')
    expect(reviewText(whole.subarray(0, whole.length - 1))).toBeUndefined()
  })

  it('treats null bytes and files over 1 MB as binary', () => {
    expect(reviewText(Buffer.from([0x50, 0x4b, 0x00, 0x03]))).toBeUndefined()
    expect(reviewText(Buffer.alloc(1_000_001, 0x61))).toBeUndefined()
  })

  it('reads a file again when its first read was cut through a character', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ramu-review-text-'))
    dirs.push(dir)
    const path = join(dir, 'View.tsx')
    const whole = Buffer.from('export const label = "Merge…"\n')
    // A write still landing: half a character now, the rest a moment later.
    writeFileSync(path, whole.subarray(0, whole.indexOf('…') + 1))
    setTimeout(() => writeFileSync(path, whole), 20)
    expect((await readSettledFile(path)).toString('utf8')).toBe(whole.toString('utf8'))
  })
})
