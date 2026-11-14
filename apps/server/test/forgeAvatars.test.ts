import { describe, expect, it, vi } from 'vitest'
import { avatarAllowed, avatarDataUrl } from '../src/workspace/forge/avatars'

describe('comment avatars', () => {
  it('fetches only https pictures from the services’ avatar hosts', () => {
    expect(avatarAllowed('https://avatars.githubusercontent.com/u/1?v=4')).toBe(true)
    expect(avatarAllowed('https://secure.gravatar.com/avatar/abc')).toBe(true)
    expect(avatarAllowed('http://avatars.githubusercontent.com/u/1')).toBe(false)
    expect(avatarAllowed('https://evil.example.com/a.png')).toBe(false)
    expect(avatarAllowed('https://user:pw@gitlab.com/a.png')).toBe(false)
  })

  it('returns a small image as a data URL once, and refuses anything else', async () => {
    const png = Buffer.from('89504e47', 'hex')
    const get = vi.fn(async () => {
      const response = new Response(png, { headers: { 'content-type': 'image/png' } })
      Object.defineProperty(response, 'url', { value: 'https://avatars.githubusercontent.com/u/2' })
      return response
    })
    const url = 'https://avatars.githubusercontent.com/u/2'
    expect(await avatarDataUrl(url, get as unknown as typeof fetch)).toBe(
      `data:image/png;base64,${png.toString('base64')}`,
    )
    await avatarDataUrl(url, get as unknown as typeof fetch)
    expect(get).toHaveBeenCalledTimes(1)
    const html = vi.fn(async () => new Response('<html>', { headers: { 'content-type': 'text/html' } }))
    expect(await avatarDataUrl('https://avatars.githubusercontent.com/u/3', html as unknown as typeof fetch)).toBeNull()
    expect(await avatarDataUrl('https://example.com/a.png', html as unknown as typeof fetch)).toBeNull()
    expect(html).toHaveBeenCalledTimes(1)
  })
})
