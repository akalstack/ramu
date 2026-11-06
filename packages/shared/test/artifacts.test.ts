import { expect, it } from 'vitest'
import { artifactLink, parseArtifactLink } from '../src/artifacts'

it('makes artifact links and reads them back, with or without a share token', () => {
  const link = { computerId: 'host a', artifactId: 'p-1', share: 'tok_en-123' }
  expect(artifactLink(link)).toBe('ramu://artifact/host%20a/p-1?share=tok_en-123')
  expect(parseArtifactLink(artifactLink(link))).toEqual(link)
  expect(parseArtifactLink(' ramu://artifact/h/p ')).toEqual({ computerId: 'h', artifactId: 'p' })
})

it('refuses anything that is not an artifact link', () => {
  for (const text of [
    'ramu://page/h/p',
    'ramu://artifact/h/../x',
    'ramu://artifact/h/p?share=short',
    'https://example.com/artifact/h/p',
    'ramu://artifact/%E0%A4%A/p',
  ])
    expect(parseArtifactLink(text), text).toBeNull()
})
