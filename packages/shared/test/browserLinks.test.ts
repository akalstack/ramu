import { expect, it } from 'vitest'
import { browserFaviconFrom, canOpenBrowserLinkOnDevice, isWebLink, linkTargetFrom } from '../src/browserLinks'

it('only an explicit choice moves links into the integrated browser', () => {
  expect(linkTargetFrom('integrated')).toBe('integrated')
  for (const other of [undefined, null, '', 'system', 'INTEGRATED', 'anything'])
    expect(linkTargetFrom(other)).toBe('system')
})
it('accepts only same-origin web favicons, never privileged or unrelated resources', () => {
  expect(browserFaviconFrom('https://www.youtube.com/watch?v=video', 'https://www.youtube.com/favicon.ico')).toBe(
    'https://www.youtube.com/favicon.ico',
  )
  for (const icon of [
    'file:///tmp/icon.png',
    'javascript:alert(1)',
    'https://tracking.test/icon.png',
    'https://user:secret@www.youtube.com/icon.png',
  ])
    expect(browserFaviconFrom('https://www.youtube.com/', icon)).toBeNull()
})

it('only http and https links are web links', () => {
  expect(isWebLink('https://example.com')).toBe(true)
  expect(isWebLink('HTTP://example.com')).toBe(true)
  for (const bad of ['file:///etc/passwd', 'ramu://pair', 'javascript:alert(1)', 'example.com', ''])
    expect(isWebLink(bad)).toBe(false)
})
it('never opens the execution host loopback, private/IP or credential-bearing addresses on another device', () => {
  expect(canOpenBrowserLinkOnDevice('https://www.example.com/path')).toBe(true)
  for (const url of [
    'http://localhost:3000',
    'http://127.1',
    'http://192.168.1.2',
    'http://[::1]',
    'https://laptop.local',
    'http://intranet',
    'https://user:secret@example.com',
    'file:///tmp/a',
  ])
    expect(canOpenBrowserLinkOnDevice(url)).toBe(false)
})
