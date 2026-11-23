import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { PairingOffer } from '@ramu/shared/types'

vi.mock('../src/i18n', () => ({
  useLanguage() {},
  t: (text: string, values: Record<string, string> = {}) =>
    text.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? key),
}))
vi.mock('../src/ipc', () => ({ copyText: async () => {} }))
import { PairingCode } from '../src/settings/PairingCode'
import { PairRoute } from '../src/settings/PairRoute'

const offer = (urls: PairingOffer['urls']): PairingOffer =>
  ({ offerId: 'o1', code: 'TPWMC-HDMD4', expiresAt: 595_000, urls }) as PairingOffer

const route = (urls: PairingOffer['urls'], url: string | undefined) =>
  renderToStaticMarkup(createElement(PairRoute, { offer: offer(urls), url, onPick: () => {} }))

describe('the pairing window', () => {
  it('shows the code with when a new one replaces it, and what the screen adds under it', () => {
    const html = renderToStaticMarkup(
      createElement(PairingCode, { offer: offer([]), now: 0, url: 'http://192.168.1.4:7788' }, 'Access choice'),
    )
    expect(html).toContain('TPWMC-HDMD4')
    expect(html).toContain('New code in 9:55')
    expect(html).toContain('Access choice')
  })

  it('keeps its place while the next code is made, so the access choice under it stays', () => {
    const html = renderToStaticMarkup(
      createElement(PairingCode, { offer: null, now: 0, url: undefined }, 'Access choice'),
    )
    expect(html).toContain('Making the code…')
    expect(html).toContain('Access choice')
    expect(html).not.toContain('New code in')
  })

  it('names the route the code carries in one line, with the address list closed behind Change', () => {
    const html = route(
      [
        { url: 'https://ramu-abc.akalstack.com', interface: 'tunnel' },
        { url: 'http://192.168.1.4:7788', interface: 'en0' },
        { url: 'http://172.17.0.1:7788', interface: 'docker0' },
      ],
      'https://ramu-abc.akalstack.com',
    )
    expect(html).toContain('Phones reach this host through Ramu Link')
    expect(html).toContain('https://ramu-abc.akalstack.com')
    expect(html).toMatch(/aria-expanded="false"[^>]*>Change</)
    expect(html).not.toContain('role="radiogroup"')
    expect(html).not.toContain('192.168.1.4')
  })

  it('offers a copy instead of Change when the host has only one address', () => {
    const html = route([{ url: 'http://192.168.1.4:7788', interface: 'en0' }], 'http://192.168.1.4:7788')
    expect(html).toContain('Phones reach this host through Local network')
    expect(html).toContain('aria-label="Copy address"')
    expect(html).not.toContain('Change')
  })

  it('says when the host has no address a phone could use', () => {
    expect(route([], undefined)).toContain('No network address found. Connect this host to a network or VPN.')
  })
})
