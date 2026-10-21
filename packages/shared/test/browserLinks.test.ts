import { expect, it } from 'vitest'
import { isWebLink, linkTargetFrom } from '../src/browserLinks'

it('only an explicit choice moves links into the integrated browser', () => {
  expect(linkTargetFrom('integrated')).toBe('integrated')
  for (const other of [undefined, null, '', 'system', 'INTEGRATED', 'anything'])
    expect(linkTargetFrom(other)).toBe('system')
})

it('only http and https links are web links', () => {
  expect(isWebLink('https://example.com')).toBe(true)
  expect(isWebLink('HTTP://example.com')).toBe(true)
  for (const bad of ['file:///etc/passwd', 'ramu://pair', 'javascript:alert(1)', 'example.com', ''])
    expect(isWebLink(bad)).toBe(false)
})
