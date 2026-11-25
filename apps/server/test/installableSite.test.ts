import { describe, expect, it } from 'vitest'
import { interactiveHtml, OFFLINE_NETWORK } from '@ramu/shared/interactive'
import { installableSite } from '../src/interactive/installableSite'

const exported = interactiveHtml('<p>Trip</p>', 'export', null, undefined, OFFLINE_NETWORK)
const icons = { 192: Buffer.from('a'), 512: Buffer.from('b') }
const text = (files: ReturnType<typeof installableSite>, path: string) =>
  files.find((file) => file.path === path)!.content.toString()

describe('installableSite', () => {
  it('links a manifest the browser can install from, with PNG icons at both sizes', () => {
    const files = installableSite({ title: 'Trip <costs>', icon: '🧳', version: 3 }, exported, icons)
    const manifest = JSON.parse(text(files, 'manifest.webmanifest'))
    expect(manifest).toMatchObject({ name: 'Trip <costs>', start_url: './', scope: './', display: 'standalone' })
    expect(manifest.icons.map((icon: { sizes: string }) => icon.sizes)).toEqual(
      expect.arrayContaining(['192x192', '512x512']),
    )
    const html = text(files, 'index.html')
    expect(html).toContain('<title>Trip &lt;costs&gt;</title>')
    expect(html).toContain('<link rel="manifest" href="manifest.webmanifest">')
    expect(html).toContain("register('./sw.js')")
    expect(text(files, 'icon.svg')).toContain('🧳')
  })

  it('widens the isolation policy only for its own manifest, icons and worker', () => {
    const html = text(installableSite({ title: 'T', icon: '🧳', version: 1 }, exported, null), 'index.html')
    const csp = /Content-Security-Policy" content="([^"]*)"/.exec(html)![1]!
    expect(csp).toContain("manifest-src 'self'")
    expect(csp).toContain("worker-src 'self' blob:")
    expect(csp).toContain("default-src 'none'")
    expect(csp).toMatch(/connect-src blob:\s*;/)
  })

  it('publishes without PNGs when they could not be drawn', () => {
    const files = installableSite({ title: 'T', icon: '🧳', version: 1 }, exported, null)
    expect(files.map((file) => file.path)).toEqual(['icon.svg', 'manifest.webmanifest', 'index.html', 'sw.js'])
  })

  it('gives each new version a new worker so installed copies notice it', () => {
    const worker = (version: number, html: string) =>
      text(installableSite({ title: 'T', icon: '🧳', version }, html, icons), 'sw.js')
    expect(worker(1, exported)).toBe(worker(1, exported))
    expect(worker(2, exported)).not.toBe(worker(1, exported))
    const changed = interactiveHtml('<p>Trip 2</p>', 'export', null, undefined, OFFLINE_NETWORK)
    expect(worker(1, changed)).not.toBe(worker(1, exported))
    expect(worker(1, exported)).toContain('"./","icon.svg","icon-192.png","icon-512.png","manifest.webmanifest"')
  })
})
