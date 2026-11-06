import { expect, it } from 'vitest'
import { artifactLink, currentToolName, oldArtifactToolName, parseArtifactLink } from '../src/pages'

it('makes artifact links and reads them back, with or without a share token', () => {
  const link = { computerId: 'host a', pageId: 'p-1', share: 'tok_en-123' }
  expect(artifactLink(link)).toBe('ramu://artifact/host%20a/p-1?share=tok_en-123')
  expect(parseArtifactLink(artifactLink(link))).toEqual(link)
  expect(parseArtifactLink('ramu://artifact/h/p')).toEqual({ computerId: 'h', pageId: 'p' })
})

it('still reads the ramu://page links earlier shares and home-screen icons carry', () => {
  expect(parseArtifactLink('ramu://page/h/p')).toEqual({ computerId: 'h', pageId: 'p' })
  expect(parseArtifactLink(' ramu://page/host%20a/p-1?share=tok_en-123 ')).toEqual({
    computerId: 'host a',
    pageId: 'p-1',
    share: 'tok_en-123',
  })
})

it('refuses anything that is not an artifact link', () => {
  for (const text of [
    'ramu://page/h/../x',
    'ramu://artifact/h/p?share=short',
    'ramu://thread/h/p',
    'https://example.com/artifact/h/p',
    'ramu://artifact/%E0%A4%A/p',
  ])
    expect(parseArtifactLink(text), text).toBeNull()
})

it('maps each earlier artifact tool name to its current one and back', () => {
  expect(currentToolName('page_list')).toBe('artifact_list')
  expect(currentToolName('preview_interactive')).toBe('artifact_preview')
  expect(currentToolName('artifact_list')).toBe('artifact_list')
  expect(currentToolName('memory_search')).toBe('memory_search')
  expect(currentToolName('constructor')).toBe('constructor')
  expect(oldArtifactToolName('artifact_publish')).toBe('publish_interactive')
  expect(oldArtifactToolName('memory_search')).toBeUndefined()
})
