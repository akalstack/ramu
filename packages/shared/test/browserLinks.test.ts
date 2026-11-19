import { expect, it } from 'vitest'
import {
  browserFaviconFrom,
  canOpenBrowserLinkOnDevice,
  isWebLink,
  isHostLoopbackPage,
  linkTargetFrom,
  phoneBrowserUrl,
  phoneForwardUrl,
} from '../src/browserLinks'

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

it('points host loopback pages at the address the phone reaches the host on, and leaves other pages alone', () => {
  const host = 'http://100.64.0.7:7788'
  expect(phoneBrowserUrl('http://localhost:5173/app?x=1#top', host)).toBe('http://100.64.0.7:5173/app?x=1#top')
  expect(phoneBrowserUrl('http://127.0.0.1:3000/', host)).toBe('http://100.64.0.7:3000/')
  expect(phoneBrowserUrl('http://0.0.0.0:8080/', host)).toBe('http://100.64.0.7:8080/')
  expect(phoneBrowserUrl('http://[::1]:4000/', host)).toBe('http://100.64.0.7:4000/')
  expect(phoneBrowserUrl('http://app.localhost:3000/', 'https://studio.tail1234.ts.net')).toBe(
    'http://studio.tail1234.ts.net:3000/',
  )
  expect(phoneBrowserUrl('http://localhost:3000/', 'http://[fd7a::5]:7788')).toBe('http://[fd7a::5]:3000/')
  expect(phoneBrowserUrl('https://example.com/a', host)).toBe('https://example.com/a')
  expect(phoneBrowserUrl('http://192.168.1.20:3000/', host)).toBe('http://192.168.1.20:3000/')
})
it('never offers a page the phone cannot safely load itself', () => {
  for (const page of ['about:blank', 'chrome://settings', 'file:///etc/hosts', 'https://user:pw@example.com/', 'nope'])
    expect(phoneBrowserUrl(page, 'http://100.64.0.7:7788')).toBeNull()
  expect(phoneBrowserUrl('http://localhost:3000/', 'http://127.0.0.1:7788')).toBeNull()
  expect(phoneBrowserUrl('http://localhost:3000/', 'not a url')).toBeNull()
})

it('opens a host forward on the address the phone reaches the host at, never on the phone’s own loopback', () => {
  expect(isHostLoopbackPage('http://localhost:5173/')).toBe(true)
  expect(isHostLoopbackPage('http://[::1]:4000/')).toBe(true)
  expect(isHostLoopbackPage('https://example.com/')).toBe(false)
  expect(isHostLoopbackPage('nope')).toBe(false)
  expect(phoneForwardUrl('https://192.168.1.5:7788', 51234, '/__ramu/open?t=abc')).toBe(
    'http://192.168.1.5:51234/__ramu/open?t=abc',
  )
  expect(phoneForwardUrl('http://[fd7a::5]:7788', 51234, '/__ramu/open?t=abc')).toBe(
    'http://[fd7a::5]:51234/__ramu/open?t=abc',
  )
  expect(phoneForwardUrl('http://127.0.0.1:7788', 51234, '/__ramu/open?t=abc')).toBeNull()
  expect(phoneForwardUrl('http://192.168.1.5:7788', 51234, '//evil.example/x')).toBeNull()
  expect(phoneForwardUrl('not a url', 51234, '/x')).toBeNull()
})
