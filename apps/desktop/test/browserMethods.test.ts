import { describe, expect, it, vi } from 'vitest'
import { browserMethod, isBrowserMethod } from '../src/main/browserMethods'
import { BrowserRuntime, type GuestFactory } from '../src/main/browserRuntime'

function runtime() {
  const shown: unknown[] = []
  const factory: GuestFactory = {
    create: () => {
      let url = ''
      return {
        load: async (next: string) => void (url = next),
        url: () => url,
        title: () => 't',
        back: vi.fn(),
        forward: vi.fn(),
        reload: vi.fn(),
        inspect: vi.fn(async () => ({
          url: 'https://a.test/',
          title: 'Page',
          text: 'hello',
          elements: [],
          truncated: false,
        })),
        act: vi.fn(async () => ({ ok: true })),
        setHumanInput: vi.fn(),
        show: (bounds) => void shown.push(bounds),
        hide: vi.fn(),
        destroy: vi.fn(),
      }
    },
    clearTemporary: vi.fn(),
  }
  return { runtime: new BrowserRuntime(factory, () => []), shown }
}

describe('browser methods', () => {
  it('opens, lists and closes tabs for the thread the window names', async () => {
    const { runtime: r } = runtime()
    const { tab } = (await browserMethod(r, 'browser.open', ['h', 't', 'https://a.test'])) as { tab: { id: string } }
    expect(browserMethod(r, 'browser.list', ['h', 't'])).toHaveLength(1)
    expect(browserMethod(r, 'browser.list', ['h', 'other'])).toHaveLength(0)
    browserMethod(r, 'browser.close', ['h', 't', tab.id])
    expect(browserMethod(r, 'browser.list', ['h', 't'])).toHaveLength(0)
  })

  it("a window cannot act on another thread or host's tab", async () => {
    const { runtime: r } = runtime()
    const { tab } = (await browserMethod(r, 'browser.open', ['h', 't', 'https://a.test'])) as { tab: { id: string } }
    for (const method of ['browser.close', 'browser.reload', 'browser.hide', 'browser.takeControl'])
      expect(() => browserMethod(r, method, ['h', 'other', tab.id])).toThrow('closed')
    expect(() => browserMethod(r, 'browser.close', ['other-host', 't', tab.id])).toThrow('closed')
    expect(() => browserMethod(r, 'browser.navigate', ['h', 'other', tab.id, 'https://b.test'])).toThrow('closed')
    expect(browserMethod(r, 'browser.list', ['h', 't'])).toHaveLength(1)
  })

  it('validates arguments and bounds, and refuses unknown methods', async () => {
    const { runtime: r, shown } = runtime()
    const { tab } = (await browserMethod(r, 'browser.open', ['h', 't', 'https://a.test'])) as { tab: { id: string } }
    expect(() => browserMethod(r, 'browser.open', ['h', 't', 5])).toThrow('Invalid address')
    expect(() => browserMethod(r, 'browser.open', ['', 't', 'https://a.test'])).toThrow('Invalid host')
    await expect(browserMethod(r, 'browser.open', ['h', 't', 'file:///etc/passwd'])).rejects.toMatchObject({
      code: 'bad-url',
    })
    expect(() => browserMethod(r, 'browser.show', ['h', 't', tab.id, { x: 0, y: 0, width: NaN, height: 5 }])).toThrow(
      'Invalid bounds',
    )
    expect(() => browserMethod(r, 'browser.show', ['h', 't', tab.id, { x: 0, y: 0, width: 1e9, height: 5 }])).toThrow(
      'Invalid bounds',
    )
    browserMethod(r, 'browser.show', ['h', 't', tab.id, { x: 10, y: 20, width: 300, height: 200 }])
    expect(shown).toEqual([{ x: 10, y: 20, width: 300, height: 200 }])
    expect(() => browserMethod(r, 'browser.evaluate', ['h', 't', tab.id, 'alert(1)'])).toThrow('Unknown method')
    expect(isBrowserMethod('browser.open')).toBe(true)
    expect(isBrowserMethod('tasks.list')).toBe(false)
  })

  it('a person taking control of a tab makes it human-controlled', async () => {
    const { runtime: r } = runtime()
    const { tab } = (await browserMethod(r, 'browser.open', ['h', 't', 'https://a.test'])) as { tab: { id: string } }
    expect(browserMethod(r, 'browser.takeControl', ['h', 't', tab.id])).toMatchObject({ controller: 'human' })
  })
})
