import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { EvidenceFiles, imageFallback, showsImageResults } from '../src/computer/evidence'

describe('screenshot fallback for providers that do not show MCP images', () => {
  it('adds nothing for a provider that shows the inline image', () => {
    expect(showsImageResults('claude-code')).toBe(true)
    expect(imageFallback('claude-code', {}, null)).toEqual({})
  })

  it('points other providers at a private file and the accessibility text', () => {
    const withText = imageFallback('codex', { text: '1 button' }, '/tmp/x/observation.jpg')
    expect(withText.screenshotPath).toBe('/tmp/x/observation.jpg')
    expect(withText.note).toMatch(/accessibility/)
    expect(imageFallback('cursor', {}, null).note).toMatch(/no accessibility text/)
  })

  it('keeps one file per thread and removes it when asked', async () => {
    const files = new EvidenceFiles()
    const first = await files.write('t', { data: Buffer.from('one').toString('base64'), mimeType: 'image/jpeg' })
    const second = await files.write('t', { data: Buffer.from('two').toString('base64'), mimeType: 'image/jpeg' })
    expect(second).toBe(first)
    expect(readFileSync(second, 'utf8')).toBe('two')
    await files.clear('t')
    expect(existsSync(second)).toBe(false)
  })
})
