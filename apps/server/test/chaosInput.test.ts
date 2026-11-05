import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { describeValidationError } from '../src/validation'
import { clipText } from '@ramu/shared/text'
import { createEntry, copyEntry, readText, renameEntry, resolveInRoot } from '../src/workspace/files'

const message = (schema: z.ZodType, value: unknown) => {
  const parsed = schema.safeParse(value)
  if (parsed.success) throw new Error('expected a validation failure')
  return describeValidationError(parsed.error)
}

describe('validation messages', () => {
  it('names the field and the limit instead of dumping the schema issues', () => {
    expect(message(z.object({ name: z.string().max(200) }), { name: 'x'.repeat(201) })).toBe(
      'Name is too long (200 characters at most).',
    )
    expect(message(z.object({ maxTurns: z.number().int().max(1000) }), { maxTurns: 5000 })).toBe(
      'Max turns must be 1,000 or less.',
    )
    expect(message(z.object({ title: z.string().trim().min(1) }), { title: '   ' })).toBe("Title can't be empty.")
    expect(message(z.object({ weekdays: z.array(z.number()).min(1) }), { weekdays: [] })).toBe(
      'Weekdays needs at least one item.',
    )
    expect(message(z.object({ minutes: z.number().int().min(5) }), { minutes: 2 })).toBe('Minutes must be 5 or more.')
  })
  it('handles tuple arguments, which only have positions', () => {
    expect(message(z.tuple([z.string(), z.string().max(10)]), ['a', 'y'.repeat(11)])).toBe(
      'This text is too long (10 characters at most).',
    )
  })
  it('explains non-integers, NaN and wrong types in plain words', () => {
    expect(message(z.object({ day: z.number().int() }), { day: 1.5 })).toBe('Day must be a whole number.')
    expect(message(z.object({ minutes: z.number() }), { minutes: Number.NaN })).toBe('Minutes must be a number.')
    expect(message(z.object({ minutes: z.number() }), {})).toBe('Minutes must be a number.')
    expect(message(z.object({ name: z.string() }), {})).toBe('Name is missing or not valid.')
    expect(message(z.object({ time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) }), { time: '25:61' })).toBe(
      'Time is not in a valid format.',
    )
  })
  it('keeps messages that were already written for people', () => {
    expect(
      message(
        z.string().refine(() => false, 'Unknown timezone'),
        'Mars',
      ),
    ).toBe('Unknown timezone')
  })
})

describe('clipText', () => {
  it('leaves short text alone', () => expect(clipText('short', 60)).toBe('short'))
  it('never leaves half of a surrogate pair', () => {
    const clipped = clipText('😀'.repeat(40), 59)
    expect(clipped).toBe('😀'.repeat(29))
    expect(clipped).not.toMatch(/[\uD800-\uDBFF]$/)
    expect(() => encodeURIComponent(clipped)).not.toThrow() // throws on a lone surrogate
  })
  it('keeps joined emoji sequences whole', () => {
    const family = '👨‍👩‍👧‍👦'
    const clipped = clipText(family.repeat(20), 60)
    expect(clipped.length).toBeLessThanOrEqual(60)
    expect(clipped.replaceAll(family, '')).toBe('')
  })
  it('keeps combining marks with their letter and stays cheap on huge input', () => {
    const started = Date.now()
    const clipped = clipText(`${'Z\u0300\u0301'.repeat(2_000_000)}`, 40)
    expect(clipped.length).toBeLessThanOrEqual(40)
    expect(clipped).toMatch(/^(Z\u0300\u0301)+$/)
    expect(Date.now() - started).toBeLessThan(500)
  })
})

describe('file names', () => {
  let root: string
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'ramu-chaos-')))
    writeFileSync(join(root, 'a.txt'), 'a')
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('reports over-long names instead of leaking ENAMETOOLONG', async () => {
    await expect(createEntry(root, `${'n'.repeat(256)}.txt`, 'file')).rejects.toThrow('at most 255 bytes')
    await expect(createEntry(root, `${'é'.repeat(130)}.txt`, 'file')).rejects.toThrow('at most 255 bytes')
    await expect(readText(root, `${'n'.repeat(300)}.txt`)).rejects.toThrow('at most 255 bytes')
    await expect(createEntry(root, `${'n'.repeat(255)}`, 'file')).resolves.toBeUndefined()
  })
  it('rejects null bytes with a readable message', async () => {
    await expect(resolveInRoot(root, 'bad\0name')).rejects.toThrow('null characters')
    await expect(createEntry(root, 'bad\0name', 'file')).rejects.toThrow(/control or text-direction/)
  })
  it('does not create names that disguise their extension', async () => {
    await expect(createEntry(root, 'report-\u202Egnp.txt', 'file')).rejects.toThrow(/text-direction/)
    await expect(renameEntry(root, 'a.txt', 'b\u2067.txt')).rejects.toThrow(/text-direction/)
    await expect(copyEntry(root, 'a.txt', 'c\u001b[31m.txt')).rejects.toThrow(/control/)
  })
  it('still allows emoji, CJK and joined sequences', async () => {
    await expect(createEntry(root, '👨‍👩‍👧‍👦 漢字.txt', 'file')).resolves.toBeUndefined()
  })
})

it('cuts long prompt context on a whole character, so the request stays valid JSON text', async () => {
  const { limitSection } = await import('../src/agent/text')
  const cut = limitSection(`${'a'.repeat(9)}😀tail`, 10)
  expect(cut).toBe(`${'a'.repeat(9)}\n\n[truncated]`)
})
